import WebSocket from "ws";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const WS_URL = process.env.OPENCLAW_WS_URL!;
const TOKEN = process.env.OPENCLAW_TOKEN!;

if (!WS_URL || !TOKEN) {
  console.error("Missing OPENCLAW_WS_URL or OPENCLAW_TOKEN in .env");
  process.exit(1);
}

const { subtle } = webcrypto;

const IDENTITY_DIR = resolve(homedir(), ".multichat");
const IDENTITY_FILE = resolve(IDENTITY_DIR, "identity.json");

interface StoredIdentity {
  deviceId: string;
  publicKeyBase64url: string;
  privateKeyJwk: JsonWebKey;
  deviceToken?: string;
}

function ensureDir(): void {
  if (!existsSync(IDENTITY_DIR)) {
    mkdirSync(IDENTITY_DIR, { recursive: true });
  }
}

function loadStored(): StoredIdentity | null {
  try {
    return JSON.parse(readFileSync(IDENTITY_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveStored(id: StoredIdentity): void {
  ensureDir();
  writeFileSync(IDENTITY_FILE + ".tmp", JSON.stringify(id, null, 2), "utf-8");
  renameSync(IDENTITY_FILE + ".tmp", IDENTITY_FILE);
}

async function loadOrCreateIdentity(): Promise<{
  deviceId: string;
  publicKeyBase64url: string;
  privateKey: CryptoKey;
  deviceToken?: string;
}> {
  const stored = loadStored();
  if (stored) {
    const rawPub = Buffer.from(stored.publicKeyBase64url, "base64url");
    const privateKey = await subtle.importKey(
      "jwk", stored.privateKeyJwk, { name: "Ed25519" }, false, ["sign"]
    );
    return {
      deviceId: stored.deviceId,
      publicKeyBase64url: stored.publicKeyBase64url,
      privateKey,
      deviceToken: stored.deviceToken,
    };
  }

  const kp = await subtle.generateKey(
    { name: "Ed25519" }, true, ["sign", "verify"]
  ) as CryptoKeyPair & { publicKey: CryptoKey; privateKey: CryptoKey };

  const pubRaw = Buffer.from(await subtle.exportKey("raw", kp.publicKey));
  const publicKeyBase64url = pubRaw.toString("base64url");
  const deviceId = createHash("sha256").update(pubRaw).digest("hex");
  const privateKeyJwk = await subtle.exportKey("jwk", kp.privateKey);

  saveStored({ deviceId, publicKeyBase64url, privateKeyJwk });

  return { deviceId, publicKeyBase64url, privateKey: kp.privateKey };
}

function persistDeviceToken(token: string): void {
  const stored = loadStored();
  if (!stored) return;
  stored.deviceToken = token;
  saveStored(stored);
}

let reqId = 0;
const pending = new Map<string, (v: unknown) => void>();

function rpc(ws: WebSocket, method: string, params: unknown = {}): Promise<unknown> {
  const id = String(++reqId) + "-" + Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: "timeout" });
    }, 30_000);
    pending.set(id, (v: unknown) => { clearTimeout(timer); resolve(v); });
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

async function main() {
  const identity = await loadOrCreateIdentity();

  console.log("Device:", identity.deviceId.slice(0, 16) + "...");
  if (identity.deviceToken) {
    console.log("  Using saved device token");
  }

  console.log(`Connecting to ${WS_URL}...`);

  const ws = new WebSocket(WS_URL);
  let connectedResolved = false;

  const connected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!connectedResolved) reject(new Error("Connection timeout (20s)"));
    }, 20_000);

    ws.on("message", async (data: Buffer) => {
      const frame = JSON.parse(data.toString());

      if (frame.type === "event" && frame.event === "connect.challenge") {
        const nonce = frame.payload.nonce;
        const signedAt = Date.now();

        const payload = [
          "v2",
          identity.deviceId,
          "cli", "cli",
          "operator",
          "operator.read,operator.write",
          String(signedAt),
          TOKEN,
          nonce,
        ].join("|");

        const enc = new TextEncoder();
        const sigBytes = await subtle.sign(
          { name: "Ed25519" }, identity.privateKey, enc.encode(payload)
        );
        const signature = Buffer.from(sigBytes).toString("base64url");

        ws.send(JSON.stringify({
          type: "req", id: "connect-1", method: "connect",
          params: {
            minProtocol: 3, maxProtocol: 4,
            client: { id: "cli", version: "1.0.0", platform: "linux", mode: "cli" },
            role: "operator",
            scopes: ["operator.read", "operator.write"],
            auth: { token: TOKEN },
            locale: "id-ID",
            userAgent: "test-chat/1.0.0",
            device: {
              id: identity.deviceId,
              publicKey: identity.publicKeyBase64url,
              signature,
              signedAt,
              nonce,
            },
          },
        }));
        return;
      }

      if (frame.type === "res" && (frame.payload as any)?.type === "hello-ok") {
        clearTimeout(timeout);
        connectedResolved = true;
        const dt = (frame.payload as any).auth?.deviceToken;
        const scopes = (frame.payload as any).auth?.scopes || [];
        if (dt) {
          identity.deviceToken = dt;
          persistDeviceToken(dt);
        }
        if (dt) console.log(`  New device token received`);
        console.log(`  Connected. Scopes: ${JSON.stringify(scopes)}`);

        if (scopes.length === 0) {
          console.error("\nERROR: No operator scopes granted!");
          console.error("Device pairing may need approval.");
          console.error("Run via localhost first or use:");
          console.error("  openclaw devices approve <requestId>");
          ws.close();
          process.exit(1);
        }
        resolve();
        return;
      }

      if (frame.type === "res") {
        const cb = pending.get(frame.id);
        if (cb) {
          pending.delete(frame.id);
          cb(frame.ok ? frame.payload : frame.error);
        }
        return;
      }

      if (frame.type === "event") {
        if (frame.event === "chat") {
          const p = frame.payload as { deltaText?: string; message?: string };
          if (p.deltaText) process.stdout.write(p.deltaText);
          if (p.message) process.stdout.write("\n");
        }
        if (frame.event === "session.operation") {
          const p = frame.payload as { status: string };
          console.log(`\n  [${p.status}]`);
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      connectedResolved = true;
      reject(err);
    });
  });

  await connected;

  console.log("\nCreating test session...");
  const created = (await rpc(ws, "sessions.create", { label: "test-" + Date.now() })) as any;
  if (created?.error) {
    console.error(`  FAILED: ${created.error} - ${created?.message || ""}`);
    ws.close();
    process.exit(1);
  }
  const sessionKey = created?.key;
  console.log(`  sessionKey: ${sessionKey}\n`);

  console.log("Subscribing to messages...");
  await rpc(ws, "sessions.messages.subscribe", { sessionKey });
  console.log("  subscribed\n");

  const prompt = "Halo! Perkenalkan dirimu dalam satu kalimat pendek.";
  console.log(`User: ${prompt}\n`);
  console.log("Agent: ");

  await rpc(ws, "chat.send", { sessionKey, text: prompt });

  await new Promise<void>((resolve) => setTimeout(resolve, 20_000));

  console.log("\n\nCleaning up...");
  await rpc(ws, "sessions.delete", { key: sessionKey });
  console.log("  session deleted\n");

  ws.close();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
