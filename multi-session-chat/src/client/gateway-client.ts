import WebSocket from "ws";
import { webcrypto } from "node:crypto";
import {
  ConnectChallenge,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  SessionListResult,
  SessionCreateResult,
  ChatSendResult,
  ChatHistoryResult,
  ChatMessage,
} from "../types/protocol.js";
import { AuthError, TimeoutError, ConnectionError, ProtocolError } from "./errors.js";

const { subtle } = webcrypto;

export interface DeviceIdentity {
  deviceId: string;
  publicKeyBase64url: string;
  privateKey: webcrypto.CryptoKey;
  deviceToken?: string;
}

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Array<(payload: unknown) => void>>();
  private _connected = false;
  private _features: { methods: string[]; events: string[] } | null = null;
  private _policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number } | null = null;
  private _reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 2000;
  private url: string;
  private token: string;
  private identity: DeviceIdentity | null;
  private onDeviceTokenUpdated: ((deviceToken: string) => void) | null = null;
  private intentionalClose = false;

  constructor(url: string, token: string, identity: DeviceIdentity | null = null) {
    this.url = url;
    this.token = token;
    this.identity = identity;
  }

  get connected(): boolean {
    return this._connected;
  }

  get features(): { methods: string[]; events: string[] } | null {
    return this._features;
  }

  get policy(): { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number } | null {
    return this._policy;
  }

  onDeviceTokenUpdate(callback: (deviceToken: string) => void): void {
    this.onDeviceTokenUpdated = callback;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.intentionalClose = false;
      let settled = false;

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(new ConnectionError(`Failed to create WebSocket: ${err}`));
        return;
      }

      const closeWs = () => {
        if (this.ws) {
          try { this.ws.close(); } catch {}
          this.ws = null;
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        closeWs();
        this._connected = false;
        reject(new TimeoutError("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      this.ws.on("open", () => {
        // wait for connect.challenge + hello-ok
      });

      this.ws.on("message", async (data: Buffer) => {
        let frame: unknown;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }

        const f = frame as { type: string };

        if (f.type === "event" && (f as EventFrame).event === "connect.challenge") {
          const challenge = (f as EventFrame).payload as ConnectChallenge;
          await this.sendConnect(challenge);
          return;
        }

        if (f.type === "res") {
          const res = f as ResponseFrame;
          const pending = this.pendingRequests.get(res.id);
          if (pending) {
            this.pendingRequests.delete(res.id);
            if (res.ok) {
              pending.resolve(res.payload);
            } else {
              const errMsg = res.error?.message || "RPC error";
              const code = res.error?.code || "UNKNOWN";
              if (code === "AUTH_ERROR" || code === "UNAUTHORIZED") {
                pending.reject(new AuthError(errMsg));
              } else {
                pending.reject(new ProtocolError(errMsg));
              }
            }
          }

          if (res.ok && (res.payload as Record<string, unknown>)?.type === "hello-ok") {
            const hello = res.payload as HelloOk;
            this._connected = true;
            this._features = hello.features;
            this._policy = hello.policy;
            this._reconnectAttempts = 0;
            clearTimeout(timeout);
            settled = true;

            const dt = hello.auth?.deviceToken;
            if (dt && this.identity) {
              this.identity.deviceToken = dt;
              if (this.onDeviceTokenUpdated) {
                this.onDeviceTokenUpdated(dt);
              }
            }

            resolve();
          }
          return;
        }

        if (f.type === "event") {
          const evt = f as EventFrame;
          const handlers = this.eventHandlers.get(evt.event) || [];
          for (const handler of handlers) {
            handler(evt.payload);
          }
        }
      });

      this.ws.on("error", (err: Error) => {
        if (settled) return;
        clearTimeout(timeout);
        settled = true;
        closeWs();
        this._connected = false;
        reject(new ConnectionError(`WebSocket error: ${err.message}`));
      });

      this.ws.on("close", () => {
        this._connected = false;
        this.ws = null;
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new ConnectionError("Connection closed"));
        }
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private async sendConnect(challenge: ConnectChallenge): Promise<void> {
    const nonce = challenge.nonce;
    const signedAt = Date.now();

    let deviceSection: Record<string, unknown> | undefined;

    if (this.identity) {
      const payload = [
        "v2",
        this.identity.deviceId,
        "cli",
        "cli",
        "operator",
        "operator.read,operator.write",
        String(signedAt),
        this.token,
        nonce,
      ].join("|");

      const enc = new TextEncoder();
      const sigBytes = await subtle.sign(
        { name: "Ed25519" },
        this.identity.privateKey,
        enc.encode(payload)
      );
      const signature = Buffer.from(sigBytes).toString("base64url");

      deviceSection = {
        id: this.identity.deviceId,
        publicKey: this.identity.publicKeyBase64url,
        signature,
        signedAt,
        nonce,
      };
    }

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: "cli",
        version: "1.0.0",
        platform: process.platform,
        mode: "cli",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.token },
      locale: "id-ID",
      userAgent: "multi-session-chat/1.0.0",
    };

    if (deviceSection) {
      params.device = deviceSection;
    }

    this.sendFrame({
      type: "req",
      id: "connect-1",
      method: "connect",
      params,
    });
  }

  private sendFrame(frame: RequestFrame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError("WebSocket not open");
    }
    this.ws.send(JSON.stringify(frame));
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this._connected) {
      throw new ConnectionError("Not connected to gateway");
    }
    const id = String(++this.reqId) + "-" + Date.now();
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new TimeoutError(`Request ${method} timed out`));
        }
      }, REQUEST_TIMEOUT_MS);
    });

    this.sendFrame({ type: "req", id, method, params } as RequestFrame);
    return promise;
  }

  on(event: string, handler: (payload: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  async listSessions(): Promise<SessionListResult["sessions"]> {
    const result = await this.request("sessions.list");
    return (result as SessionListResult).sessions || [];
  }

  async createSession(label: string): Promise<SessionCreateResult> {
    const result = await this.request("sessions.create", { label });
    return result as SessionCreateResult;
  }

  async deleteSession(sessionKey: string): Promise<void> {
    await this.request("sessions.delete", { key: sessionKey });
  }

  async resetSession(sessionKey: string): Promise<void> {
    await this.request("sessions.reset", { key: sessionKey });
  }

  async subscribeSession(sessionKey: string): Promise<void> {
    await this.request("sessions.messages.subscribe", { key: sessionKey });
  }

  async unsubscribeSession(sessionKey: string): Promise<void> {
    await this.request("sessions.messages.unsubscribe", { key: sessionKey });
  }

  async subscribeSessionsList(): Promise<void> {
    await this.request("sessions.subscribe");
  }

  async sendMessage(sessionKey: string, text: string): Promise<ChatSendResult> {
    const result = await this.request("chat.send", {
      sessionKey,
      message: text,
      idempotencyKey: String(++this.reqId) + "-" + Date.now(),
    });
    return result as ChatSendResult;
  }

  async getHistory(sessionKey: string): Promise<ChatMessage[]> {
    const result = await this.request("chat.history", { sessionKey });
    return (result as ChatHistoryResult).messages || [];
  }

  async abort(sessionKey: string): Promise<void> {
    await this.request("chat.abort", { sessionKey });
  }

  private scheduleReconnect(): void {
    if (this._reconnectAttempts >= this.maxReconnectAttempts) return;
    this._reconnectAttempts++;
    const delay = this.reconnectDelayMs * Math.pow(2, this._reconnectAttempts - 1);
    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  close(): void {
    this.intentionalClose = true;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this._connected = false;
    for (const [, entry] of this.pendingRequests) {
      try {
        entry.reject(new ConnectionError("Connection closed"));
      } catch {}
    }
    this.pendingRequests.clear();
  }
}
