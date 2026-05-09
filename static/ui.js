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

        let contentHtml = '';
        if (msg.mediaType === 'image') {
            contentHtml = `<div class="image-bubble" onclick="openLightbox('${msg.blobUrl}')">
                <img src="${msg.blobUrl}" alt="Photo" loading="lazy">
                <div class="image-overlay"><i data-lucide="maximize-2" class="w-5 h-5"></i></div>
            </div>`;
        } else if (msg.mediaType === 'voice') {
            const durationSec = msg.metadata?.duration || 0;
            const durText = formatDuration(durationSec);
            const uid = 'vp-' + Math.random().toString(36).slice(2, 9);
            
            // Build waveform bars HTML
            const waveform = msg.metadata?.waveform || Array(40).fill(0.1);
            const barsHtml = waveform.map(val => {
                const height = Math.max(10, Math.min(100, val * 100)); // 10% to 100% height
                return `<div class="wave-bar" style="height: ${height}%"></div>`;
            }).join('');

            contentHtml = `<div class="voice-bubble" id="${uid}">
                <button class="voice-play-btn" onclick="toggleVoicePlay('${uid}','${msg.blobUrl}')">
                    <i data-lucide="play" class="w-4 h-4"></i>
                </button>
                <div class="voice-track" id="${uid}-track" onclick="seekVoice(event, '${uid}')">
                    ${barsHtml}
                </div>
                <span class="voice-duration" id="${uid}-dur">${durText}</span>
                <audio src="${msg.blobUrl}" preload="metadata" id="${uid}-audio"
                    data-duration="${durationSec}"
                    ontimeupdate="updateVoiceProgress('${uid}')"
                    onended="resetVoicePlayer('${uid}')"></audio>
            </div>`;
        } else {
            contentHtml = `<div class="message-text">${escapeHtml(msg.text)}</div>`;
        }

        return `<div class="flex ${isSent ? 'justify-end' : 'justify-start'}">
            <div class="message-bubble ${cls}">
                ${sender}
                ${contentHtml}
                <div class="message-meta">${time}</div>
            </div>
        </div>`;
    }).join('');

    // Re-init Lucide icons for dynamic content
    if (window.lucide) lucide.createIcons({ nodes: [container] });

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

// ═══════════════════════════════════════════════════════════════
// Media UI Helpers
// ═══════════════════════════════════════════════════════════════

// ── Image Lightbox ──────────────────────────────────────────────

function openLightbox(src) {
    const lb = document.getElementById('image-lightbox');
    document.getElementById('lightbox-img').src = src;
    lb.classList.remove('hidden');
}

function closeLightbox() {
    const lb = document.getElementById('image-lightbox');
    lb.classList.add('hidden');
    document.getElementById('lightbox-img').src = '';
}

// ── Voice Player Controls ───────────────────────────────────────

function toggleVoicePlay(uid, src) {
    const audio = document.getElementById(`${uid}-audio`);
    const btn = document.querySelector(`#${uid} .voice-play-btn`);
    if (!audio) return;

    if (audio.paused) {
        // Pause all other players
        document.querySelectorAll('.voice-bubble audio').forEach(a => {
            if (a.id !== `${uid}-audio` && !a.paused) { a.pause(); a.currentTime = 0; }
        });
        document.querySelectorAll('.voice-play-btn').forEach(b => {
            b.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i>';
        });

        audio.play();
        btn.innerHTML = '<i data-lucide="pause" class="w-4 h-4"></i>';
    } else {
        audio.pause();
        btn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i>';
    }
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
}

function seekVoice(event, uid) {
    const track = document.getElementById(`${uid}-track`);
    const audio = document.getElementById(`${uid}-audio`);
    if (!track || !audio) return;
    
    // Calculate click position relative to track width
    const rect = track.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    let pct = clickX / rect.width;
    pct = Math.max(0, Math.min(1, pct)); // clamp between 0 and 1
    
    // Get total duration
    let totalDur = audio.duration;
    if (!totalDur || totalDur === Infinity) {
        totalDur = parseFloat(audio.dataset.duration || 0);
    }
    
    if (totalDur > 0) {
        audio.currentTime = totalDur * pct;
        updateVoiceProgress(uid); // update UI instantly
    }
}

