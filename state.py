"""In-memory state management for WebSocket connections, keys, and rooms.

Nothing here is persisted to disk. All state is volatile and cleared on server restart.
"""

from fastapi import WebSocket
import json
import logging

logger = logging.getLogger(__name__)

# ── Active Connections ──────────────────────────────────────────
# {username: WebSocket}
active_connections: dict[str, WebSocket] = {}

# ── RSA Public Keys ─────────────────────────────────────────────
# {username: JWK string}
public_keys: dict[str, str] = {}

# ── Chat Rooms ──────────────────────────────────────────────────
# {room_name: {"name": str, "creator": str, "members": set[str]}}
rooms: dict[str, dict] = {}

# ── User → Rooms mapping ───────────────────────────────────────
# {username: set(room_name)}
user_rooms: dict[str, set[str]] = {}


def is_online(username: str) -> bool:
    """Check if a user is currently connected."""
    return username in active_connections


def register_connection(username: str, websocket: WebSocket) -> None:
    """Register a new WebSocket connection."""
    active_connections[username] = websocket
    if username not in user_rooms:
        user_rooms[username] = set()


def unregister_connection(username: str) -> None:
    """Remove a user's connection and public key. Room membership is preserved."""
    active_connections.pop(username, None)
    public_keys.pop(username, None)
    logger.info(f"Cleaned up connection state for {username}")


def register_public_key(username: str, key_jwk: str) -> None:
    """Store a user's RSA public key (JWK format)."""
    public_keys[username] = key_jwk


def get_public_key(username: str) -> str | None:
    """Get a user's RSA public key."""
    return public_keys.get(username)


def get_online_users() -> list[str]:
    """Get list of all online usernames."""
    return list(active_connections.keys())


# ── Room Operations ─────────────────────────────────────────────

def create_room(room_name: str, creator: str) -> dict | None:
    """Create a new room. Returns room info or None if name already exists."""
    if room_name in rooms:
        return None
    rooms[room_name] = {
        "name": room_name,
        "creator": creator,
        "members": {creator},
    }
    user_rooms.setdefault(creator, set()).add(room_name)
    return get_room_info(room_name)


def add_user_to_room(room_name: str, username: str) -> bool:
    """Add a user to a room. Returns False if room doesn't exist."""
    if room_name not in rooms:
        return False
    rooms[room_name]["members"].add(username)
    user_rooms.setdefault(username, set()).add(room_name)
    return True


def remove_user_from_room(room_name: str, username: str) -> bool:
    """Remove a user from a room."""
    if room_name not in rooms:
        return False
    rooms[room_name]["members"].discard(username)
    if username in user_rooms:
        user_rooms[username].discard(room_name)
    # Clean up empty rooms
    if not rooms[room_name]["members"]:
        del rooms[room_name]
    return True


def get_room_info(room_name: str) -> dict | None:
    """Get room info as serializable dict."""
    room = rooms.get(room_name)
    if not room:
        return None
    return {
        "name": room["name"],
        "creator": room["creator"],
        "members": list(room["members"]),
    }


def get_user_rooms_list(username: str) -> list[dict]:
    """Get all rooms a user is a member of."""
    room_names = user_rooms.get(username, set())
    return [get_room_info(name) for name in room_names if name in rooms]


def get_all_rooms() -> list[dict]:
    """Get all existing rooms."""
    return [get_room_info(name) for name in rooms]


def get_room_members(room_name: str) -> set[str]:
    """Get members of a room."""
    if room_name not in rooms:
        return set()
    return rooms[room_name]["members"]


# ── Messaging Helpers ───────────────────────────────────────────

async def send_to_user(username: str, data: dict) -> bool:
    """Send a JSON message to a specific user. Returns False if user is offline.
    Automatically cleans up dead connections."""
    ws = active_connections.get(username)
    if not ws:
        return False
    try:
        await ws.send_text(json.dumps(data))
        return True
    except Exception:
        logger.warning(f"Failed to send message to {username}, cleaning up dead connection")
        # Remove dead connection so user shows as offline
        active_connections.pop(username, None)
        public_keys.pop(username, None)
        return False


async def broadcast_all(data: dict, exclude: str | None = None) -> None:
    """Broadcast a message to all connected users, optionally excluding one."""
    for username, ws in list(active_connections.items()):
        if username == exclude:
            continue
        try:
            await ws.send_text(json.dumps(data))
        except Exception:
            logger.warning(f"Failed to broadcast to {username}")


async def send_to_room(room_name: str, data: dict, exclude: str | None = None) -> None:
    """Send a message to all online members of a room."""
    members = get_room_members(room_name)
    for member in members:
        if member == exclude:
            continue
        await send_to_user(member, data)
