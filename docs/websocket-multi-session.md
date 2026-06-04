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

**Step 2 — Client mengirim `connect` (dengan device identity):**
```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 4,
    "client": {
      "id": "cli",
      "version": "1.0.0",
      "platform": "linux",
      "mode": "cli"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": { "token": "your-token" },
    "locale": "id-ID",
    "userAgent": "my-app/1.0.0",
    "device": {
      "id": "sha256-of-public-key",
      "publicKey": "base64url-encoded-ed25519-public-key",
      "signature": "base64url-encoded-ed25519-signature",
      "signedAt": 1737264000000,
      "nonce": "from-connect.challenge"
    }
  }
}
```

**Penting**: `client.id` dan `client.mode` hanya menerima nilai tertentu:

| Field | Valid Values |
|-------|-------------|
| `client.id` | `cli`, `webchat`, `gateway-client`, `test` |
| `client.mode` | `cli`, `node`, `backend`, `webchat` |

Nilai seperti `"operator"`, `"browser"`, custom string akan ditolak dengan `INVALID_REQUEST`.

**Step 3 — Gateway membalas `hello-ok`:**
```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 4,
    "server": { "version": "2026.5.28", "connId": "..." },
    "features": { "methods": ["..."], "events": ["..."] },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read", "operator.write"],
      "deviceToken": "..."
    },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    }
  }
}
```

**Catatan tentang scopes**: Shared token (`gateway.auth.token`) TIDAK otomatis memberikan operator scopes. Scopes (`operator.read`, `operator.write`, dll) hanya diberikan jika client menyertakan **device identity** yang valid (Ed25519 keypair + signature nonce). Tanpa device identity, `hello-ok.auth.scopes` akan kosong `[]` dan semua RPC yang membutuhkan scope akan gagal dengan `"missing scope: operator.xxx"`.

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

| Method | Params | Response Key |
|--------|--------|-------------|
| `sessions.list` | `{}` | `{ sessions: [...] }` (setiap row punya `key`, `label`, `displayName`) |
| `sessions.create` | `{ label: "..." }` | `{ key: "agent:main:dashboard:...", sessionId: "..." }` |
| `sessions.delete` | `{ key: "agent:main:..." }` | — |
| `sessions.reset` | `{ key: "agent:main:..." }` | — |

#### Chat

| Method | Params | Catatan |
|--------|--------|---------|
| `chat.send` | `{ sessionKey, message, idempotencyKey }` | `idempotencyKey` **wajib** (UUID/timestamp unik per pengiriman) |
| `chat.history` | `{ sessionKey }` | — |
| `chat.abort` | `{ sessionKey }` | — |

#### Subscription

| Method | Params |
|--------|--------|
| `sessions.subscribe` | `{}` |
| `sessions.messages.subscribe` | `{ key: "agent:main:..." }` |
| `sessions.messages.unsubscribe` | `{ key: "agent:main:..." }` |

**Perhatian**: Nama parameter tidak konsisten antar method:
- `sessions.*` (delete, reset, messages.subscribe) → pakai `key`
- `chat.*` (send, history, abort) → pakai `sessionKey`
- `chat.send` → message body pakai `message` (bukan `text`)
- `chat.send` → wajib sertakan `idempotencyKey`

### Device Identity & Signature

Untuk mendapatkan operator scopes, client WAJIB menyertakan device identity saat `connect`. Device identity terdiri dari:

1. **Ed25519 keypair** — generate sekali, simpan persistent
2. **Device ID** — `SHA-256(publicKeyRaw)` dalam hex
3. **Signature** — tanda tangan challenge nonce

**Format signature (v2):**
```
v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
```

Komponen dipisahkan dengan pipe `|`. Contoh:
```
v2|abc123...|cli|cli|operator|operator.read,operator.write|1737264000000|token_rahasia|nonce-from-challenge
```

Signature dihitung dengan `Ed25519.sign(privateKey, payload)` dan di-encode base64url.

