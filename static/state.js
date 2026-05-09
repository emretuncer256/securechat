// ═══════════════════════════════════════════════════════════════
// App State & Auth
// ═══════════════════════════════════════════════════════════════

const AppState = {
    token: localStorage.getItem('token'),
    username: localStorage.getItem('username'),
    ws: null,
    allUsers: [],
    onlineUsers: new Set(),
    rooms: [],
    myRooms: [],
    activeChat: null,   // {type:'user'|'room', name:string}
    sessionKeys: {},    // {username_or_room: CryptoKey}
    publicKeys: {},     // {username: CryptoKey}
    pendingKeyExchanges: new Set(),
    messages: {},       // {chatId: [{from,text,time,sent}]}
    unread: {},         // {chatId: number}
    searchFilter: '',
};

// ── Auth ────────────────────────────────────────────────────────

async function apiRequest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (AppState.token) headers['Authorization'] = `Bearer ${AppState.token}`;
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Request failed');
    return data;
}

function switchAuthTab(tab) {
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('login-tab').classList.toggle('active', tab === 'login');
    document.getElementById('register-tab').classList.toggle('active', tab === 'register');
    clearAuthErrors();
}

function clearAuthErrors() {
    ['login-error', 'register-error', 'register-success'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.add('hidden');
        el.textContent = '';
    });
}

async function handleRegister(e) {
    e.preventDefault();
    clearAuthErrors();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const btn = document.getElementById('register-btn-text');
    const spinner = document.getElementById('register-spinner');
    try {
        btn.textContent = ''; spinner.classList.remove('hidden');
        await apiRequest('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
        document.getElementById('register-success').textContent = 'Account created! You can sign in now.';
        document.getElementById('register-success').classList.remove('hidden');
        setTimeout(() => switchAuthTab('login'), 1500);
    } catch (err) {
        document.getElementById('register-error').textContent = err.message;
        document.getElementById('register-error').classList.remove('hidden');
    } finally {
        btn.textContent = 'Create Account'; spinner.classList.add('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    clearAuthErrors();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn-text');
    const spinner = document.getElementById('login-spinner');
    try {
        btn.textContent = ''; spinner.classList.remove('hidden');
        const data = await apiRequest('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        AppState.token = data.access_token;
        AppState.username = data.username;
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('username', data.username);
        showChatScreen();
    } catch (err) {
        document.getElementById('login-error').textContent = err.message;
        document.getElementById('login-error').classList.remove('hidden');
    } finally {
        btn.textContent = 'Sign In'; spinner.classList.add('hidden');
    }
}

function handleLogout() {
    // Clear reconnect timer FIRST to prevent token=null reconnect spam
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    reconnectAttempts = 0;
    // Clear token before closing WS so onclose handler won't reconnect
    AppState.token = null;
    AppState.username = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    if (AppState.ws) { AppState.ws.close(); AppState.ws = null; }
    // Reset all transient state
    AppState.sessionKeys = {};
    AppState.publicKeys = {};
    AppState.messages = {};
    AppState.unread = {};
    AppState.activeChat = null;
    AppState.onlineUsers = new Set();
    AppState.allUsers = [];
    AppState.rooms = [];
    AppState.myRooms = [];
    AppState.pendingKeyExchanges = new Set();
    AppState.searchFilter = '';
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('chat-screen').classList.add('hidden');
}

// ── Screen Transitions ──────────────────────────────────────────

async function showChatScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('chat-screen').classList.remove('hidden');
    document.getElementById('current-username').textContent = AppState.username;
    document.getElementById('user-avatar').textContent = AppState.username[0].toUpperCase();
    // Compact sidebar avatar
    const compactAvatar = document.getElementById('compact-user-avatar');
    if (compactAvatar) compactAvatar.textContent = AppState.username[0].toUpperCase();

    await CryptoManager.generateRSAKeyPair();
    console.log('🔑 RSA key pair generated');
    connectWebSocket();
    fetchAllUsers();
}

async function fetchAllUsers() {
    try {
        const users = await apiRequest('/api/users');
        AppState.allUsers = users;
        renderUsersList();
    } catch (err) { console.error('Failed to fetch users:', err); }
}
