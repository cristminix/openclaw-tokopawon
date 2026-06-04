import { useState, useEffect, useCallback, useRef } from "react";
import { GatewayClient, extractText } from "./lib/gateway-client";
import { getOrCreateIdentity } from "./lib/identity";
import { SessionSidebar } from "./components/SessionSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { MessageInput } from "./components/MessageInput";
import { StatusBar } from "./components/StatusBar";
import type { ChatEvent, SessionMessageEvent, SessionOperationEvent } from "./lib/types";

const WS_URL = import.meta.env.VITE_WS_URL || "wss://openclawdashboard.tokopawon.id";
const TOKEN = import.meta.env.VITE_TOKEN || "token_rahasia_damar_2026";

interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp?: string;
  isStreaming?: boolean;
}

interface Session {
  key: string;
  label: string;
  messages: Message[];
  status: "idle" | "thinking" | "streaming" | "completed" | "error";
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [opStatus, setOpStatus] = useState<string | null>(null);

  const clientRef = useRef<GatewayClient | null>(null);

  const activeSession = sessions.find((s) => s.key === activeKey);

  const updateSession = useCallback((key: string, updater: (s: Session) => Session) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? updater(s) : s)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let streamingBuf = "";

    async function init() {
      try {
        const identity = await getOrCreateIdentity();

        const client = new GatewayClient(WS_URL, TOKEN, identity);
        clientRef.current = client;
        if (cancelled) return;

        await client.connect();
        if (cancelled) return;
        setConnected(true);

        client.on("chat", (payload: unknown) => {
          const p = payload as ChatEvent;
          const sk = p.sessionKey || "";
          if (!sk) return;

          if (p.state === "final") {
            streamingBuf = "";
            return;
          }

          if (p.deltaText) {
            streamingBuf += p.deltaText;
            updateSession(sk, (s) => {
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last?.isStreaming) {
                last.text = streamingBuf;
              } else {
                msgs.push({ role: "assistant", text: streamingBuf, timestamp: ts(), isStreaming: true });
              }
              return { ...s, messages: msgs };
            });
          }

          const msgContent = extractText(p.message as unknown as { content?: unknown });
          if (msgContent) {
            streamingBuf = "";
            updateSession(sk, (s) => {
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last?.isStreaming) {
                last.text = msgContent;
                last.isStreaming = false;
              } else {
                msgs.push({ role: "assistant", text: msgContent, timestamp: ts() });
              }
              return { ...s, messages: msgs };
            });
          }
        });

        client.on("session.message", (payload: unknown) => {
          const p = payload as SessionMessageEvent;
          if (!p.message || !p.sessionKey) return;
          const text = extractText(p.message as unknown as { content?: unknown });

          updateSession(p.sessionKey, (s) => {
            const msgs = [...s.messages];
            if (p.message.role === "assistant") {
              const last = msgs[msgs.length - 1];
              if (last?.isStreaming) {
                last.text = text || " ";
                last.isStreaming = false;
                return { ...s, messages: msgs };
              }
            }
            if (text) {
              msgs.push({ role: p.message.role, text, timestamp: ts(p.message.timestamp) });
            }
            return { ...s, messages: msgs };
          });
        });

        client.on("session.operation", (payload: unknown) => {
          const p = payload as SessionOperationEvent;
          const sk = p.sessionKey;
          if (sk) {
            updateSession(sk, (s) => ({ ...s, status: p.status as Session["status"] }));
          }
          if (p.status === "completed" || p.status === "error") {
            setOpStatus(null);
          }
        });

        const rows = await client.listSessions();
        if (cancelled) return;

        const sessList: Session[] = rows.map((r) => ({
          key: r.key,
          label: r.label || r.displayName || r.key,
          messages: [],
          status: "idle",
        }));
        setSessions(sessList);
        if (sessList.length > 0) setActiveKey(sessList[0].key);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setConnected(false);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, [updateSession]);

  useEffect(() => {
    if (!activeKey || !clientRef.current) return;
    clientRef.current.subscribeSession(activeKey).catch(() => {});
  }, [activeKey]);

  const handleSelect = useCallback((key: string) => setActiveKey(key), []);

  const handleNew = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const label = prompt("Session label:") || "Session " + new Date().toLocaleTimeString();
      const result = await c.createSession(label);
      const ns: Session = { key: result.key, label, messages: [], status: "idle" };
      setSessions((prev) => [...prev, ns]);
      setActiveKey(result.key);
      c.subscribeSession(result.key).catch(() => {});
    } catch (err) {
      alert("Failed: " + (err as Error).message);
    }
  }, []);

  const handleDelete = useCallback(async (key: string) => {
    const c = clientRef.current;
    if (!c || !confirm("Delete session?")) return;
    try {
      await c.deleteSession(key);
      setSessions((prev) => {
        const rest = prev.filter((s) => s.key !== key);
        if (activeKey === key) setActiveKey(rest[0]?.key || null);
        return rest;
      });
    } catch (err) {
      alert("Failed: " + (err as Error).message);
    }
  }, [activeKey]);

  const handleReset = useCallback(async (key: string) => {
    const c = clientRef.current;
    if (!c || !confirm("Reset session?")) return;
    try {
      await c.resetSession(key);
      updateSession(key, (s) => ({ ...s, messages: [], status: "idle" }));
    } catch (err) {
      alert("Failed: " + (err as Error).message);
    }
  }, [updateSession]);

  const handleSend = useCallback(async (text: string) => {
    const c = clientRef.current;
    if (!c || !activeKey) return;

    const msg: Message = { role: "user", text, timestamp: ts() };
    updateSession(activeKey, (s) => ({
      ...s,
      messages: [...s.messages, msg],
      status: "thinking",
    }));
    setOpStatus("thinking");

    try {
      await c.sendMessage(activeKey, text);
    } catch (err) {
      setOpStatus("error");
      alert("Send failed: " + (err as Error).message);
    }
  }, [activeKey, updateSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); handleNew(); }
      if (e.ctrlKey && e.key === "l") {
        if (activeKey) updateSession(activeKey, (s) => ({ ...s, messages: [] }));
      }
      if (e.key === "Tab" && sessions.length > 0) {
        e.preventDefault();
        setActiveKey((prev) => {
          const idx = sessions.findIndex((s) => s.key === prev);
          return sessions[(idx + 1) % sessions.length]?.key || prev;
        });
      }
    };
    window.addEventListener("keydown", handler as unknown as EventListener);
    return () => window.removeEventListener("keydown", handler as unknown as EventListener);
  }, [sessions, activeKey, handleNew, updateSession]);

  if (error) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{error}</p>
        <p>Check VITE_WS_URL and VITE_TOKEN in .env</p>
        <p>First-time setup: connect via localhost for auto-approval</p>
      </div>
    );
  }

  return (
    <div className="app">
      <SessionSidebar
        sessions={sessions.map((s) => ({ key: s.key, label: s.label }))}
        activeKey={activeKey}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onReset={handleReset}
      />
      <div className="main-area">
        <ChatWindow messages={activeSession?.messages || []} />
        <MessageInput onSend={handleSend} disabled={!connected || !activeKey} />
        <StatusBar connected={connected} status={opStatus || activeSession?.status || null} />
      </div>
    </div>
  );
}

function ts(t?: number): string {
  if (!t) return new Date().toTimeString().slice(0, 8);
  return new Date(t).toTimeString().slice(0, 8);
}
