import blessed from "blessed";

export class StatusBar {
  private box: blessed.Widgets.BoxElement;

  constructor(parent: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent,
      left: 0,
      right: 0,
      bottom: 0,
      height: 1,
      style: { fg: "black", bg: "white" },
      content: "",
    });
  }

  setStatus(connected: boolean, sessionLabel: string | null, status: string | null): void {
    const conn = connected ? "● Connected" : "○ Disconnected";
    const session = sessionLabel ? `| Session: ${sessionLabel}` : "| No session selected";
    const opStatus = status && status !== "idle" ? `| ${status}` : "";
    const hints = "[Tab] switch [^N] new [^D] del [^R] reset [^L] clear [^C] quit";
    this.box.setContent(` ${conn} ${session} ${opStatus} ${hints}`);
  }
}