**Flow pairing:**
1. **Pertama kali**: connect via `ws://127.0.0.1:18789` (loopback → auto-approve pairing) → simpan `deviceToken` dari `hello-ok.auth.deviceToken`
2. **Selanjutnya**: bisa connect via tunnel/remote dengan identity yang sudah paired
3. Jika device belum paired, koneksi via tunnel akan gagal dengan `"pairing required: device is not approved yet"`
4. Approve manual: `openclaw devices approve <requestId>`

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
  "payload": {
    "ok": true,
    "key": "agent:main:dashboard:abc-123",
    "sessionId": "abc-123",
    "entry": { "label": "Chat Pelanggan A", ... },
    "runStarted": false
  }
}
```

**2. Subscribe ke event streaming:**
```json
{
  "type": "req", "id": "102", "method": "sessions.messages.subscribe",
  "params": { "key": "agent:main:dashboard:abc-123" }
}
```

**3. Kirim chat (wajib idempotencyKey):**
```json
{
  "type": "req", "id": "103", "method": "chat.send",
  "params": {
    "sessionKey": "agent:main:dashboard:abc-123",
    "message": "Halo, apa kabar?",
    "idempotencyKey": "unique-id-123"
  }
}

// Response (non-blocking, mungkin tanpa payload)
{ "type": "res", "id": "103", "ok": true }
```

**4. Terima streaming event (urutan khas):**
```
event: session.message   → pesan user tersimpan di transcript
event: chat              → deltaText: "Hal" (streaming token)
event: chat              → deltaText: "o!"
event: chat              → deltaText: " Apa kabar?"
event: chat              → state: "final", message: { content: [...] }
event: session.message   → pesan assistant tersimpan (dengan usage, model, dll)
```

**5. Struktur event `chat`:**
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "idx-123",
    "sessionKey": "agent:main:dashboard:abc-123",
    "seq": 5,
    "state": "delta",
    "deltaText": "Halo!",
    "message": {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Halo! Apa kabar?" }
      ],
      "timestamp": 1737264000000
    }
  }
}
```

**6. Struktur event `session.message` (final):**
```json
{
  "type": "event",
  "event": "session.message",
  "payload": {
    "sessionKey": "agent:main:dashboard:abc-123",
    "message": {
      "role": "assistant",
      "content": [
        { "type": "thinking", "thinking": "User says hello..." },
        { "type": "text", "text": "Halo! Ada yang bisa dibantu?" }
      ],
      "model": "deepseek-v4-pro",
      "usage": { "input": 50, "output": 30, "totalTokens": 80 },
      "timestamp": 1737264000000
    },
    "messageId": "msg-456",
    "messageSeq": 2
  }
}
```

**Catatan**: Field `message.content` adalah **array of content blocks**, bukan string. Block bisa bertipe `"text"` (ada `.text`) atau `"thinking"` (ada `.thinking`). Gunakan hanya block dengan `type: "text"` untuk ditampilkan ke user.

### Event Types Penting

| Event | Deskripsi |
|-------|-----------|
| `chat` | Update streaming chat (`deltaText`, `message.content`, `state`) |
| `session.message` | Pesan tersimpan di transcript (final, dengan `content` array) |
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

### Implementasi Minimal Client (Node.js + TypeScript)

