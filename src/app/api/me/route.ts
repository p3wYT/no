import { prisma } from "@/lib/db";
import { withAuth, json, parseBody } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  return json({ user: { id: user.id, email: user.email, name: user.name, onboardingStep: user.onboardingStep } });
});

const patchSchema = z.object({ onboardingStep: z.number().int().min(0).max(20).optional(), name: z.string().max(100).optional() });

export const PATCH = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, patchSchema);
  const updated = await prisma.user.update({ where: { id: user.id }, data: body });
  return json({ user: { id: updated.id, onboardingStep: updated.onboardingStep, name: updated.name } });
});

const delSchema = z.object({ confirm: z.literal("DELETE") });

// Full account deletion — cascades all user-owned data.
export const DELETE = withAuth(async ({ req, user }) => {
  await parseBody(req, delSchema);
  await prisma.user.delete({ where: { id: user.id } });
  await destroySession();
  return json({ ok: true });
});
