# OpenClaw WebSocket Multi-Session Chat Setup

## 1. Konfigurasi Gateway

Gateway OpenClaw menggunakan **satu port multiplexed** (default `18789`) untuk WebSocket dan HTTP. Karena menggunakan Cloudflare Tunnel, gateway tetap bind ke loopback dan tunnel yang mengekspos ke publik.

### `~/.openclaw/openclaw.json`

```json5
{
  gateway: {
    mode: "local",
    port: 18789,
    bind: "loopback",            // tetap loopback, tunnel yang expose
    auth: {
      mode: "token",             // wajib untuk non-loopback access
      token: "your-secret-token",
    },
    controlUi: {
      enabled: true,
      allowedOrigins: ["https://openclawdashboard.tokopawon.id"],
    },
    // Karena via Cloudflare Tunnel (public), harus wss://
    // Cloudflare sudah handle TLS termination
  },
}
```

### Bind Modes

| Mode | Deskripsi |
|------|-----------|
| `loopback` | `127.0.0.1` only (default, paling aman) |
| `lan` | `0.0.0.0` (semua interface) |
| `tailnet` | Tailscale IP only |
| `custom` | Host kustom via `customBindHost` |

### Auth Modes

| Mode | Deskripsi |
|------|-----------|
| `token` | Shared token (default) |
| `password` | Shared password |
| `trusted-proxy` | Delegasi ke reverse proxy identity-aware |
| `none` | Tanpa auth (hanya untuk loopback trusted) |

### Catatan Keamanan

- Plaintext `ws://` hanya diterima untuk loopback, LAN, link-local, `.local`, `.ts.net`, dan Tailscale CGNAT
- Public remote hosts **harus** menggunakan `wss://`
- Non-loopback binds wajib menggunakan gateway auth

---

## 2. WebSocket Protocol (Wire Protocol)

### Handshake Flow

**Step 1 — Gateway mengirim challenge:**
```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": { "nonce": "...", "ts": 1737264000000 }
}
```

**Step 2 — Client mengirim `connect`:**
```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 4,
    "client": {
      "id": "my-app",
      "version": "1.0.0",
      "platform": "browser",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": { "token": "your-secret-token" },
    "locale": "id-ID",
    "userAgent": "my-app/1.0.0"
  }
}
```

**Step 3 — Gateway membalas `hello-ok`:**
```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 4,
    "server": { "version": "...", "connId": "..." },
    "features": { "methods": ["..."], "events": ["..."] },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read", "operator.write"]
    },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    }
  }
}
```

### Format Frame

| Jenis | Struktur | Deskripsi |
|-------|----------|-----------|
| **Request** | `{ type: "req", id, method, params }` | Kirim RPC call |
| **Response** | `{ type: "res", id, ok, payload \| error }` | Hasil RPC call |
| **Event** | `{ type: "event", event, payload, seq?, stateVersion? }` | Push dari server |

---

## 3. Multi-Session Chat Flow

### Daftar RPC Methods Penting

#### Session Management

| Method | Deskripsi |
|--------|-----------|
| `sessions.list` | List semua session |
| `sessions.create` | Buat session baru |
| `sessions.describe` | Detail satu session |
| `sessions.patch` | Update metadata/overrides session |
| `sessions.reset` | Reset session |
| `sessions.delete` | Hapus session |
| `sessions.compact` | Kompaksi session (ringkas context) |

#### Chat

| Method | Deskripsi |
|--------|-----------|
| `chat.send` | Kirim pesan (non-blocking, streaming via events) |
| `chat.history` | Ambil history transcript (display-normalized) |
| `chat.abort` | Batalkan run yang sedang aktif |
| `chat.inject` | Sisipkan catatan assistant ke transcript |
| `chat.message.get` | Baca satu transcript entry secara penuh |

#### Subscription

| Method | Deskripsi |
|--------|-----------|
| `sessions.subscribe` | Subscribe perubahan index session |
| `sessions.unsubscribe` | Unsubscribe perubahan index session |
| `sessions.messages.subscribe` | Subscribe event transcript per session |
| `sessions.messages.unsubscribe` | Unsubscribe event transcript per session |

### Contoh Flow Chat

**1. Buat session baru:**
```json
// Request
{
  "type": "req", "id": "101", "method": "sessions.create",
  "params": { "label": "Chat Pelanggan A" }
}

// Response
{
  "type": "res", "id": "101", "ok": true,
  "payload": { "sessionKey": "abc-123", "label": "Chat Pelanggan A", "agentId": "main", ... }
}
```

