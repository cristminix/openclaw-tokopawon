interface Props {
  connected: boolean;
  status: string | null;
}

export function StatusBar({ connected, status }: Props) {
  return (
    <div className={`status-bar ${connected ? "connected" : "disconnected"}`}>
      <span className="status-dot">{connected ? "\u25CF" : "\u25CB"}</span>
      <span>{connected ? "Connected" : "Disconnected"}</span>
      {status && status !== "idle" && (
        <span className="status-state">| {status}</span>
      )}
      <span className="status-shortcuts">
        [Ctrl+N] new [Ctrl+D] delete [Ctrl+R] reset [Ctrl+L] clear
      </span>
    </div>
  );
}
