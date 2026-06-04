import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface StoredSession {
  sessionKey: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  sessions: StoredSession[];
  version: number;
}

const STORE_DIR = path.join(os.homedir(), ".multichat");
const STORE_FILE = path.join(STORE_DIR, "sessions.json");
const STORE_VERSION = 1;

export class SessionStore {
  private data: StoreData;

  constructor() {
    this.data = this.load();
  }

  private ensureDir(): void {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(raw) as StoreData;
    } catch {
      return { sessions: [], version: STORE_VERSION };
    }
  }

  save(): void {
    this.ensureDir();
    const tmp = STORE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    fs.renameSync(tmp, STORE_FILE);
  }

  getSessions(): StoredSession[] {
    return this.data.sessions;
  }

  getSession(sessionKey: string): StoredSession | undefined {
    return this.data.sessions.find((s) => s.sessionKey === sessionKey);
  }

  upsertSession(sessionKey: string, label: string): void {
    const existing = this.getSession(sessionKey);
    const now = new Date().toISOString();
    if (existing) {
      existing.label = label;
      existing.updatedAt = now;
    } else {
      this.data.sessions.push({
        sessionKey,
        label,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.save();
  }

  removeSession(sessionKey: string): void {
    this.data.sessions = this.data.sessions.filter(
      (s) => s.sessionKey !== sessionKey
    );
    this.save();
  }
}