```typescript
import WebSocket from "ws";
import { webcrypto, createHash } from "node:crypto";

const { subtle } = webcrypto;
const TOKEN = "your-token";
const WS_URL = "wss://openclawdashboard.tokopawon.id";

interface StoredIdentity {
  deviceId: string;
  publicKeyBase64url: string;
  privateKeyJwk: JsonWebKey;
  deviceToken?: string;
}

async function getOrCreateIdentity(): Promise<{
  deviceId: string; publicKey: string; privateKey: CryptoKey;
}> {
  // Load from file atau generate baru
  const kp = await subtle.generateKey(
    { name: "Ed25519" }, true, ["sign", "verify"]
  ) as CryptoKeyPair;

  const pubRaw = Buffer.from(await subtle.exportKey("raw", kp.publicKey));
  const publicKey = pubRaw.toString("base64url");
  const deviceId = createHash("sha256").update(pubRaw).digest("hex");
  const privateKey = (kp as any).privateKey as CryptoKey;

  return { deviceId, publicKey, privateKey };
}

async function signChallenge(
  identity: { deviceId: string; publicKey: string; privateKey: CryptoKey },
  nonce: string,
  token: string
): Promise<{ signature: string; signedAt: number }> {
  const signedAt = Date.now();
  // v2 format: pipa-separated
  const payload = [
    "v2",
    identity.deviceId,
    "cli",           // client.id
    "cli",           // client.mode
    "operator",      // role
    "operator.read,operator.write",  // scopes (comma-separated)
    String(signedAt),
    token,
    nonce,
  ].join("|");

  const enc = new TextEncoder();
  const sig = Buffer.from(
    await subtle.sign(
      { name: "Ed25519" },
      identity.privateKey,
      enc.encode(payload)
    )
  ).toString("base64url");

  return { signature: sig, signedAt };
}

class OpenClawClient {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pendingRequests = new Map<string, {
    resolve: (v: unknown) => void; reject: (e: Error) => void;
  }>();
  private eventHandlers = new Map<string, Array<(p: unknown) => void>>();

  constructor(
    private url: string,
    private token: string,
    private identity: { deviceId: string; publicKey: string; privateKey: CryptoKey }
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 15_000);

      this.ws.on("message", async (data: Buffer) => {
        const frame = JSON.parse(data.toString());

        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = frame.payload.nonce;
          const { signature, signedAt } = await signChallenge(
            this.identity, nonce, this.token
          );

          this.ws!.send(JSON.stringify({
            type: "req", id: "connect-1", method: "connect",
            params: {
              minProtocol: 3, maxProtocol: 4,
              client: { id: "cli", version: "1.0.0", platform: "linux", mode: "cli" },
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              auth: { token: this.token },
              locale: "id-ID",
              userAgent: "my-app/1.0.0",
              device: {
                id: this.identity.deviceId,
                publicKey: this.identity.publicKey,
                signature,
                signedAt,
                nonce,
              },
            },
          }));
          return;
        }

        if (frame.type === "res") {
          const pending = this.pendingRequests.get(frame.id);
          if (pending) {
            this.pendingRequests.delete(frame.id);
            if (frame.ok) pending.resolve(frame.payload);
            else pending.reject(new Error(frame.error?.message));
          }

          if (frame.ok && frame.payload?.type === "hello-ok") {
            clearTimeout(timeout);
            resolve();
          }
          return;
        }

        if (frame.type === "event") {
          const handlers = this.eventHandlers.get(frame.event) || [];
          for (const h of handlers) h(frame.payload);
        }
      });

      this.ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    const id = String(++this.reqId) + "-" + Date.now();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 30_000);
      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  on(event: string, handler: (payload: unknown) => void): void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event)!.push(handler);
  }

  // --- High-level API ---

  async listSessions(): Promise<Array<{ key: string; label?: string; displayName?: string }>> {
    const result = await this.request("sessions.list") as any;
    return result?.sessions || [];
  }

  async createSession(label: string): Promise<string> {
    const result = await this.request("sessions.create", { label }) as any;
    return result?.key;  // response punya field "key", bukan "sessionKey"
  }

  async subscribeSession(key: string): Promise<void> {
    // sessions.messages.subscribe pakai "key", bukan "sessionKey"
    await this.request("sessions.messages.subscribe", { key });
  }

  async sendMessage(sessionKey: string, message: string): Promise<void> {
    // chat.send pakai "sessionKey" + "message" + "idempotencyKey"
    await this.request("chat.send", {
      sessionKey,
      message,
      idempotencyKey: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
    });
  }

  async deleteSession(key: string): Promise<void> {
    await this.request("sessions.delete", { key });
  }

  close(): void {
    if (this.ws) this.ws.close();
  }
}

// --- Usage ---

const identity = await getOrCreateIdentity();
const client = new OpenClawClient(WS_URL, TOKEN, identity);

await client.connect();
console.log("Connected!");

// Streaming chat handler
client.on("chat", (payload: any) => {
  if (payload.deltaText) {
    process.stdout.write(payload.deltaText);
  }
});

// Final message handler — extract text from content blocks
client.on("session.message", (payload: any) => {
  const msg = payload.message;
  if (!msg?.content) return;
  const text = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  if (text) console.log("\n[Final]:", text);
});

const sessionKey = await client.createSession("Chat Support");
await client.subscribeSession(sessionKey);
await client.sendMessage(sessionKey, "Halo, butuh bantuan!");
```