function updateVoiceProgress(uid) {
    const audio = document.getElementById(`${uid}-audio`);
    const track = document.getElementById(`${uid}-track`);
    const durEl = document.getElementById(`${uid}-dur`);
    if (!audio || !track) return;
    
    // Fix Infinity:NaN issue by falling back to metadata duration
    let totalDur = audio.duration;
    if (!totalDur || totalDur === Infinity) {
        totalDur = parseFloat(audio.dataset.duration || 0);
    }
    
    const pct = totalDur > 0 ? (audio.currentTime / totalDur) : 0;
    
    // Color the waveform bars based on percentage
    const bars = track.querySelectorAll('.wave-bar');
    const activeCount = Math.floor(pct * bars.length);
    bars.forEach((bar, index) => {
        if (index < activeCount) {
            bar.classList.add('active');
        } else {
            bar.classList.remove('active');
        }
    });

    if (durEl) {
        const rem = Math.ceil(totalDur - audio.currentTime) || 0;
        durEl.textContent = formatDuration(Math.max(0, rem));
    }
}

function resetVoicePlayer(uid) {
    const btn = document.querySelector(`#${uid} .voice-play-btn`);
    const track = document.getElementById(`${uid}-track`);
    const audio = document.getElementById(`${uid}-audio`);
    const durEl = document.getElementById(`${uid}-dur`);
    
    if (track) {
        track.querySelectorAll('.wave-bar').forEach(bar => bar.classList.remove('active'));
    }
    
    if (btn) {
        btn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
    
    if (durEl && audio) {
        let totalDur = audio.duration;
        if (!totalDur || totalDur === Infinity) totalDur = parseFloat(audio.dataset.duration || 0);
        durEl.textContent = formatDuration(Math.ceil(totalDur));
    }
}

// ── Image Picker ────────────────────────────────────────────────

function triggerImagePicker() {
    document.getElementById('image-file-input').click();
}

async function handleImageSelected(input) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const validation = validateImageFile(file);
    if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
    }

    // Show preview modal
    const previewUrl = createImagePreviewURL(file);
    const modal = document.getElementById('image-preview-modal');
    document.getElementById('preview-img').src = previewUrl;
    document.getElementById('preview-file-info').textContent =
        `${file.name} — ${formatFileSize(file.size)}`;
    modal.classList.remove('hidden');

    // Store pending file for send
    AppState._pendingImage = file;
    AppState._pendingPreviewUrl = previewUrl;
}

async function sendPendingImage() {
    const file = AppState._pendingImage;
    if (!file) return;

    closeImagePreviewModal();
    showToast('Compressing & encrypting image...', 'info');

    try {
        const compressed = await compressImage(
            file,
            MediaConfig.image.maxWidth,
            MediaConfig.image.maxHeight,
            MediaConfig.image.quality
        );
        await sendMediaMessage(compressed, 'image', {
            mimeType: 'image/jpeg',
            fileName: file.name,
        });
    } catch (err) {
        console.error('Image send error:', err);
        showToast('Failed to send image', 'error');
    }
}

function closeImagePreviewModal() {
    document.getElementById('image-preview-modal').classList.add('hidden');
    if (AppState._pendingPreviewUrl) {
        revokeImagePreviewURL(AppState._pendingPreviewUrl);
    }
    AppState._pendingImage = null;
    AppState._pendingPreviewUrl = null;
}

// ── Voice Recording UI ──────────────────────────────────────────

let _voiceRecorder = null;

async function toggleVoiceRecording() {
    if (_voiceRecorder && _voiceRecorder.isRecording) {
        // Already recording → stop and send
        await stopVoiceRecording();
    } else {
        // Not recording → start
        await startVoiceRecording();
    }
}

