// ═══════════════════════════════════════════════════════════════
// SecureChat — Main Entry Point
// Load order: crypto.js → state.js → websocket.js → ui.js → app.js
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 SecureChat initialized');
    console.log('🔐 Using Web Crypto API for RSA-2048 + AES-256-CBC');

    // Initialize AOS animations
    if (typeof AOS !== 'undefined') AOS.init({ once: true });

    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Auto-login if a valid token exists from a previous session
    if (AppState.token && AppState.username) {
        showChatScreen();
    }
});
