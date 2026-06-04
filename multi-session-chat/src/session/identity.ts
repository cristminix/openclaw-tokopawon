import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, webcrypto } from "node:crypto";

const { subtle } = webcrypto;

export interface DeviceKey {
  deviceId: string;
  publicKeyBase64url: string;
  privateKey: webcrypto.CryptoKey;
  deviceToken?: string;
}

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

export async function loadOrCreateIdentity(): Promise<DeviceKey> {
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
  );
  const keypair = kp as unknown as { publicKey: webcrypto.CryptoKey; privateKey: webcrypto.CryptoKey };

  const pubRaw = Buffer.from(await subtle.exportKey("raw", keypair.publicKey) as ArrayBuffer);
  const publicKeyBase64url = pubRaw.toString("base64url");
  const deviceId = createHash("sha256").update(pubRaw).digest("hex");
  const privateKeyJwk = await subtle.exportKey("jwk", keypair.privateKey);

  saveStored({ deviceId, publicKeyBase64url, privateKeyJwk });

  return {
    deviceId,
    publicKeyBase64url,
    privateKey: keypair.privateKey,
  };
}

export function persistDeviceToken(deviceToken: string): void {
  const stored = loadStored();
  if (!stored) return;
  stored.deviceToken = deviceToken;
  saveStored(stored);
}
