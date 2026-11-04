import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation";
import { parseBody, json, error, ApiError, clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(`login:${clientIp(req)}`, 20, 900);
    if (!rl.ok) return error("Too many attempts, try again later", 429);

    const body = await parseBody(req, loginSchema);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    // Constant-ish response regardless of which factor failed.
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : false;
    if (!user || !ok) return error("Invalid email or password", 401);

    await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined });
    return json({ id: user.id, email: user.email, name: user.name });
  } catch (e) {
    if (e instanceof ApiError) return error(e.message, e.status, e.extra);
    return error("Internal server error", 500);
  }
}
