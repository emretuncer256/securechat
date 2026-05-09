# 🔐 SecureChat — End-to-End Encrypted Chat Application

> **Computer Networks Course Project**
> A real-time, browser-based chat application featuring hybrid RSA-2048 / AES-256-CBC end-to-end encryption. The server operates as a **cryptographically blind relay** — it never sees, logs, or processes message content or session keys in plaintext.

![Python](https://img.shields.io/badge/Python-3.14+-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136+-009688?logo=fastapi&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

- **Hybrid E2EE Encryption** — RSA-2048 for key exchange, AES-256-CBC for message encryption, all using the browser's native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) (no external crypto libraries)
- **Blind Relay Architecture** — The server routes encrypted payloads without ever accessing plaintext content
- **Ephemeral Media (Voice & Photo)** — Send end-to-end encrypted photos and voice recordings with real-time animated audio waveforms
- **Real-time WebSocket Communication** — Instant message delivery with automatic reconnection and exponential backoff
- **Private & Group Messaging** — 1-to-1 direct messages and multi-user chat rooms with per-room encryption keys
- **Zero Persistent Message Storage** — Messages are strictly ephemeral; only user credentials are stored in SQLite
- **Premium Modern UI** — A stunning landing page, glassmorphism-inspired design, dynamic CSS animations (AOS.js), and interactive UI elements
- **User Presence Tracking** — Real-time online/offline status indicators

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                     │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌───────────────────────┐   │
│  │ crypto.js│   │ state.js │   │    websocket.js       │   │
│  │ RSA-2048 │   │ App State│   │ WS Connection Manager │   │
│  │ AES-256  │   │ Auth Mgr │   │ Key Exchange Protocol │   │
│  └──────────┘   └──────────┘   └───────────────────────┘   │
│  ┌──────────┐   ┌──────────────────────────────────────┐   │
│  │  ui.js   │   │     index.html + style.css           │   │
│  │ Renderer │   │  Tailwind CSS + Glassmorphism UI     │   │
│  └──────────┘   └──────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │  WebSocket (ws://)
                           │  REST API (HTTP)
┌──────────────────────────┴──────────────────────────────────┐
│                     SERVER (FastAPI)                         │
│                                                             │
│  ┌──────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │ auth.py  │   │ websocket_     │   │    state.py      │  │
│  │ JWT Auth │   │ handler.py     │   │  In-Memory State │  │
│  │ bcrypt   │   │ Blind Relay    │   │  Connections/Keys│  │
│  └──────────┘   └────────────────┘   └──────────────────┘  │
│  ┌──────────┐   ┌──────────────────────────────────────┐   │
│  │models.py │   │  database.py (SQLite — users only)   │   │
│  └──────────┘   └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🔒 Security Model

### Encryption Flow

```
1. User logs in → Browser generates RSA-2048 key pair (volatile, lost on refresh)
2. RSA public key registered on server (in-memory only)
3. User A wants to message User B:
   a. A requests B's RSA public key from server
   b. A generates a random AES-256-CBC session key
   c. A encrypts the AES key with B's RSA public key
   d. Server relays the encrypted AES key to B (blind relay)
   e. B decrypts the AES key with their RSA private key
4. Messages encrypted with AES-256-CBC:
   - Random 16-byte IV generated per message
   - IV prepended to Base64-encoded ciphertext
   - Server forwards the opaque blob without inspection
```

### Security Guarantees

| Property | Implementation |
|----------|---------------|
| **Confidentiality** | AES-256-CBC with per-message random IV |
| **Key Exchange** | RSA-2048 (OAEP + SHA-256) |
| **Authentication** | JWT tokens with bcrypt password hashing |
| **Forward Secrecy** | New RSA keys on every page load/reconnection |
| **Server Blindness** | Server never accesses plaintext or AES keys |
| **No Persistence** | Messages exist only in browser memory |

## 📁 Project Structure

```
ChatApp/
├── main.py                 # FastAPI app entry point, CORS, static mount
├── auth.py                 # REST API: register, login, user list (JWT + bcrypt)
├── models.py               # Pydantic request/response schemas
├── database.py             # Async SQLite operations (users table only)
├── state.py                # In-memory state: connections, keys, rooms
├── websocket_handler.py    # WebSocket endpoint, event routing, blind relay
├── static/
│   ├── index.html          # SPA: auth screen + chat interface
│   ├── style.css           # Custom CSS: glassmorphism, animations, scrollbar
│   ├── crypto.js           # Web Crypto API: RSA-2048 + AES-256-CBC
│   ├── state.js            # Client-side auth & application state
│   ├── websocket.js        # WebSocket manager, key exchange, messaging
│   ├── ui.js               # DOM rendering, toasts, modals
│   └── app.js              # Entry point / initialization
├── pyproject.toml          # Project metadata & dependencies
└── uv.lock                 # Dependency lock file
```

## 🚀 Getting Started

### Prerequisites

- **Python 3.14+**
- **[uv](https://docs.astral.sh/uv/)** — Fast Python package manager

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/ChatApp.git
cd ChatApp

# Install dependencies (uv will create a virtual environment automatically)
uv sync
```

### Running the Server

```bash
uv run uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000** in your browser.

### Testing E2EE Messaging

1. Open **two browser windows** (or one regular + one incognito)
2. Register two different accounts (e.g., `alice` and `bob`)
3. Log in with each account in separate windows
4. Click on a user in the sidebar to start a private chat
5. Messages are encrypted in the sender's browser and decrypted in the receiver's browser — the server never sees the plaintext

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Uvicorn, Python 3.14 |
| **Database** | SQLite (via aiosqlite) — users only |
| **Auth** | JWT (python-jose) + bcrypt |
| **Real-time** | Native WebSocket (FastAPI) |
| **Frontend** | Vanilla JavaScript (ES6+) |
| **Styling** | Tailwind CSS (CDN) + Custom CSS |
| **Encryption** | Web Crypto API (RSA-OAEP, AES-CBC) |
| **Icons** | Lucide Icons |
| **Animations** | AOS.js (Animate on Scroll) |
| **Package Mgr** | uv |

## 📝 API Reference

### REST Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/register` | Create a new user account | No |
| `POST` | `/api/login` | Authenticate and receive JWT | No |
| `GET` | `/api/users` | List all users with online status | Bearer |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `key_register` | Client → Server | Register RSA public key |
| `key_request` | Client → Server | Request a user's public key |
| `key_exchange` | Bidirectional | Relay encrypted AES session key |
| `message` | Bidirectional | Relay encrypted private message |
| `create_room` | Client → Server | Create a new chat room |
| `invite_to_room` | Client → Server | Invite a user to a room |
| `room_message` | Bidirectional | Relay encrypted room message |
| `room_key_exchange` | Client → Server | Distribute room AES keys |
| `user_online` / `user_offline` | Server → Client | Presence updates |
| `init_state` | Server → Client | Initial state on connection |

## ⚠️ Limitations

- **Local Network Only** — Designed for local development; no HTTPS/WSS configuration
- **No Message Persistence** — All messages are lost when the browser tab is closed (by design)
- **Volatile Keys** — RSA key pairs are regenerated on every page refresh
- **Single Server** — No horizontal scaling; in-memory state is per-process

## 📄 License

This project is developed as part of a **Computer Networks** university course. Feel free to use it for educational purposes.
