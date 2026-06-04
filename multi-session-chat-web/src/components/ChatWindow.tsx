import { useEffect, useRef } from "react";

interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp?: string;
  isStreaming?: boolean;
}

interface Props {
  messages: Message[];
}

export function ChatWindow({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-window">
      {messages.length === 0 && (
        <div className="chat-empty">
          Select a session to start chatting, or press Ctrl+N for a new one.
        </div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`chat-message ${msg.role}`}>
          <span className="chat-time">{msg.timestamp || ""}</span>
          <span className="chat-role">
            {msg.role === "user" ? "You" : msg.role === "assistant" ? "Agent" : "System"}
          </span>
          <span className="chat-text">
            {msg.text}
            {msg.isStreaming ? <span className="cursor-blink">\u2588</span> : null}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