async function startVoiceRecording() {
    if (_voiceRecorder?.isRecording) return;

    _voiceRecorder = new VoiceRecorder();
    _voiceRecorder.onDurationUpdate = (sec) => {
        document.getElementById('recording-duration').textContent = formatDuration(sec);
        const remaining = MediaConfig.voice.maxDurationSec - sec;
        if (remaining <= 10) {
            document.getElementById('recording-duration').classList.add('text-red-400');
        }
    };
    _voiceRecorder.onMaxDuration = async (blob, waveform) => {
        hideRecordingOverlay();
        if (blob) {
            const v = validateVoiceBlob(blob);
            if (!v.valid) { showToast(v.error, 'error'); return; }
            await sendMediaMessage(blob, 'voice', { 
                mimeType: 'audio/webm', 
                duration: MediaConfig.voice.maxDurationSec,
                waveform: waveform
            });
        }
        _voiceRecorder = null;
    };
    
    _voiceRecorder.onAmplitude = (vol) => {
        // Animate the recording pulse/bars based on mic volume
        const bars = document.querySelectorAll('#recording-waveform .rec-bar');
        if (bars.length === 0) return;
        
        // Simple shifting animation
        for (let i = 0; i < bars.length - 1; i++) {
            bars[i].style.height = bars[i+1].style.height;
        }
        // Set new amplitude for the last bar
        const height = Math.max(10, Math.min(100, vol * 100 * 2.5)); // Boost visual
        bars[bars.length - 1].style.height = `${height}%`;
    };

    try {
        await _voiceRecorder.start();
        showRecordingOverlay();
    } catch (err) {
        console.error('Voice recording error:', err);
        // Provide user-friendly messages
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            showToast('Microphone permission denied. Please allow microphone access in your browser settings and try again.', 'error');
        } else if (err.name === 'NotFoundError') {
            showToast('No microphone found. Please connect a microphone.', 'error');
        } else {
            showToast(err.message || 'Failed to start recording', 'error');
        }
        _voiceRecorder = null;
    }
}

async function stopVoiceRecording() {
    if (!_voiceRecorder || !_voiceRecorder.isRecording) return;
    const duration = _voiceRecorder.getDuration();
    const result = await _voiceRecorder.stop();
    hideRecordingOverlay();

    if (result && result.blob && duration >= 1) {
        const v = validateVoiceBlob(result.blob);
        if (!v.valid) { showToast(v.error, 'error'); return; }
        await sendMediaMessage(result.blob, 'voice', { 
            mimeType: 'audio/webm', 
            duration: duration,
            waveform: result.waveform
        });
    } else if (duration < 1) {
        showToast('Recording too short. Click mic to start, click again to stop.', 'info');
    }
    _voiceRecorder = null;
}

function cancelVoiceRecording() {
    if (_voiceRecorder) {
        _voiceRecorder.cancel();
        _voiceRecorder = null;
    }
    hideRecordingOverlay();
}

function showRecordingOverlay() {
    document.getElementById('recording-overlay').classList.remove('hidden');
    document.getElementById('media-actions').classList.add('hidden');
    document.getElementById('message-input').classList.add('hidden');
    document.getElementById('send-btn').classList.add('hidden');
    document.getElementById('recording-duration').textContent = '0:00';
    document.getElementById('recording-duration').classList.remove('text-red-400');
    
    // Reset recording waveform
    const container = document.getElementById('recording-waveform');
    if (container) {
        container.innerHTML = Array(15).fill('<div class="rec-bar" style="height: 10%"></div>').join('');
    }
}

function hideRecordingOverlay() {
    document.getElementById('recording-overlay').classList.add('hidden');
    document.getElementById('media-actions').classList.remove('hidden');
    document.getElementById('message-input').classList.remove('hidden');
    document.getElementById('send-btn').classList.remove('hidden');
}