---

## 5. Ringkasan Kunci

| Hal | Detail |
|-----|--------|
| **Auth mode** | `token` (wajib untuk non-loopback) |
| **Port** | `18789` (default, single multiplexed WS + HTTP) |
| **Protocol** | WebSocket text frames, JSON payloads |
| **Handshake** | `connect.challenge` → `connect` request + device signature → `hello-ok` |
| **Device identity** | **Wajib** untuk dapat operator scopes. Ed25519 keypair, sign nonce v2 format |
| **Pairing** | Loopback auto-approve; tunnel/remote perlu approval (`openclaw devices approve`) |
| **client.id / client.mode** | Valid: `cli`, `webchat`, `gateway-client` / `cli`, `node`, `backend` |
| **Chat send** | Non-blocking, wajib `idempotencyKey`, response streaming via `chat` events |
| **Message content** | `content: [{ type: "text", text: "..." }, { type: "thinking", thinking: "..." }]` |
| **Param inconsistency** | `sessions.*` pakai `key`, `chat.*` pakai `sessionKey` |
| **Session isolation** | Setiap session key adalah percakapan terpisah |
| **Keepalive** | Event `tick` setiap 15 detik |
| **Max payload** | ~25 MB per frame, ~50 MB buffered |

---

## 6. Common Gotchas

### Parameter Names

Setiap RPC method punya nama parameter berbeda — **jangan asumsi konsisten**:

| Method | Param untuk session | Param untuk message |
|--------|-------------------|-------------------|
| `sessions.create` | `{ label }` | — |
| `sessions.delete` | `{ key }` | — |
| `sessions.reset` | `{ key }` | — |
| `sessions.messages.subscribe` | `{ key }` | — |
| `chat.send` | `{ sessionKey }` | `{ message }` + `{ idempotencyKey }` |
| `chat.history` | `{ sessionKey }` | — |
| `chat.abort` | `{ sessionKey }` | — |

### Scopes & Device Pairing

- Shared token saja → scopes kosong `[]` → tidak bisa `sessions.create`, `chat.send`, dll
- **Harus** sertakan device identity (Ed25519 keypair + sign nonce) untuk dapat scopes
- Loopback auto-approve; tunnel perlu approval manual atau pairing via localhost dulu
- Setelah paired, device identity bisa digunakan untuk koneksi dari mana saja (localhost/tunnel)

### Message Content Structure

Gateway mengembalikan pesan dengan struktur `content` array:
```json
"content": [
  { "type": "thinking", "thinking": "internal reasoning..." },
  { "type": "text", "text": "Hello world!" }
]
```
**Jangan** akses `.text` langsung — iterasi content blocks dan filter `type: "text"`.

---

## 7. Referensi Dokumentasi

Gunakan MCP `openclaw-docs` untuk membaca section terkait:
- `"Gateway protocol | Framing"` — detail handshake dan framing
- `"Gateway protocol | Exec approvals"` — daftar lengkap RPC methods/events
- `"Gateway architecture | Pairing + local trust"` — wire protocol summary
- `"Gateway protocol | TLS + pinning"` — device identity + signature format
- `"Remote access | Related"` — aturan keamanan remote/VPN
