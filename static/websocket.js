// ═══════════════════════════════════════════════════════════════
// WebSocket Manager
// ═══════════════════════════════════════════════════════════════

let reconnectTimeout = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectWebSocket() {
    if (!AppState.token) return;
    // Close any existing stale connection before opening a new one
    if (AppState.ws) {
        if (AppState.ws.readyState === WebSocket.OPEN) return;
        if (AppState.ws.readyState === WebSocket.CONNECTING) return;
        AppState.ws = null;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?token=${AppState.token}`;
    const ws = new WebSocket(url);
    AppState.ws = ws;

    ws.onopen = async () => {
        console.log('✅ WebSocket connected');
        reconnectAttempts = 0;
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        // Register RSA public key
        const pubKey = await CryptoManager.exportPublicKey();
        wsSend({ type: 'key_register', publicKey: pubKey });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWSMessage(data);
        } catch (err) { console.error('WS parse error:', err); }
    };

    ws.onclose = () => {
        // Don't reconnect if user logged out (token cleared)
        if (!AppState.token) {
            console.log('WebSocket closed (logged out)');
            return;
        }
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('Max reconnect attempts reached');
            showToast('Connection lost. Please refresh the page.', 'error');
            return;
        }
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 30000);
        console.log(`❌ WebSocket closed, reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts})`);
        reconnectTimeout = setTimeout(async () => {
            await CryptoManager.generateRSAKeyPair();
            connectWebSocket();
        }, delay);
    };

    ws.onerror = (err) => console.error('WS error:', err);
}

function wsSend(data) {
    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        AppState.ws.send(JSON.stringify(data));
    }
}

async function handleWSMessage(data) {
    switch (data.type) {
        case 'init_state':
            AppState.onlineUsers = new Set(data.onlineUsers);
            AppState.myRooms = data.myRooms || [];
            AppState.rooms = data.allRooms || [];
            renderUsersList(); renderRoomsList();
            break;

        case 'user_online':
            AppState.onlineUsers.add(data.username);
            renderUsersList(); updateChatHeader();
            break;

        case 'user_offline':
            AppState.onlineUsers.delete(data.username);
            renderUsersList(); updateChatHeader();
            break;

        case 'key_registered':
            console.log('🔑 Public key registered on server');
            showToast('Encryption keys ready', 'success');
            break;

        case 'key_response':
            if (data.publicKey) {
                AppState.publicKeys[data.username] = await CryptoManager.importPublicKey(data.publicKey);
                await initiateKeyExchange(data.username);
            }
            break;

        case 'key_exchange':
            await handleIncomingKeyExchange(data);
            break;

        case 'message':
            await handleIncomingMessage(data);
            break;

        case 'message_sent':
            // Confirmation — message already shown optimistically
            break;

        case 'room_created':
            AppState.myRooms.push(data.room);
            AppState.rooms.push(data.room);
            renderRoomsList();
            break;

        case 'room_list_update':
            AppState.rooms = data.rooms || [];
            renderRoomsList();
            break;

        case 'room_invite':
            AppState.myRooms.push(data.room);
            renderRoomsList();
            showToast(`${data.invitedBy} invited you to #${data.room.name}`, 'info');
            break;

        case 'room_joined':
            const existsJ = AppState.myRooms.find(r => r.name === data.room.name);
            if (!existsJ) AppState.myRooms.push(data.room);
            else Object.assign(existsJ, data.room);
            renderRoomsList();
            break;

        case 'room_left':
            AppState.myRooms = AppState.myRooms.filter(r => r.name !== data.room);
            renderRoomsList();
            if (AppState.activeChat?.type === 'room' && AppState.activeChat.name === data.room) {
                showWelcomeScreen();
            }
            break;

        case 'room_member_joined':
            addSystemMessage(`room:${data.room}`, `${data.username} joined the room`);
            const rj = AppState.myRooms.find(r => r.name === data.room);
            if (rj) rj.members = data.members;
            updateChatHeader();
            break;

        case 'room_member_left':
            const leftMsg = data.removedBy && data.removedBy !== data.username
                ? `${data.username} was removed by ${data.removedBy}`
                : `${data.username} left the room`;
            addSystemMessage(`room:${data.room}`, leftMsg);
            const rl = AppState.myRooms.find(r => r.name === data.room);
            if (rl) rl.members = data.members;
            updateChatHeader();
            // Refresh room settings modal if open
            if (document.getElementById('room-settings-modal') &&
                !document.getElementById('room-settings-modal').classList.contains('hidden')) {
                renderRoomSettingsMembers(data.room);
            }
            break;

        case 'room_deleted':
            AppState.myRooms = AppState.myRooms.filter(r => r.name !== data.room);
            AppState.rooms = AppState.rooms.filter(r => r.name !== data.room);
            delete AppState.sessionKeys[`room:${data.room}`];
            delete AppState.messages[`room:${data.room}`];
            renderRoomsList();
            if (AppState.activeChat?.type === 'room' && AppState.activeChat.name === data.room) {
                showWelcomeScreen();
            }
            closeRoomSettingsModal();
            showToast(`Room #${data.room} was deleted`, 'info');
            break;

        case 'room_kicked':
            AppState.myRooms = AppState.myRooms.filter(r => r.name !== data.room);
            delete AppState.sessionKeys[`room:${data.room}`];
            delete AppState.messages[`room:${data.room}`];
            renderRoomsList();
            if (AppState.activeChat?.type === 'room' && AppState.activeChat.name === data.room) {
                showWelcomeScreen();
            }
            closeRoomSettingsModal();
            showToast(`You were removed from #${data.room}`, 'error');
            break;

        case 'room_key_delivery':
            await handleRoomKeyDelivery(data);
            break;

        case 'room_message':
            await handleIncomingRoomMessage(data);
            break;

        case 'room_message_sent':
            break;

        case 'room_members':
            // Could update UI
            break;

        case 'error':
            console.error('Server error:', data.message);
            showToast(data.message, 'error');
            break;
    }
}

