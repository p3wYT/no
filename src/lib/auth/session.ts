// Server-side sessions. A random token is set in an httpOnly, secure,
// sameSite=lax cookie; only its SHA-256 hash is persisted.

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";

const COOKIE = "rf_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + MAX_AGE_SEC * 1000);
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt, ip: meta?.ip, userAgent: meta?.userAgent },
  });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return token;
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  jar.delete(COOKIE);
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
