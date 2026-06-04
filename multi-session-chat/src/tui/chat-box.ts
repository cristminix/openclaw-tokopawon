import blessed from "blessed";
import { ChatEntry } from "../session/manager.js";

const MAX_VISIBLE_LINES = 1000;

export class ChatBox {
  private box: blessed.Widgets.BoxElement;
  private content: blessed.Widgets.BoxElement;

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
      scrollbar: { ch: "░" },
    });

    this.content = blessed.box({
      parent: this.box,
      top: 0,
      left: 1,
      right: 1,
      height: "shrink",
      wordWrap: true,
      wrap: true,
    });
  }

  element(): blessed.Widgets.BoxElement {
    return this.box;
  }

  renderMessages(messages: ChatEntry[]): void {
    const lines: string[] = [];
    for (const msg of messages.slice(-MAX_VISIBLE_LINES)) {
      const time = msg.timestamp ? msg.timestamp.slice(11, 19) : "";
      const role = msg.role === "user" ? "You" : msg.role === "assistant" ? "Agent" : "System";
      const suffix = msg.isStreaming ? "█" : "";
      lines.push(`{bold}[${time}] ${role}:{/bold} ${msg.text}${suffix}`);
    }
    this.content.setContent(lines.join("\n"));
    this.box.setScrollPerc(100);
  }

  clear(): void {
    this.content.setContent("");
  }

  focus(): void {
    this.box.focus();
  }
}
