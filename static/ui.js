// ═══════════════════════════════════════════════════════════════
// UI Manager — Rendering & DOM Manipulation
// ═══════════════════════════════════════════════════════════════

function addMessage(chatId, msg) {
    if (!AppState.messages[chatId]) AppState.messages[chatId] = [];
    AppState.messages[chatId].push(msg);
    if (AppState.activeChat && getChatId(AppState.activeChat) === chatId) {
        renderMessages();
    }
}

function addSystemMessage(chatId, text) {
    addMessage(chatId, { from: '__system__', text, time: new Date().toISOString(), system: true });
}

function getChatId(chat) {
    return `${chat.type}:${chat.name}`;
}

function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!AppState.activeChat) { container.innerHTML = ''; return; }
    const chatId = getChatId(AppState.activeChat);
    const msgs = AppState.messages[chatId] || [];

    container.innerHTML = msgs.map(msg => {
        if (msg.system) {
            return `<div class="system-message">${escapeHtml(msg.text)}</div>`;
        }
        const isSent = msg.sent || msg.from === AppState.username;
        const cls = isSent ? 'sent' : 'received';
        const time = formatTime(msg.time);
        const sender = (!isSent && AppState.activeChat.type === 'room') ? `<div class="text-xs font-medium text-accent mb-1">${escapeHtml(msg.from)}</div>` : '';
        return `<div class="flex ${isSent ? 'justify-end' : 'justify-start'}">
            <div class="message-bubble ${cls}">
                ${sender}
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="message-meta">${time}</div>
            </div>
        </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function renderUsersList() {
    const container = document.getElementById('users-list');
    const filter = AppState.searchFilter.toLowerCase();
    let users = AppState.allUsers.filter(u => u.username !== AppState.username);
    if (filter) users = users.filter(u => u.username.toLowerCase().includes(filter));

    // Sort: online first
    users.sort((a, b) => {
        const aOn = AppState.onlineUsers.has(a.username);
        const bOn = AppState.onlineUsers.has(b.username);
        if (aOn !== bOn) return bOn - aOn;
        return a.username.localeCompare(b.username);
    });

    const onlineCount = AppState.allUsers.filter(u => AppState.onlineUsers.has(u.username) && u.username !== AppState.username).length;
    document.getElementById('online-count').textContent = `${onlineCount} online`;

    container.innerHTML = users.map(u => {
        const isOnline = AppState.onlineUsers.has(u.username);
        const isActive = AppState.activeChat?.type === 'user' && AppState.activeChat?.name === u.username;
        const unread = AppState.unread[`user:${u.username}`] || 0;
        return `<div class="list-item ${isActive ? 'active' : ''}" onclick="selectChat('user','${escapeAttr(u.username)}')">
            <div class="relative">
                <div class="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">
                    ${u.username[0].toUpperCase()}
                </div>
                <div class="absolute -bottom-0.5 -right-0.5 status-dot ${isOnline ? 'online' : 'offline'}"></div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${escapeHtml(u.username)}</div>
                <div class="text-xs ${isOnline ? 'text-emerald-400' : 'text-gray-500'}">${isOnline ? 'Online' : 'Offline'}</div>
            </div>
            ${unread ? `<span class="unread-badge">${unread}</span>` : ''}
        </div>`;
    }).join('');

    if (users.length === 0) {
        container.innerHTML = '<div class="text-center text-xs text-gray-500 py-4">No users found</div>';
    }

    renderCompactUsersList(users);
}

function renderRoomsList() {
    const container = document.getElementById('rooms-list');
    const filter = AppState.searchFilter.toLowerCase();
    let rooms = AppState.myRooms || [];
    if (filter) rooms = rooms.filter(r => r.name.toLowerCase().includes(filter));

    container.innerHTML = rooms.map(r => {
        const isActive = AppState.activeChat?.type === 'room' && AppState.activeChat?.name === r.name;
        const unread = AppState.unread[`room:${r.name}`] || 0;
        const memberCount = r.members ? r.members.length : 0;
        return `<div class="list-item ${isActive ? 'active' : ''}" onclick="selectChat('room','${escapeAttr(r.name)}')">
            <div class="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">
                #
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${escapeHtml(r.name)}</div>
                <div class="text-xs text-gray-500">${memberCount} members</div>
            </div>
            ${unread ? `<span class="unread-badge">${unread}</span>` : ''}
        </div>`;
    }).join('');

    if (rooms.length === 0) {
        container.innerHTML = '<div class="text-center text-xs text-gray-500 py-4">No rooms yet</div>';
    }

    renderCompactRoomsList(rooms);
}

// ── Compact Sidebar Renderers ───────────────────────────────────

function renderCompactUsersList(users) {
    const container = document.getElementById('compact-users-list');
    if (!container) return;
    if (!users) {
        users = AppState.allUsers.filter(u => u.username !== AppState.username);
        users.sort((a, b) => {
            const aOn = AppState.onlineUsers.has(a.username);
            const bOn = AppState.onlineUsers.has(b.username);
            if (aOn !== bOn) return bOn - aOn;
            return a.username.localeCompare(b.username);
        });
    }

    container.innerHTML = users.map(u => {
        const isOnline = AppState.onlineUsers.has(u.username);
        const isActive = AppState.activeChat?.type === 'user' && AppState.activeChat?.name === u.username;
        const unread = AppState.unread[`user:${u.username}`] || 0;
        return `<div class="compact-item ${isActive ? 'active' : ''}" onclick="selectChat('user','${escapeAttr(u.username)}')">
            <div class="compact-avatar bg-accent/10 text-accent">${u.username[0].toUpperCase()}</div>
            <div class="compact-dot ${isOnline ? 'online' : 'offline'}"></div>
            ${unread ? `<div class="compact-badge">${unread}</div>` : ''}
            <span class="compact-tooltip">${escapeHtml(u.username)}${isOnline ? ' ●' : ''}</span>
        </div>`;
    }).join('');
}

function renderCompactRoomsList(rooms) {
    const container = document.getElementById('compact-rooms-list');
    if (!container) return;
    if (!rooms) rooms = AppState.myRooms || [];

    container.innerHTML = rooms.map(r => {
        const isActive = AppState.activeChat?.type === 'room' && AppState.activeChat?.name === r.name;
        const unread = AppState.unread[`room:${r.name}`] || 0;
        return `<div class="compact-item ${isActive ? 'active' : ''}" onclick="selectChat('room','${escapeAttr(r.name)}')">
            <div class="compact-avatar bg-purple-500/10 text-purple-400 rounded-lg" style="border-radius:8px">#</div>
            ${unread ? `<div class="compact-badge">${unread}</div>` : ''}
            <span class="compact-tooltip">#${escapeHtml(r.name)}</span>
        </div>`;
    }).join('');
}

async function selectChat(type, name) {
    AppState.activeChat = { type, name };
    const chatId = getChatId(AppState.activeChat);
    AppState.unread[chatId] = 0;

    document.getElementById('welcome-screen').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');

    updateChatHeader();
    renderMessages();
    renderUsersList();
    renderRoomsList();

    // Close sidebar on mobile
    if (window.innerWidth < 768) toggleSidebar();

    // Track which chats already showed the encryption setup message
    if (!AppState._encryptionShown) AppState._encryptionShown = new Set();

    // Initiate key exchange if needed
    if (type === 'user') {
        if (!AppState.sessionKeys[name]) {
            if (!AppState._encryptionShown.has(chatId)) {
                AppState._encryptionShown.add(chatId);
                addSystemMessage(chatId, 'Setting up encryption...');
            }
            await ensureSessionKey(name);
        }
    } else if (type === 'room') {
        if (!AppState.sessionKeys[`room:${name}`]) {
            if (!AppState._encryptionShown.has(chatId)) {
                AppState._encryptionShown.add(chatId);
                addSystemMessage(chatId, 'Setting up room encryption...');
            }
            await distributeRoomKey(name);
        }
    }

    document.getElementById('message-input').focus();
}

function updateChatHeader() {
    if (!AppState.activeChat) return;
    const { type, name } = AppState.activeChat;

    if (type === 'user') {
        document.getElementById('chat-avatar-text').textContent = name[0].toUpperCase();
        document.getElementById('chat-avatar').className = 'w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center';
        document.getElementById('chat-name').textContent = name;
        const isOnline = AppState.onlineUsers.has(name);
        document.getElementById('chat-status').textContent = isOnline ? 'Online' : 'Offline';
        const dot = document.getElementById('chat-status-dot');
        dot.classList.remove('hidden');
        dot.className = `absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-800 ${isOnline ? 'bg-emerald-500 pulse-online' : 'bg-zinc-600'}`;
        document.getElementById('room-settings-btn').classList.add('hidden');
    } else {
        document.getElementById('chat-avatar-text').textContent = '#';
        document.getElementById('chat-avatar').className = 'w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center';
        document.getElementById('chat-name').textContent = `#${name}`;
        const room = AppState.myRooms.find(r => r.name === name);
        const count = room ? room.members.length : 0;
        document.getElementById('chat-status').textContent = `${count} members`;
        document.getElementById('chat-status-dot').classList.add('hidden');
        document.getElementById('room-settings-btn').classList.remove('hidden');
    }
}

