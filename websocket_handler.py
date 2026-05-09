"""WebSocket endpoint and event routing. The server acts as a blind relay —
it NEVER reads, logs, or processes message content or AES keys in plaintext."""

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from auth import verify_token
import state

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """Main WebSocket endpoint. Authenticates via JWT query parameter."""

    # ── 1. Authenticate ────────────────────────────────────────
    username = verify_token(token)
    if not username:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()
    logger.info(f"✅ {username} connected via WebSocket")

    # ── 2. Close previous connection if user reconnects ─────────
    old_ws = state.active_connections.get(username)
    if old_ws and old_ws != websocket:
        try:
            await old_ws.close(code=4002, reason="Replaced by new connection")
        except Exception:
            pass  # Old connection may already be dead

    # ── 3. Register connection ──────────────────────────────────
    state.register_connection(username, websocket)

    # Notify all others that this user is online
    await state.broadcast_all(
        {"type": "user_online", "username": username},
        exclude=username,
    )

    # Send the new user current state: online users + their rooms
    online_users = state.get_online_users()
    user_rooms = state.get_user_rooms_list(username)
    all_rooms = state.get_all_rooms()

    await state.send_to_user(username, {
        "type": "init_state",
        "username": username,
        "onlineUsers": online_users,
        "myRooms": user_rooms,
        "allRooms": all_rooms,
    })

    # ── 4. Message loop ─────────────────────────────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await state.send_to_user(username, {
                    "type": "error",
                    "message": "Invalid JSON",
                })
                continue

            msg_type = data.get("type")
            if not msg_type:
                continue

            await handle_event(username, msg_type, data)

    except WebSocketDisconnect:
        logger.info(f"❌ {username} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for {username}: {e}")
    finally:
        # ── 5. Cleanup on disconnect ────────────────────────────
        # Only clean up if THIS websocket is still the active one
        # (prevents clearing state when a newer connection replaced us)
        if state.active_connections.get(username) == websocket:
            state.unregister_connection(username)
            await state.broadcast_all(
                {"type": "user_offline", "username": username},
            )


async def handle_event(username: str, msg_type: str, data: dict) -> None:
    """Route incoming WebSocket events to their handlers."""

    match msg_type:
        # ── Key Management ──────────────────────────────────────
        case "key_register":
            await handle_key_register(username, data)

        case "key_request":
            await handle_key_request(username, data)

        # ── Key Exchange (E2EE) ─────────────────────────────────
        case "key_exchange":
            await handle_key_exchange(username, data)

        case "room_key_exchange":
            await handle_room_key_exchange(username, data)

        # ── Private Messaging ───────────────────────────────────
        case "message":
            await handle_private_message(username, data)

        # ── Room Operations ─────────────────────────────────────
        case "create_room":
            await handle_create_room(username, data)

        case "join_room":
            await handle_join_room(username, data)

        case "leave_room":
            await handle_leave_room(username, data)

        case "invite_to_room":
            await handle_invite_to_room(username, data)

        case "get_room_members":
            await handle_get_room_members(username, data)

        # ── Room Messaging ──────────────────────────────────────
        case "room_message":
            await handle_room_message(username, data)

        # ── Room Management ─────────────────────────────────────
        case "delete_room":
            await handle_delete_room(username, data)

        case "remove_member":
            await handle_remove_member(username, data)

        case _:
            await state.send_to_user(username, {
                "type": "error",
                "message": f"Unknown event type: {msg_type}",
            })


# ═══════════════════════════════════════════════════════════════
# EVENT HANDLERS
# ═══════════════════════════════════════════════════════════════


async def handle_key_register(username: str, data: dict) -> None:
    """Store the user's RSA public key (JWK format)."""
    public_key = data.get("publicKey")
    if not public_key:
        await state.send_to_user(username, {
            "type": "error", "message": "publicKey is required",
        })
        return

    state.register_public_key(username, public_key)
    await state.send_to_user(username, {"type": "key_registered"})
    logger.info(f"🔑 RSA public key registered for {username}")


async def handle_key_request(username: str, data: dict) -> None:
    """Return the RSA public key of a target user."""
    target = data.get("target")
    if not target:
        await state.send_to_user(username, {
            "type": "error", "message": "target is required",
        })
        return

    key = state.get_public_key(target)
    if not key:
        await state.send_to_user(username, {
            "type": "key_response",
            "username": target,
            "publicKey": None,
            "error": f"{target} has no registered public key",
        })
        return

    await state.send_to_user(username, {
        "type": "key_response",
        "username": target,
        "publicKey": key,
    })


