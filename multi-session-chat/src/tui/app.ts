import blessed from "blessed";
import { SessionList } from "./session-list.js";
import { ChatBox } from "./chat-box.js";
import { InputBar } from "./input-bar.js";
import { StatusBar } from "./status-bar.js";
import { SessionManager } from "../session/manager.js";

export class TuiApp {
  private screen: blessed.Widgets.Screen;
  private sessionList: SessionList;
  private chatBox: ChatBox;
  private inputBar: InputBar;
  private statusBar: StatusBar;
  private manager: SessionManager;
  private running = true;

  constructor(manager: SessionManager) {
    this.manager = manager;

    this.screen = blessed.screen({
      smartCSR: true,
      title: "Multi-Session Chat",
      cursor: { artificial: true, blink: true, shape: "block", color: "white" },
    });

    this.sessionList = new SessionList(this.screen);
    this.chatBox = new ChatBox(this.screen);
    this.inputBar = new InputBar(this.screen);
    this.statusBar = new StatusBar(this.screen);

    this.setupKeys();
    this.setupInputHandler();

    this.screen.on("resize", () => {
      this.screen.render();
    });
  }

  private setupKeys(): void {
    this.screen.key(["C-c", "q"], () => {
      this.running = false;
      this.screen.destroy();
    });

    this.screen.key(["tab"], () => {
      const all = this.manager.getAll();
      if (all.length === 0) return;
      const activeKey = this.manager.activeKey;
      const idx = all.findIndex((s) => s.sessionKey === activeKey);
      const nextIdx = (idx + 1) % all.length;
      this.selectSession(all[nextIdx].sessionKey);
    });

    this.screen.key(["j"], () => {
      const all = this.manager.getAll();
      if (all.length === 0) return;
      const activeKey = this.manager.activeKey;
      const idx = all.findIndex((s) => s.sessionKey === activeKey);
      const nextIdx = Math.min(idx + 1, all.length - 1);
      this.selectSession(all[nextIdx].sessionKey);
    });

    this.screen.key(["k"], () => {
      const all = this.manager.getAll();
      if (all.length === 0) return;
      const activeKey = this.manager.activeKey;
      const idx = all.findIndex((s) => s.sessionKey === activeKey);
      const nextIdx = Math.max(idx - 1, 0);
      this.selectSession(all[nextIdx].sessionKey);
    });

    this.screen.key(["C-n"], async () => {
      this.inputBar.clear();
      this.inputBar.focus();
    });

    this.screen.key(["C-d"], async () => {
      const activeKey = this.manager.activeKey;
      if (!activeKey) return;
      await this.manager.deleteSession(activeKey);
      this.render();
    });

    this.screen.key(["C-r"], async () => {
      const activeKey = this.manager.activeKey;
      if (!activeKey) return;
      await this.manager.resetSession(activeKey);
      this.chatBox.clear();
      this.render();
    });

    this.screen.key(["C-l"], () => {
      const activeKey = this.manager.activeKey;
      if (activeKey) {
        const session = this.manager.get(activeKey);
        if (session) {
          session.messages = session.messages.filter((m) => !m.isStreaming);
          session.messages = [];
          this.chatBox.clear();
          this.render();
        }
      }
    });
  }

  private setupInputHandler(): void {
    let inputActive = false;

    this.inputBar.onSubmit(async (value: string) => {
      const activeKey = this.manager.activeKey;
      if (!activeKey) {
        // Create new session with this text as label/initial message
        try {
          const session = await this.manager.createSession(value);
          this.manager.activeKey = session.sessionKey;
          await this.manager.subscribe(session.sessionKey);
          await this.manager.sendMessage(session.sessionKey, value);
        } catch (err) {
          this.statusBar.setStatus(true, null, `Error: ${(err as Error).message}`);
        }
      } else {
        try {
          await this.manager.sendMessage(activeKey, value);
        } catch (err) {
          this.statusBar.setStatus(true, this.manager.get(activeKey)?.label || null, `Error: ${(err as Error).message}`);
        }
      }
    });
  }

  private selectSession(sessionKey: string): void {
    if (this.manager.activeKey === sessionKey) return;
    this.manager.activeKey = sessionKey;
    const session = this.manager.get(sessionKey);
    if (session && session.messages.length === 0) {
      this.manager.loadHistory(sessionKey).then(() => this.render());
    }
    this.render();
  }

  render(): void {
    const all = this.manager.getAll();
    const activeKey = this.manager.activeKey;
    this.sessionList.refresh(all, activeKey);

    if (activeKey) {
      const session = this.manager.get(activeKey);
      if (session) {
        this.chatBox.renderMessages(session.messages);
        this.statusBar.setStatus(true, session.label, session.status);
      }
    } else {
      this.chatBox.clear();
      this.statusBar.setStatus(true, null, null);
    }

    this.screen.render();
  }

  isRunning(): boolean {
    return this.running;
  }
}
