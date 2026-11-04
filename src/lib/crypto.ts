// AES-256-GCM encryption for token material at rest + session token hashing.
// The key comes from ENCRYPTION_KEY (base64 or hex, 32 bytes).

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      key = Buffer.from(raw, "utf8");
    }
  }
  if (key.length !== 32) {
    // Derive a stable 32-byte key if a shorter/longer secret was supplied.
    key = createHash("sha256").update(raw).digest();
  }
  return key;
}

const VERSION = "v1";

/** Encrypt plaintext → "v1:<iv b64>:<tag b64>:<ct b64>". */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const key = loadKey();
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== VERSION) throw new Error("Unsupported ciphertext version");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : encrypt(v);
}

export function decryptNullable(v: string | null | undefined): string | null {
  return v == null ? null : decrypt(v);
}

/** One-way hash for session tokens stored in the DB. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
