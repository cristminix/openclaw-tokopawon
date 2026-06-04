import type { SessionRow } from "./types";

type ReqEntry = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type EventHandler = (payload: unknown) => void;

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface Identity {
  deviceId: string;
  publicKeyBase64url: string;
  privateKey: CryptoKey;
  deviceToken?: string;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<string, ReqEntry>();
  private handlers = new Map<string, EventHandler[]>();
  private _connected = false;
  private url: string;
  private token: string;
  private identity: Identity | null;

  constructor(url: string, token: string, identity: Identity | null) {
    this.url = url;
    this.token = token;
    this.identity = identity;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {};

      ws.onmessage = async (e: MessageEvent) => {
        let frame: { type: string; event?: string; id?: string; ok?: boolean; payload?: unknown; error?: { code: string; message: string } };
        try {
          frame = JSON.parse(e.data);
        } catch {
          return;
        }

        if (frame.type === "event" && frame.event === "connect.challenge") {
          await this.handleChallenge(frame.payload as { nonce: string; ts: number });
          return;
        }

        if (frame.type === "res") {
          const entry = this.pending.get(frame.id || "");
          if (entry) {
            this.pending.delete(frame.id || "");
            if (frame.ok) {
              entry.resolve(frame.payload);
            } else {
              entry.reject(new Error(frame.error?.message || "RPC error"));
            }
          }

          const pl = frame.payload as Record<string, unknown> | undefined;
          if (frame.ok && pl?.type === "hello-ok") {
            this._connected = true;
            clearTimeout(timeout);
            settled = true;
            resolve();
          }
          return;
        }

        if (frame.type === "event") {
          const h = this.handlers.get(frame.event || "");
          if (h) for (const fn of h) fn(frame.payload);
        }
      };

      ws.onerror = () => {
        if (settled) return;
        clearTimeout(timeout);
        settled = true;
        reject(new Error("WebSocket error"));
      };

      ws.onclose = () => {
        this._connected = false;
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error("Connection closed"));
        }
      };
    });
  }

  private async handleChallenge(challenge: { nonce: string; ts: number }): Promise<void> {
    const nonce = challenge.nonce;
    const signedAt = Date.now();

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 4,
      client: { id: "cli", version: "1.0.0", platform: "browser", mode: "cli" },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.token },
      locale: "id-ID",
      userAgent: "multi-session-chat-web/1.0.0",
    };

    if (this.identity) {
      const payload = [
        "v2",
        this.identity.deviceId,
        "cli", "cli",
        "operator",
        "operator.read,operator.write",
        String(signedAt),
        this.token,
        nonce,
      ].join("|");

      const enc = new TextEncoder();
      const sigBytes = await crypto.subtle.sign(
        { name: "Ed25519" },
        this.identity.privateKey,
        enc.encode(payload)
      );
      const sigArr = new Uint8Array(sigBytes);
      const signature = btoa(String.fromCharCode(...sigArr))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      params.device = {
        id: this.identity.deviceId,
        publicKey: this.identity.publicKeyBase64url,
        signature,
        signedAt,
        nonce,
      };
    }

    this.send({ type: "req", id: "connect-1", method: "connect", params });
  }

  private send(frame: { type: string; id: string; method: string; params: unknown }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    this.ws.send(JSON.stringify(frame));
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this._connected) throw new Error("Not connected");
    const id = String(++this.reqId) + "-" + Date.now();

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);
      this.send({ type: "req", id, method, params });
    });
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const h = this.handlers.get(event);
    if (h) {
      const idx = h.indexOf(handler);
      if (idx >= 0) h.splice(idx, 1);
    }
  }

  async listSessions(): Promise<SessionRow[]> {
    const r = await this.request("sessions.list") as { sessions?: SessionRow[] };
    return r?.sessions || [];
  }

  async createSession(label: string): Promise<{ key: string }> {
    return this.request("sessions.create", { label }) as Promise<{ key: string }>;
  }

  async subscribeSession(key: string): Promise<void> {
    await this.request("sessions.messages.subscribe", { key });
  }

  async sendMessage(sessionKey: string, message: string): Promise<void> {
    await this.request("chat.send", {
      sessionKey,
      message,
      idempotencyKey: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
    });
  }

  async deleteSession(key: string): Promise<void> {
    await this.request("sessions.delete", { key });
  }

  async resetSession(key: string): Promise<void> {
    await this.request("sessions.reset", { key });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    for (const [, e] of this.pending) {
      try { e.reject(new Error("Connection closed")); } catch {}
    }
    this.pending.clear();
  }
}

export function extractText(message: { role?: string; content?: unknown; text?: unknown; message?: unknown; deltaText?: string }): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    const blocks = message.content as Array<{ type: string; text?: string }>;
    return blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("");
  }
  if (typeof message.text === "string") return message.text;
  if (typeof message.message === "string") return message.message;
  if (typeof message.deltaText === "string") return message.deltaText;
  return "";
}
