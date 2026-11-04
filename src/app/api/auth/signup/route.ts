import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { signupSchema } from "@/lib/validation";
import { parseBody, json, error, ApiError, clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(`signup:${clientIp(req)}`, 10, 3600);
    if (!rl.ok) return error("Too many attempts, try again later", 429);

    const body = await parseBody(req, signupSchema);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) return error("An account with this email already exists", 409);

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        name: body.name,
        preferences: { create: {} },
      },
    });
    await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined });
    return json({ id: user.id, email: user.email, name: user.name }, 201);
  } catch (e) {
    if (e instanceof ApiError) return error(e.message, e.status, e.extra);
    return error("Internal server error", 500);
  }
}
