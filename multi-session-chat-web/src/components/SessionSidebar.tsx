interface Session {
  key: string;
  label: string;
}

interface Props {
  sessions: Session[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onNew: () => void;
  onDelete: (key: string) => void;
  onReset: (key: string) => void;
}

export function SessionSidebar({ sessions, activeKey, onSelect, onNew, onDelete, onReset }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Sessions</span>
        <button onClick={onNew} title="New session (Ctrl+N)">+ New</button>
      </div>
      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.key}
            className={`session-item ${s.key === activeKey ? "active" : ""}`}
            onClick={() => onSelect(s.key)}
          >
            <span className="session-indicator">{s.key === activeKey ? "\u25CF" : "\u25CB"}</span>
            <span className="session-label">{s.label}</span>
            <span className="session-actions">
              <button
                onClick={(e) => { e.stopPropagation(); onReset(s.key); }}
                title="Reset"
              >\u21BA</button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(s.key); }}
                title="Delete"
              >\u2715</button>
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="session-empty">No sessions yet. Click "+ New" to start.</div>
        )}
      </div>
    </div>
  );
}