// ── Key Exchange (Private) ──────────────────────────────────────

async function ensureSessionKey(targetUser) {
    if (AppState.sessionKeys[targetUser]) return AppState.sessionKeys[targetUser];

    const TIMEOUT = 15000; // 15s max wait
    const POLL_INTERVAL = 200;

    if (AppState.pendingKeyExchanges.has(targetUser)) {
        // Wait for exchange to complete with timeout
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = setInterval(() => {
                if (AppState.sessionKeys[targetUser]) {
                    clearInterval(check);
                    resolve(AppState.sessionKeys[targetUser]);
                } else if (Date.now() - start > TIMEOUT) {
                    clearInterval(check);
                    AppState.pendingKeyExchanges.delete(targetUser);
                    resolve(null);
                }
            }, POLL_INTERVAL);
        });
    }

    // Request their public key
    if (!AppState.publicKeys[targetUser]) {
        AppState.pendingKeyExchanges.add(targetUser);
        wsSend({ type: 'key_request', target: targetUser });
        return new Promise((resolve) => {
            const start = Date.now();
            const check = setInterval(() => {
                if (AppState.sessionKeys[targetUser]) {
                    clearInterval(check);
                    resolve(AppState.sessionKeys[targetUser]);
                } else if (Date.now() - start > TIMEOUT) {
                    clearInterval(check);
                    AppState.pendingKeyExchanges.delete(targetUser);
                    console.warn(`Key exchange timeout for ${targetUser}`);
                    resolve(null);
                }
            }, POLL_INTERVAL);
        });
    }

    await initiateKeyExchange(targetUser);
    return AppState.sessionKeys[targetUser];
}

async function initiateKeyExchange(targetUser) {
    if (!AppState.publicKeys[targetUser]) return;
    const aesKey = await CryptoManager.generateAESKey();
    AppState.sessionKeys[targetUser] = aesKey;
    const encryptedKey = await CryptoManager.encryptAESKeyWithRSA(aesKey, AppState.publicKeys[targetUser]);
    wsSend({ type: 'key_exchange', to: targetUser, encryptedKey });
    AppState.pendingKeyExchanges.delete(targetUser);
    console.log(`🔐 AES key exchanged with ${targetUser}`);
}

async function handleIncomingKeyExchange(data) {
    try {
        const aesKey = await CryptoManager.decryptAESKeyWithRSA(data.encryptedKey);
        AppState.sessionKeys[data.from] = aesKey;
        AppState.pendingKeyExchanges.delete(data.from);
        console.log(`🔐 Received AES key from ${data.from}`);
        addSystemMessage(`user:${data.from}`, 'Encryption established');
        if (AppState.activeChat?.type === 'user' && AppState.activeChat.name === data.from) {
            renderMessages();
        }
    } catch (err) { console.error('Key exchange error:', err); }
}

// ── Key Exchange (Room) ─────────────────────────────────────────

async function ensureRoomSessionKey(roomName) {
    const key = `room:${roomName}`;
    if (AppState.sessionKeys[key]) return AppState.sessionKeys[key];
    return null;
}

