import { GatewayClient } from "../client/gateway-client.js";
import { SessionStore } from "./store.js";
import { SessionRow, ChatMessage } from "../types/protocol.js";

export interface ChatEntry {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface ManagedSession {
  sessionKey: string;
  label: string;
  messages: ChatEntry[];
  status: "idle" | "thinking" | "streaming" | "completed" | "error";
}

export class SessionManager {
  private client: GatewayClient;
  private store: SessionStore;
  private sessions: Map<string, ManagedSession> = new Map();
  private activeSessionKey: string | null = null;
  private streamingBuffer = "";

  constructor(client: GatewayClient, store: SessionStore) {
    this.client = client;
    this.store = store;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on("chat", (payload: unknown) => {
      const p = payload as { deltaText?: string; message?: string; replace?: boolean };
      if (!this.activeSessionKey) return;
      const session = this.sessions.get(this.activeSessionKey);
      if (!session) return;

      if (p.replace) {
        this.streamingBuffer = p.deltaText || "";
      } else if (p.deltaText) {
        this.streamingBuffer += p.deltaText;
      }

      if (p.message) {
        const last = session.messages[session.messages.length - 1];
        if (last?.isStreaming) {
          last.text = p.message;
          last.isStreaming = false;
        } else {
          session.messages.push({
            role: "assistant",
            text: p.message,
            timestamp: new Date().toISOString(),
          });
        }
        this.streamingBuffer = "";
      } else if (p.deltaText || p.replace !== undefined) {
        const last = session.messages[session.messages.length - 1];
        if (last?.isStreaming) {
          last.text = this.streamingBuffer;
        } else {
          session.messages.push({
            role: "assistant",
            text: this.streamingBuffer,
            timestamp: new Date().toISOString(),
            isStreaming: true,
          });
        }
      }
    });

    this.client.on("session.message", (payload: unknown) => {
      const p = payload as { message?: ChatMessage; sessionKey?: string };
      if (!p.message) return;
      const sk = p.sessionKey || this.activeSessionKey;
      if (!sk) return;
      const session = this.sessions.get(sk);
      if (!session) return;

      const entry: ChatEntry = {
        role: p.message.role,
        text: p.message.text,
        timestamp: p.message.createdAt,
      };

      if (entry.role === "assistant") {
        const last = session.messages[session.messages.length - 1];
        if (last?.isStreaming) {
          last.isStreaming = false;
          last.text = entry.text;
          return;
        }
      }

      session.messages.push(entry);
    });

    this.client.on("session.operation", (payload: unknown) => {
      const p = payload as { status: string; sessionKey?: string };
      const sk = p.sessionKey || this.activeSessionKey;
      if (!sk) return;
      const session = this.sessions.get(sk);
      if (!session) return;
      session.status = p.status as ManagedSession["status"];

      if (p.status === "completed" || p.status === "error") {
        const last = session.messages[session.messages.length - 1];
        if (last?.isStreaming) {
          last.isStreaming = false;
        }
      }
    });
  }

  get activeKey(): string | null {
    return this.activeSessionKey;
  }

  set activeKey(key: string | null) {
    this.activeSessionKey = key;
  }

  getAll(): ManagedSession[] {
    return Array.from(this.sessions.values());
  }

  get(key: string): ManagedSession | undefined {
    return this.sessions.get(key);
  }

  async loadSessions(): Promise<void> {
    const stored = this.store.getSessions();
    for (const s of stored) {
      if (!this.sessions.has(s.sessionKey)) {
        this.sessions.set(s.sessionKey, {
          sessionKey: s.sessionKey,
          label: s.label,
          messages: [],
          status: "idle",
        });
      }
    }

    try {
      const remote = await this.client.listSessions();
      for (const row of remote) {
        const label = row.label || row.sessionKey;
        if (!this.sessions.has(row.sessionKey)) {
          this.store.upsertSession(row.sessionKey, label);
        }
        this.sessions.set(row.sessionKey, {
          sessionKey: row.sessionKey,
          label,
          messages: [],
          status: "idle",
        });
      }
    } catch {
      // offline mode: use stored only
    }
  }

  async createSession(label: string): Promise<ManagedSession> {
    const result = await this.client.createSession(label);
    const sessionKey = result.key;
    this.store.upsertSession(sessionKey, label);
    const ms: ManagedSession = {
      sessionKey,
      label,
      messages: [],
      status: "idle",
    };
    this.sessions.set(sessionKey, ms);
    return ms;
  }

  async deleteSession(sessionKey: string): Promise<void> {
    try {
      await this.client.deleteSession(sessionKey);
    } catch {
      // continue even if remote fails
    }
    this.store.removeSession(sessionKey);
    this.sessions.delete(sessionKey);
    if (this.activeSessionKey === sessionKey) {
      this.activeSessionKey = null;
    }
  }

  async resetSession(sessionKey: string): Promise<void> {
    try {
      await this.client.resetSession(sessionKey);
    } catch {
      // continue
    }
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.messages = [];
      session.status = "idle";
    }
  }

  async subscribe(sessionKey: string): Promise<void> {
    try {
      await this.client.subscribeSession(sessionKey);
    } catch {
      // ignore if already subscribed
    }
  }

  async loadHistory(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    try {
      const messages = await this.client.getHistory(sessionKey);
      session.messages = messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.createdAt,
      }));
    } catch {
      // keep existing messages
    }
  }

  async sendMessage(sessionKey: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error("Session not found");

    session.messages.push({
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    });
    session.status = "thinking";

    try {
      await this.client.sendMessage(sessionKey, text);
    } catch (err) {
      session.status = "error";
      throw err;
    }
  }

  async abort(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    try {
      await this.client.abort(sessionKey);
    } catch {
      // ignore
    }
    session.status = "idle";
    const last = session.messages[session.messages.length - 1];
    if (last?.isStreaming) {
      last.isStreaming = false;
    }
  }

  async subscribeAll(): Promise<void> {
    try {
      await this.client.subscribeSessionsList();
    } catch {
      // ignore
    }
  }
}