async def handle_key_exchange(username: str, data: dict) -> None:
    """Relay an encrypted AES session key to the target user. BLIND RELAY."""
    target = data.get("to")
    encrypted_key = data.get("encryptedKey")

    if not target or not encrypted_key:
        await state.send_to_user(username, {
            "type": "error", "message": "'to' and 'encryptedKey' are required",
        })
        return

    # Blind relay — server does NOT inspect encryptedKey
    sent = await state.send_to_user(target, {
        "type": "key_exchange",
        "from": username,
        "encryptedKey": encrypted_key,
    })

    if not sent:
        await state.send_to_user(username, {
            "type": "error", "message": f"{target} is offline",
        })


async def handle_room_key_exchange(username: str, data: dict) -> None:
    """Relay encrypted AES keys to each room member individually. BLIND RELAY."""
    room_name = data.get("room")
    keys = data.get("keys")  # {username: encrypted_aes_key}

    if not room_name or not keys:
        await state.send_to_user(username, {
            "type": "error", "message": "'room' and 'keys' are required",
        })
        return

    for target_user, encrypted_key in keys.items():
        await state.send_to_user(target_user, {
            "type": "room_key_delivery",
            "room": room_name,
            "from": username,
            "encryptedKey": encrypted_key,
        })


async def handle_private_message(username: str, data: dict) -> None:
    """Relay an encrypted private message. BLIND RELAY — server never reads 'data'."""
    target = data.get("to")
    encrypted_data = data.get("data")  # IV + Base64(ciphertext) — opaque to server

    if not target or not encrypted_data:
        await state.send_to_user(username, {
            "type": "error", "message": "'to' and 'data' are required",
        })
        return

    sent = await state.send_to_user(target, {
        "type": "message",
        "from": username,
        "data": encrypted_data,
        "timestamp": _timestamp(),
    })

    # Confirm delivery to sender
    await state.send_to_user(username, {
        "type": "message_sent",
        "to": target,
        "data": encrypted_data,
        "delivered": sent,
        "timestamp": _timestamp(),
    })


async def handle_create_room(username: str, data: dict) -> None:
    """Create a new chat room."""
    room_name = data.get("roomName", "").strip()
    if not room_name:
        await state.send_to_user(username, {
            "type": "error", "message": "roomName is required",
        })
        return

    room_info = state.create_room(room_name, username)
    if not room_info:
        await state.send_to_user(username, {
            "type": "error", "message": f"Room '{room_name}' already exists",
        })
        return

    await state.send_to_user(username, {
        "type": "room_created",
        "room": room_info,
    })

    # Broadcast new room to all connected users
    await state.broadcast_all(
        {"type": "room_list_update", "rooms": state.get_all_rooms()},
        exclude=username,
    )

    logger.info(f"🏠 Room '{room_name}' created by {username}")


async def handle_join_room(username: str, data: dict) -> None:
    """Join an existing room."""
    room_name = data.get("roomName")
    if not room_name:
        return

    success = state.add_user_to_room(room_name, username)
    if not success:
        await state.send_to_user(username, {
            "type": "error", "message": f"Room '{room_name}' does not exist",
        })
        return

    room_info = state.get_room_info(room_name)
    await state.send_to_user(username, {
        "type": "room_joined",
        "room": room_info,
    })

    # Notify room members
    await state.send_to_room(room_name, {
        "type": "room_member_joined",
        "room": room_name,
        "username": username,
        "members": room_info["members"],
    }, exclude=username)


async def handle_leave_room(username: str, data: dict) -> None:
    """Leave a room."""
    room_name = data.get("roomName")
    if not room_name:
        return

    state.remove_user_from_room(room_name, username)

    await state.send_to_user(username, {
        "type": "room_left",
        "room": room_name,
    })

    # Notify remaining members
    room_info = state.get_room_info(room_name)
    if room_info:
        await state.send_to_room(room_name, {
            "type": "room_member_left",
            "room": room_name,
            "username": username,
            "members": room_info["members"],
        })


async def handle_invite_to_room(username: str, data: dict) -> None:
    """Invite a user to a room."""
    room_name = data.get("roomName")
    target = data.get("target")

    if not room_name or not target:
        await state.send_to_user(username, {
            "type": "error", "message": "'roomName' and 'target' are required",
        })
        return

    # Check if room exists and inviter is a member
    members = state.get_room_members(room_name)
    if username not in members:
        await state.send_to_user(username, {
            "type": "error", "message": "You are not a member of this room",
        })
        return

    success = state.add_user_to_room(room_name, target)
    if not success:
        return

    room_info = state.get_room_info(room_name)

    # Notify the invited user
    await state.send_to_user(target, {
        "type": "room_invite",
        "room": room_info,
        "invitedBy": username,
    })

    # Notify room members about new member
    await state.send_to_room(room_name, {
        "type": "room_member_joined",
        "room": room_name,
        "username": target,
        "members": room_info["members"],
    }, exclude=target)


