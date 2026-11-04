import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64); // 32 bytes hex
});

describe("crypto", () => {
  it("round-trips encrypt/decrypt", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const secret = "ya29.super-secret-oauth-token";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const enc = encrypt("hello");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("sha256 is stable", async () => {
    const { sha256 } = await import("@/lib/crypto");
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });
});
