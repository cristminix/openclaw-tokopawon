export interface ConnectChallenge {
  nonce: string;
  ts: number;
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  auth: {
    role: string;
    scopes: string[];
    deviceToken?: string;
  };
  policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number };
}

export interface SessionRow {
  key: string;
  label?: string;
  displayName?: string;
  kind?: string;
  sessionId?: string;
  status?: string;
  updatedAt?: string;
}

export interface ChatContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content?: ChatContentBlock[] | string;
  text?: string;
  timestamp?: number;
  __openclaw?: { id: string; seq: number };
}

export interface SessionMessageEvent {
  sessionKey: string;
  message: ChatMessage;
  messageId: string;
  messageSeq: number;
  session?: Record<string, unknown>;
}

export interface ChatEvent {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  state?: string;
  deltaText?: string;
  message?: ChatMessage;
  replace?: boolean;
}

export interface SessionOperationEvent {
  status: string;
  sessionKey?: string;
}

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params: unknown;
}

export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

export interface EventFrame {
  type: "event";
  event: string;
  payload: unknown;
  seq?: number;
  stateVersion?: string;
}

export interface SessionsListResult {
  sessions: SessionRow[];
  count: number;
  totalCount: number;
}

export interface SessionCreateResult {
  ok: boolean;
  key: string;
  sessionId?: string;
}