**2. Subscribe ke event streaming:**
```json
{
  "type": "req", "id": "102", "method": "sessions.messages.subscribe",
  "params": { "sessionKey": "abc-123" }
}
```

**3. Kirim chat:**
```json
{
  "type": "req", "id": "103", "method": "chat.send",
  "params": { "sessionKey": "abc-123", "text": "Halo, apa kabar?" }
}

// Response (non-blocking)
{ "type": "res", "id": "103", "ok": true, "payload": { "runId": "run-456", "status": "started" } }
```

**4. Terima streaming event (urutan khas):**
```
event: session.operation  →  status: "thinking"
event: chat               →  deltaText: "Hal" (streaming token)
event: chat               →  deltaText: "o!"
event: chat               →  message: "Halo! Apa kabar?" (cumulative)
event: session.tool       →  tool call progress (jika agent pakai tool)
event: session.message    →  pesan tersimpan di transcript
event: session.operation  →  status: "completed"
```

**5. Ambil history:**
```json
{
  "type": "req", "id": "104", "method": "chat.history",
  "params": { "sessionKey": "abc-123" }
}
```

**6. Abort run yang sedang berjalan:**
```json
{
  "type": "req", "id": "105", "method": "chat.abort",
  "params": { "sessionKey": "abc-123" }
}
```

### Event Types Penting

| Event | Deskripsi |
|-------|-----------|
| `chat` | Update streaming chat (deltaText/message) |
| `session.message` | Pesan baru tersimpan di transcript |
| `session.operation` | Status operasi session (thinking/completed) |
| `session.tool` | Tool call progress |
| `sessions.changed` | Index session berubah |
| `tick` | Keepalive (setiap 15 detik) |
| `health` | Snapshot kesehatan gateway |
| `shutdown` | Notifikasi gateway shutdown |

---

## 4. Arsitektur Client-Server

```
┌─────────────────────┐       wss://        ┌──────────────┐      ws://       ┌─────────────┐
│  Custom App Client  │ ◄──────────────────► │  Cloudflare  │ ◄──────────────► │  OpenClaw   │
│  (Browser/Node.js)  │    WebSocket RPC     │   Tunnel     │    localhost     │  Gateway    │
│                     │                      │              │                  │  :18789     │
└─────────────────────┘                      └──────────────┘                  └─────────────┘
```

### Implementasi Minimal Client (JavaScript)

