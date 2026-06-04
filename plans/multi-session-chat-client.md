# Rencana: Multi-Session Chat CLI Client

## Tech Stack

| Komponen | Pilihan | Alasan |
|----------|---------|--------|
| Runtime | Node.js v24 (tersedia) | ESM native, WebSocket API |
| Package manager | Yarn 1.22 (tersedia) | sesuai permintaan |
| Language | TypeScript | type-safe protocol |
| WebSocket | `ws` | Node.js WS client |
| TUI | `blessed` | mature, ringan, tanpa React dependency |
| Config | `dotenv` | env vars untuk token/URL |

## Struktur Proyek

```
multi-session-chat/
├── package.json
├── tsconfig.json
├── .env.example              # Template: WS_URL, TOKEN
├── .gitignore
├── src/
│   ├── index.ts              # Entry point, CLI arg parsing
│   ├── config.ts             # Load .env, validate config
│   ├── types/
│   │   └── protocol.ts       # Type defs untuk semua frame (req/res/event)
│   ├── client/
│   │   ├── gateway-client.ts # Core: koneksi WS, handshake, request/response, reconnection
│   │   └── errors.ts         # Custom errors (AuthError, TimeoutError, dll)
│   ├── session/
│   │   ├── manager.ts        # Multi-session orchestration (CRUD, subscribe, event routing)
│   │   └── store.ts          # File JSON persistence (~/.multichat/sessions.json)
│   └── tui/
│       ├── app.ts            # Bootstrap blessed screen + layout
│       ├── session-list.ts   # Left panel: daftar session + shortcuts
│       ├── chat-box.ts       # Center: streaming messages display
│       ├── input-bar.ts      # Bottom: composer input
│       └── status-bar.ts     # Bottom: status koneksi, session info
```

## Layout TUI

```
┌─Sessions──────────────┬──────────────────────────────────────┐
│ ● Chat Pelanggan A    │ [12:00] You: Halo, butuh bantuan     │
│   Chat Pelanggan B    │ [12:00] Agent: Halo! Ada yang bisa   │
│ ○ Support Teknis      │          saya bantu?                 │
│                       │ [12:01] You: Saya error saat login   │
│                       │ [12:01] Agent: Baik, coba saya...█░░░│
│ [N]ew [D]el [R]eset  │                                      │
│────────────────────── │──────────────────────────────────────│
│ > Ketik pesan...                                           │
│ ● Connected | Session: abc-123 | [Tab] switch [^N] new [^C] quit │
└─────────────────────────────────────────────────────────────┘
```

## Flow Aplikasi

```
1. Startup → load .env → validasi WS_URL + TOKEN
2. GatewayClient.connect() → challenge → handshake → hello-ok
3. SessionManager.load() → sessions.list() dari gateway + merge dari local store
4. TUI render → session-list + chat-box + input-bar
5. User pilih session → subscribe → chat.history → render
6. User kirim pesan → chat.send() → streaming event → render real-time
7. Clean shutdown → unsubscribe semua → WS close → save sessions.json
```

## Package Dependencies

```json
{
  "dependencies": {
    "ws": "^8.18.0",
    "blessed": "^0.1.81",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/ws": "^8.5.0",
    "@types/blessed": "^0.1.25",
    "tsx": "^4.19.0"
  }
}
```

## Scripts

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Konfigurasi (`.env`)

```env
OPENCLAW_WS_URL=wss://openclawdashboard.tokopawon.id
OPENCLAW_TOKEN=your-secret-token
```

## Shortcut Keyboard

| Key | Action |
|-----|--------|
| `Tab` / `j`/`k` | Pindah session |
| `Ctrl+N` | Buat session baru |
| `Ctrl+D` | Hapus session |
| `Ctrl+R` | Reset session |
| `Ctrl+L` | Bersihkan layar |
| `Ctrl+C` / `q` | Keluar |

## Referensi

- `docs/websocket-multi-session.md` — Protokol dan contoh client
- MCP `openclaw-docs`:
  - `"Gateway protocol | Framing"` — detail handshake
  - `"Gateway protocol | Exec approvals"` — daftar RPC methods/events
  - `"Gateway architecture | Pairing + local trust"` — wire protocol summary
