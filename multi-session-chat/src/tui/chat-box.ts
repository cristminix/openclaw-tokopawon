import blessed from "blessed";

const MAX_VISIBLE_LINES = 1000;

export class ChatBox {
  private box: blessed.Widgets.BoxElement;

  constructor(parent: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent,
      top: 0,
      left: 30,
      right: 0,
      bottom: 3,
      label: " Chat ",
      border: { type: "line" },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: "\u2591" },
      tags: true,
      wrap: true,
    });
  }

  element(): blessed.Widgets.BoxElement {
    return this.box;
  }

  renderMessages(messages: { role: string; text: string; timestamp: string; isStreaming?: boolean }[]): void {
    const lines: string[] = [];
    const visible = messages.slice(-MAX_VISIBLE_LINES);
    for (const msg of visible) {
      const time = msg.timestamp || "";
      const roleLabel = msg.role === "user" ? "You" : msg.role === "assistant" ? "Agent" : "System";
      const suffix = msg.isStreaming ? "\u2588" : "";
      lines.push(`{bold}${time} ${roleLabel}:{/bold} ${msg.text}${suffix}`);
    }
    this.box.setContent(lines.join("\n"));
    this.box.setScrollPerc(100);
  }

  clear(): void {
    this.box.setContent("");
  }

  focus(): void {
    this.box.focus();
  }
}