```javascript
const TOKEN = "your-secret-token";
const WS_URL = "wss://openclawdashboard.tokopawon.id";

class OpenClawClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.reqId = 0;
    this.pendingRequests = new Map();
    this.eventHandlers = new Map();
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onmessage = (msg) => {
        const frame = JSON.parse(msg.data);

        // Handle challenge
        if (frame.event === "connect.challenge") {
          this.ws.send(JSON.stringify({
            type: "req",
            id: String(Date.now()),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 4,
              client: {
                id: "my-chat-app",
                version: "1.0.0",
                platform: "browser",
                mode: "operator",
              },
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              auth: { token: this.token },
              locale: "id-ID",
              userAgent: "my-chat-app/1.0.0",
            },
          }));
          return;
        }

        // Handle responses
        if (frame.type === "res") {
          const pending = this.pendingRequests.get(frame.id);
          if (pending) {
            this.pendingRequests.delete(frame.id);
            if (frame.ok) {
              pending.resolve(frame.payload);
            } else {
              pending.reject(frame.error);
            }
          }
          return;
        }

        // Handle events (streaming)
        if (frame.type === "event") {
          const handlers = this.eventHandlers.get(frame.event) || [];
          handlers.forEach((fn) => fn(frame.payload));
        }
      };

      this.ws.onopen = () => {
        // Wait for hello-ok
        const checkConnected = setInterval(() => {
          if (this.connected) {
            clearInterval(checkConnected);
            resolve();
          }
        }, 50);

        // Timeout after 10s
        setTimeout(() => {
          clearInterval(checkConnected);
          if (!this.connected) reject(new Error("Connection timeout"));
        }, 10000);

        // Listen for hello-ok
        this.onResponse((payload) => {
          if (payload.type === "hello-ok") {
            this.connected = true;
            this.features = payload.features;
          }
          return false;
        });
      };

      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => { this.connected = false; };
    });
  }

  // Internal: track response for a req id
  _registerPending(id) {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  // Internal: listen for a specific response type (one-shot)
  onResponse(fn) {
    const orig = this.ws.onmessage;
    this.ws.onmessage = (msg) => {
      const frame = JSON.parse(msg.data);
      if (frame.type === "res" && fn(frame.payload) === true) {
        this.ws.onmessage = orig;
      }
      if (orig) orig(msg);
    };
  }

  // Listen to event stream
  on(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);
  }

  // Send a request and wait for response
  async request(method, params = {}) {
    const id = String(Date.now()) + "-" + (++this.reqId);
    const promise = this._registerPending(id);
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return promise;
  }

  // --- High-level API ---

  async createSession(label) {
    const result = await this.request("sessions.create", { label });
    return result.sessionKey;
  }

  async listSessions() {
    const result = await this.request("sessions.list");
    return result.sessions || [];
  }

  async sendMessage(sessionKey, text) {
    const result = await this.request("chat.send", { sessionKey, text });
    return result; // { runId, status: "started" }
  }

  async getHistory(sessionKey) {
    const result = await this.request("chat.history", { sessionKey });
    return result.messages || [];
  }

  async abort(sessionKey) {
    return this.request("chat.abort", { sessionKey });
  }

  async subscribeSession(sessionKey) {
    return this.request("sessions.messages.subscribe", { sessionKey });
  }

  async deleteSession(sessionKey) {
    return this.request("sessions.delete", { sessionKey });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// --- Usage Example ---

const client = new OpenClawClient(WS_URL, TOKEN);

await client.connect();
console.log("Connected! Features:", client.features.methods.length, "methods");

// Listen to all chat events
client.on("chat", (payload) => {
  if (payload.deltaText) {
    process.stdout.write(payload.deltaText);
  }
});

// Listen to session events
client.on("session.operation", (payload) => {
  console.log("\n[Status:", payload.status, "]");
});

// Create a session
const sessionKey = await client.createSession("Chat Support Pelanggan A");

// Subscribe to session messages
await client.subscribeSession(sessionKey);

// Send a message
await client.sendMessage(sessionKey, "Halo, saya butuh bantuan!");
```

---

## 5. Ringkasan Kunci

| Hal | Detail |
|-----|--------|
| **Auth mode** | `token` (wajib untuk non-loopback) |
| **Port** | `18789` (default, single multiplexed WS + HTTP) |
| **Protocol** | WebSocket text frames, JSON payloads |
| **Handshake** | `connect.challenge` → `connect` request → `hello-ok` |
| **Chat send** | Non-blocking, response streaming via `chat` events |
| **Session isolation** | Setiap `sessionKey` adalah percakapan terpisah |
| **Agent multi-session** | Gunakan `agents.defaults.models` + `session.dmScope` |
| **Keepalive** | Event `tick` setiap 15 detik |
| **Max payload** | ~25 MB per frame, ~50 MB buffered |

---

## 6. Advanced: Device Pairing (untuk client persistent)

Untuk aplikasi client yang perlu persistent auth (seperti Android app), gunakan **device pairing** daripada shared token:

```json
{
  "type": "req",
  "id": "...",
  "method": "connect",
  "params": {
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": { "token": "..." },
    "device": {
      "id": "device_fingerprint",
      "publicKey": "...",
      "signature": "...",
      "signedAt": 1737264000000,
      "nonce": "..."
    }
  }
}
```

Gateway akan mengembalikan `deviceToken` di `hello-ok.auth` yang bisa disimpan client untuk koneksi selanjutnya.

Pairing management:
```bash
openclaw devices list
openclaw devices approve <requestId>
```

---

## 7. Referensi Dokumentasi

Gunakan MCP `openclaw-docs` untuk membaca section terkait:
- `"Gateway protocol | Framing"` — detail handshake dan framing
- `"Gateway protocol | Exec approvals"` — daftar lengkap RPC methods/events
- `"Gateway | Manage the Gateway service"` — manajemen gateway
- `"Gateway architecture | Pairing + local trust"` — wire protocol summary
- `"Remote access | Related"` — aturan keamanan remote/VPN
- `"Control UI | PWA install and web push"` — chat behavior semantics
- `"Android app | Assistant entrypoints"` — contoh koneksi client node
