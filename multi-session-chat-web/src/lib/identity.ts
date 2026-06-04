const IDENTITY_KEY = "openclaw-identity";

export interface StoredIdentity {
  deviceId: string;
  publicKeyBase64url: string;
  privateKeyJwk: JsonWebKey;
  deviceToken?: string;
}

function buf2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loadStored(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStored(id: StoredIdentity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
}

export async function getOrCreateIdentity(): Promise<{
  deviceId: string;
  publicKeyBase64url: string;
  privateKey: CryptoKey;
  deviceToken?: string;
}> {
  const stored = loadStored();
  if (stored) {
    const privateKey = await crypto.subtle.importKey(
      "jwk", stored.privateKeyJwk, { name: "Ed25519" }, false, ["sign"]
    );
    return {
      deviceId: stored.deviceId,
      publicKeyBase64url: stored.publicKeyBase64url,
      privateKey,
      deviceToken: stored.deviceToken,
    };
  }

  const kp = await crypto.subtle.generateKey(
    { name: "Ed25519" }, true, ["sign", "verify"]
  ) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const pkBytes = new Uint8Array(pubRaw);
  const publicKeyBase64url = btoa(
    String.fromCharCode(...pkBytes)
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const deviceId = await crypto.subtle.digest("SHA-256", pubRaw).then(buf2hex);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);

  saveStored({ deviceId, publicKeyBase64url, privateKeyJwk });

  return {
    deviceId,
    publicKeyBase64url,
    privateKey: kp.privateKey,
  };
}

export function persistDeviceToken(token: string): void {
  const stored = loadStored();
  if (!stored) return;
  stored.deviceToken = token;
  saveStored(stored);
}