async def handle_get_room_members(username: str, data: dict) -> None:
    """Return the members of a room."""
    room_name = data.get("roomName")
    if not room_name:
        return

    room_info = state.get_room_info(room_name)
    if not room_info:
        await state.send_to_user(username, {
            "type": "error", "message": f"Room '{room_name}' not found",
        })
        return

    await state.send_to_user(username, {
        "type": "room_members",
        "room": room_name,
        "members": room_info["members"],
    })


async def handle_room_message(username: str, data: dict) -> None:
    """Relay an encrypted room message to all room members. BLIND RELAY."""
    room_name = data.get("room")
    encrypted_data = data.get("data")  # IV + Base64(ciphertext) — opaque to server

    if not room_name or not encrypted_data:
        await state.send_to_user(username, {
            "type": "error", "message": "'room' and 'data' are required",
        })
        return

    # Verify sender is in the room
    members = state.get_room_members(room_name)
    if username not in members:
        await state.send_to_user(username, {
            "type": "error", "message": "You are not a member of this room",
        })
        return

    # Blind relay to all room members except sender
    await state.send_to_room(room_name, {
        "type": "room_message",
        "room": room_name,
        "from": username,
        "data": encrypted_data,
        "timestamp": _timestamp(),
    }, exclude=username)

    # Confirm to sender
    await state.send_to_user(username, {
        "type": "room_message_sent",
        "room": room_name,
        "data": encrypted_data,
        "timestamp": _timestamp(),
    })


async def handle_delete_room(username: str, data: dict) -> None:
    """Delete a room. Only the creator can delete it."""
    room_name = data.get("roomName")
    if not room_name:
        return

    room = state.rooms.get(room_name)
    if not room:
        await state.send_to_user(username, {
            "type": "error", "message": f"Room '{room_name}' does not exist",
        })
        return

    if room["creator"] != username:
        await state.send_to_user(username, {
            "type": "error", "message": "Only the room creator can delete a room",
        })
        return

    members = list(room["members"])

    # Notify all members before deletion
    for member in members:
        await state.send_to_user(member, {
            "type": "room_deleted",
            "room": room_name,
            "deletedBy": username,
        })
        # Clean up user_rooms mapping
        if member in state.user_rooms:
            state.user_rooms[member].discard(room_name)

    # Delete the room
    del state.rooms[room_name]

    # Broadcast updated room list to everyone
    await state.broadcast_all(
        {"type": "room_list_update", "rooms": state.get_all_rooms()},
    )

    logger.info(f"🗑️ Room '{room_name}' deleted by {username}")


async def handle_remove_member(username: str, data: dict) -> None:
    """Remove a member from a room. Creator can kick anyone; members can only remove themselves."""
    room_name = data.get("roomName")
    target = data.get("target")

    if not room_name or not target:
        await state.send_to_user(username, {
            "type": "error", "message": "'roomName' and 'target' are required",
        })
        return

    room = state.rooms.get(room_name)
    if not room:
        await state.send_to_user(username, {
            "type": "error", "message": f"Room '{room_name}' does not exist",
        })
        return

    # Authorization: only creator can kick others; anyone can remove themselves
    if target != username and room["creator"] != username:
        await state.send_to_user(username, {
            "type": "error", "message": "Only the room creator can remove members",
        })
        return

    # Cannot remove the creator
    if target == room["creator"] and target == username:
        await state.send_to_user(username, {
            "type": "error", "message": "The creator cannot leave. Delete the room instead.",
        })
        return

    state.remove_user_from_room(room_name, target)

    # Notify the removed user
    await state.send_to_user(target, {
        "type": "room_kicked",
        "room": room_name,
        "removedBy": username,
    })

    # Notify remaining members
    room_info = state.get_room_info(room_name)
    if room_info:
        await state.send_to_room(room_name, {
            "type": "room_member_left",
            "room": room_name,
            "username": target,
            "members": room_info["members"],
            "removedBy": username,
        })

    logger.info(f"👤 {target} removed from '{room_name}' by {username}")


def _timestamp() -> str:
    """Get ISO 8601 timestamp."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