async function distributeRoomKey(roomName) {
    const room = AppState.myRooms.find(r => r.name === roomName);
    if (!room) return;

    const aesKey = await CryptoManager.generateAESKey();
    AppState.sessionKeys[`room:${roomName}`] = aesKey;

    // Request all missing public keys first
    const missingKeys = room.members.filter(
        m => m !== AppState.username && !AppState.publicKeys[m]
    );
    for (const member of missingKeys) {
        wsSend({ type: 'key_request', target: member });
    }

    // Wait for public keys to arrive (poll with timeout)
    if (missingKeys.length > 0) {
        await new Promise(resolve => {
            const start = Date.now();
            const check = setInterval(() => {
                const allResolved = missingKeys.every(m => AppState.publicKeys[m]);
                if (allResolved || Date.now() - start > 5000) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
        });
    }

    // Now encrypt the AES key for each member that has a public key
    const keys = {};
    for (const member of room.members) {
        if (member === AppState.username) continue;
        if (AppState.publicKeys[member]) {
            keys[member] = await CryptoManager.encryptAESKeyWithRSA(aesKey, AppState.publicKeys[member]);
        }
    }

    if (Object.keys(keys).length > 0) {
        wsSend({ type: 'room_key_exchange', room: roomName, keys });
    }
    console.log(`🔐 Room key distributed for #${roomName}`);
}

async function handleRoomKeyDelivery(data) {
    try {
        const aesKey = await CryptoManager.decryptAESKeyWithRSA(data.encryptedKey);
        AppState.sessionKeys[`room:${data.room}`] = aesKey;
        console.log(`🔐 Received room key for #${data.room} from ${data.from}`);
        addSystemMessage(`room:${data.room}`, 'Room encryption established');
    } catch (err) { console.error('Room key delivery error:', err); }
}

// ── Messaging ───────────────────────────────────────────────────

async function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !AppState.activeChat) return;

    const chat = AppState.activeChat;

    if (chat.type === 'user') {
        try {
            const aesKey = await ensureSessionKey(chat.name);
            if (!aesKey) { showToast('Encryption not ready. Please wait...', 'error'); return; }
            const encrypted = await CryptoManager.encryptMessage(text, aesKey);
            wsSend({ type: 'message', to: chat.name, data: encrypted });
            addMessage(`user:${chat.name}`, { from: AppState.username, text, time: new Date().toISOString(), sent: true });
        } catch (err) { console.error('Send error:', err); showToast('Failed to send message', 'error'); return; }
    } else if (chat.type === 'room') {
        try {
            let aesKey = await ensureRoomSessionKey(chat.name);
            if (!aesKey) {
                await distributeRoomKey(chat.name);
                aesKey = AppState.sessionKeys[`room:${chat.name}`];
            }
            if (!aesKey) { showToast('Room encryption not ready', 'error'); return; }
            const encrypted = await CryptoManager.encryptMessage(text, aesKey);
            wsSend({ type: 'room_message', room: chat.name, data: encrypted });
            addMessage(`room:${chat.name}`, { from: AppState.username, text, time: new Date().toISOString(), sent: true });
        } catch (err) { console.error('Room send error:', err); showToast('Failed to send message', 'error'); return; }
    }

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('send-btn').disabled = true;
}

async function handleIncomingMessage(data) {
    const chatId = `user:${data.from}`;
    try {
        const aesKey = AppState.sessionKeys[data.from];
        if (!aesKey) { console.warn('No AES key for', data.from); return; }
        const text = await CryptoManager.decryptMessage(data.data, aesKey);
        addMessage(chatId, { from: data.from, text, time: data.timestamp, sent: false });

        if (!AppState.activeChat || AppState.activeChat.type !== 'user' || AppState.activeChat.name !== data.from) {
            AppState.unread[chatId] = (AppState.unread[chatId] || 0) + 1;
            renderUsersList();
            showToast(`${data.from}: ${text.substring(0, 50)}`, 'info');
        }
    } catch (err) { console.error('Decrypt error:', err); }
}

async function handleIncomingRoomMessage(data) {
    const chatId = `room:${data.room}`;
    try {
        const aesKey = AppState.sessionKeys[chatId];
        if (!aesKey) { console.warn('No AES key for room', data.room); return; }
        const text = await CryptoManager.decryptMessage(data.data, aesKey);
        addMessage(chatId, { from: data.from, text, time: data.timestamp, sent: false });

        if (!AppState.activeChat || AppState.activeChat.type !== 'room' || AppState.activeChat.name !== data.room) {
            AppState.unread[chatId] = (AppState.unread[chatId] || 0) + 1;
            renderRoomsList();
            showToast(`#${data.room} — ${data.from}: ${text.substring(0, 50)}`, 'info');
        }
    } catch (err) { console.error('Room decrypt error:', err); }
}

function handleMessageKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('message-form').dispatchEvent(new Event('submit'));
        return;
    }
    // Defer the check so the keydown has updated the field value
    setTimeout(() => {
        document.getElementById('send-btn').disabled = !e.target.value.trim();
    }, 0);
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
    document.getElementById('send-btn').disabled = !el.value.trim();
}
