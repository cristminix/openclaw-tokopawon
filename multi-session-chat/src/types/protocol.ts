export interface ConnectChallenge {
  nonce: string;
  ts: number;
}

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  role: string;
  scopes: string[];
  auth: { token: string };
  locale: string;
  userAgent: string;
}

export interface ServerInfo {
  version: string;
  connId: string;
}

export interface Features {
  methods: string[];
  events: string[];
}

export interface AuthResult {
  role: string;
  scopes: string[];
  deviceToken?: string;
}

export interface Policy {
  maxPayload: number;
  maxBufferedBytes: number;
  tickIntervalMs: number;
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: ServerInfo;
  features: Features;
  auth: AuthResult;
  policy: Policy;
}

export interface SessionRow {
  sessionKey: string;
  label?: string;
  agentId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  messageId: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}

export interface ChatDelta {
  deltaText?: string;
  message?: string;
  replace?: boolean;
}

export interface SessionOperation {
  status: "thinking" | "completed" | "error";
  sessionKey?: string;
}

export interface SessionToolCall {
  toolName: string;
  args?: unknown;
  result?: unknown;
}

export interface SessionMessageEvent {
  message: ChatMessage;
  sessionKey: string;
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

export type Frame = RequestFrame | ResponseFrame | EventFrame;

export interface SessionListResult {
  sessions: SessionRow[];
}

export interface SessionCreateResult {
  ok: boolean;
  key: string;
  sessionId?: string;
  runStarted?: boolean;
}

export interface ChatSendResult {
  ok: boolean;
  runId?: string;
  status?: string;
}

export interface ChatHistoryResult {
  messages: ChatMessage[];
}
