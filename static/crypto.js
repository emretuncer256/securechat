// ═══════════════════════════════════════════════════════════════
// CryptoManager — Web Crypto API (RSA-2048 + AES-256-CBC)
// ═══════════════════════════════════════════════════════════════

const CryptoManager = {
    rsaKeyPair: null,

    async generateRSAKeyPair() {
        this.rsaKeyPair = await crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
            true, ["encrypt", "decrypt"]
        );
        return this.rsaKeyPair;
    },

    async exportPublicKey() {
        if (!this.rsaKeyPair) return null;
        return await crypto.subtle.exportKey("jwk", this.rsaKeyPair.publicKey);
    },

    async importPublicKey(jwk) {
        return await crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    },

    async generateAESKey() {
        return await crypto.subtle.generateKey({ name: "AES-CBC", length: 256 }, true, ["encrypt", "decrypt"]);
    },

    async exportAESKey(key) {
        const raw = await crypto.subtle.exportKey("raw", key);
        return btoa(String.fromCharCode(...new Uint8Array(raw)));
    },

    async importAESKey(b64) {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, true, ["encrypt", "decrypt"]);
    },

    async encryptAESKeyWithRSA(aesKey, rsaPublicKey) {
        const rawAES = await crypto.subtle.exportKey("raw", aesKey);
        const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPublicKey, rawAES);
        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    },

    async decryptAESKeyWithRSA(encryptedB64) {
        const data = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
        const rawAES = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, this.rsaKeyPair.privateKey, data);
        return await crypto.subtle.importKey("raw", rawAES, { name: "AES-CBC" }, true, ["encrypt", "decrypt"]);
    },

    async encryptMessage(plaintext, aesKey) {
        const iv = crypto.getRandomValues(new Uint8Array(16));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aesKey, encoded);
        const combined = new Uint8Array(16 + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), 16);
        return btoa(String.fromCharCode(...combined));
    },

    async decryptMessage(payload, aesKey) {
        const data = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        const iv = data.slice(0, 16);
        const ciphertext = data.slice(16);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, ciphertext);
        return new TextDecoder().decode(decrypted);
    },

    // ── Binary Data Encryption (Images, Audio) ─────────────────

    async encryptBinary(arrayBuffer, aesKey) {
        const iv = crypto.getRandomValues(new Uint8Array(16));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aesKey, arrayBuffer);
        const combined = new Uint8Array(16 + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), 16);
        // Encode in chunks to avoid call-stack overflow on large files
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < combined.length; i += CHUNK) {
            binary += String.fromCharCode(...combined.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    },

    async decryptBinary(payload, aesKey) {
        const raw = atob(payload);
        const data = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
        const iv = data.slice(0, 16);
        const ciphertext = data.slice(16);
        return await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, ciphertext);
    }
};
