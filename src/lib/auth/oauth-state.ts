// OAuth state + PKCE helpers. State is a signed, short-lived token bound to
// the user; it carries the PKCE verifier and target platform so the callback
// can verify the round-trip and complete the code exchange.

import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface OAuthStatePayload {
  userId: string;
  platform: string;
  verifier: string; // PKCE code_verifier
  nonce: string;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function signState(payload: Omit<OAuthStatePayload, "nonce">): Promise<string> {
  return new SignJWT({ ...payload, nonce: randomBytes(8).toString("hex") })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
}

export async function verifyState(token: string): Promise<OAuthStatePayload> {
  const { payload } = await jwtVerify(token, secret());
  return payload as unknown as OAuthStatePayload;
}
