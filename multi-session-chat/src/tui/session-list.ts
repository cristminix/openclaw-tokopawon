import blessed from "blessed";
import { ManagedSession } from "../session/manager.js";

export class SessionList {
  private box: blessed.Widgets.ListElement;

  constructor(parent: blessed.Widgets.Screen) {
    this.box = blessed.list({
      parent,
      top: 0,
      left: 0,
      width: 30,
      bottom: 1,
      label: " Sessions ",
      border: { type: "line" },
      style: {
        selected: { bg: "blue", fg: "white" },
        item: { fg: "white" },
      },
      keys: false,
      vi: false,
    });
  }

  get element(): blessed.Widgets.ListElement {
    return this.box;
  }

  refresh(sessions: ManagedSession[], activeKey: string | null): void {
    const items = sessions.map((s) => {
      const indicator = s.sessionKey === activeKey ? "●" : "○";
      return `${indicator} ${s.label}`;
    });
    this.box.setItems(items);

    if (activeKey) {
      const idx = sessions.findIndex((s) => s.sessionKey === activeKey);
      if (idx >= 0) {
        this.box.select(idx);
      }
    }
  }

  getSelectedIndex(): number {
    return (this.box as unknown as { selected: number }).selected;
  }

  selectIndex(idx: number): void {
    this.box.select(idx);
  }

  focus(): void {
    this.box.focus();
  }
}