function showWelcomeScreen() {
    AppState.activeChat = null;
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('welcome-screen').classList.remove('hidden');
}

// ── Room Modal ──────────────────────────────────────────────────

function openCreateRoomModal() {
    document.getElementById('room-modal').classList.remove('hidden');
    document.getElementById('room-name-input').value = '';
    // Populate invite list
    const container = document.getElementById('invite-users-list');
    const users = AppState.allUsers.filter(u => u.username !== AppState.username);
    container.innerHTML = users.map(u => `<label class="invite-item">
        <input type="checkbox" value="${escapeAttr(u.username)}">
        <div class="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">${u.username[0].toUpperCase()}</div>
        <span class="text-sm">${escapeHtml(u.username)}</span>
        <span class="ml-auto text-xs ${AppState.onlineUsers.has(u.username) ? 'text-emerald-400' : 'text-gray-500'}">
            ${AppState.onlineUsers.has(u.username) ? '● Online' : '○ Offline'}
        </span>
    </label>`).join('');
}

function closeCreateRoomModal() {
    document.getElementById('room-modal').classList.add('hidden');
}

function handleCreateRoom(e) {
    e.preventDefault();
    const name = document.getElementById('room-name-input').value.trim();
    if (!name) return;

    wsSend({ type: 'create_room', roomName: name });

    // Invite selected users
    const checkboxes = document.querySelectorAll('#invite-users-list input:checked');
    checkboxes.forEach(cb => {
        wsSend({ type: 'invite_to_room', roomName: name, target: cb.value });
    });

    closeCreateRoomModal();
    showToast(`Room #${name} created`, 'success');
}

// ── Room Settings Modal ─────────────────────────────────────────

function openRoomSettingsModal() {
    if (!AppState.activeChat || AppState.activeChat.type !== 'room') return;
    const roomName = AppState.activeChat.name;
    const room = AppState.myRooms.find(r => r.name === roomName);
    if (!room) return;

    document.getElementById('room-settings-modal').classList.remove('hidden');
    document.getElementById('room-settings-title').textContent = `#${room.name} Settings`;
    document.getElementById('room-settings-creator').textContent = room.creator;
    
    renderRoomSettingsMembers(roomName);
}

function closeRoomSettingsModal() {
    document.getElementById('room-settings-modal').classList.add('hidden');
}

function renderRoomSettingsMembers(roomName) {
    const room = AppState.myRooms.find(r => r.name === roomName);
    if (!room) return;

    const isCreator = room.creator === AppState.username;

    // Actions visibility
    document.getElementById('room-leave-btn').classList.toggle('hidden', isCreator);
    document.getElementById('room-delete-btn').classList.toggle('hidden', !isCreator);
    document.getElementById('room-settings-add-section').classList.toggle('hidden', !isCreator);

    // Members count
    document.getElementById('room-settings-member-count').textContent = `${room.members.length} member${room.members.length > 1 ? 's' : ''}`;

    // Members list
    const memContainer = document.getElementById('room-settings-members');
    memContainer.innerHTML = room.members.map(member => {
        const isOnline = AppState.onlineUsers.has(member);
        const me = member === AppState.username ? ' (You)' : '';
        const kickBtn = (isCreator && member !== AppState.username) 
            ? `<button onclick="handleKickMember('${escapeAttr(member)}')" class="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10" title="Remove member"><i data-lucide="user-minus" class="w-4 h-4"></i></button>`
            : '';

        return `<div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">${member[0].toUpperCase()}</div>
                <div>
                    <div class="text-sm font-medium">${escapeHtml(member)}${me}</div>
                    <div class="text-[0.65rem] ${isOnline ? 'text-emerald-400' : 'text-gray-500'}">${isOnline ? 'Online' : 'Offline'}</div>
                </div>
            </div>
            ${kickBtn}
        </div>`;
    }).join('');

    // Add members list (only users not already in room)
    if (isCreator) {
        const addContainer = document.getElementById('room-settings-add-list');
        const availableUsers = AppState.allUsers.filter(u => u.username !== AppState.username && !room.members.includes(u.username));
        
        if (availableUsers.length === 0) {
            addContainer.innerHTML = '<div class="text-xs text-center text-gray-500 py-4">All registered users are in this room.</div>';
            document.getElementById('room-settings-add-btn').classList.add('hidden');
        } else {
            document.getElementById('room-settings-add-btn').classList.remove('hidden');
            addContainer.innerHTML = availableUsers.map(u => `<label class="invite-item">
                <input type="checkbox" value="${escapeAttr(u.username)}">
                <div class="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">${u.username[0].toUpperCase()}</div>
                <span class="text-sm">${escapeHtml(u.username)}</span>
            </label>`).join('');
        }
    }

    // Re-initialize Lucide icons for dynamically added HTML
    if (window.lucide) window.lucide.createIcons();
}

function handleAddMembersFromSettings() {
    if (!AppState.activeChat || AppState.activeChat.type !== 'room') return;
    const roomName = AppState.activeChat.name;
    const checkboxes = document.querySelectorAll('#room-settings-add-list input:checked');
    
    if (checkboxes.length === 0) return;

    checkboxes.forEach(cb => {
        wsSend({ type: 'invite_to_room', roomName: roomName, target: cb.value });
    });

    showToast(`Invited ${checkboxes.length} user(s)`, 'success');
}

function handleKickMember(targetUser) {
    if (!AppState.activeChat || AppState.activeChat.type !== 'room') return;
    wsSend({ type: 'remove_member', roomName: AppState.activeChat.name, target: targetUser });
}

function handleLeaveRoom() {
    if (!AppState.activeChat || AppState.activeChat.type !== 'room') return;
    if (confirm(`Are you sure you want to leave #${AppState.activeChat.name}?`)) {
        wsSend({ type: 'remove_member', roomName: AppState.activeChat.name, target: AppState.username });
        closeRoomSettingsModal();
    }
}

function handleDeleteRoom() {
    if (!AppState.activeChat || AppState.activeChat.type !== 'room') return;
    if (confirm(`CRITICAL WARNING: Are you sure you want to permanently delete #${AppState.activeChat.name}? All members will be removed.`)) {
        wsSend({ type: 'delete_room', roomName: AppState.activeChat.name });
        closeRoomSettingsModal();
    }
}

// ── Sidebar Toggle ──────────────────────────────────────────────

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');

    // Overlay
    let overlay = document.querySelector('.sidebar-overlay');
    if (sidebar.classList.contains('open') && !overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = toggleSidebar;
        document.body.appendChild(overlay);
    } else if (overlay) {
        overlay.remove();
    }
}

// ── Search ──────────────────────────────────────────────────────

function handleSearch(value) {
    AppState.searchFilter = value;
    renderUsersList();
    renderRoomsList();
}

// ── Toast Notifications ─────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: 'check-circle', error: 'alert-circle', info: 'info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i data-lucide="${icons[type]}" class="w-4 h-4 flex-shrink-0"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [toast] });
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Utilities ───────────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


