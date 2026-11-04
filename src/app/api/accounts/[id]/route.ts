import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  monitoringOn: z.boolean().optional(),
  pollIntervalSec: z.number().int().min(60).max(86400).optional(),
});

async function owned(userId: string, id: string) {
  return prisma.socialAccount.findFirst({ where: { id, userId } });
}

export const PATCH = withAuth(async ({ req, user, params }) => {
  const acc = await owned(user.id, params.id);
  if (!acc) return error("Account not found", 404);
  const body = await parseBody(req, patchSchema);
  const updated = await prisma.socialAccount.update({
    where: { id: acc.id },
    data: {
      ...(body.monitoringOn !== undefined ? { monitoringOn: body.monitoringOn } : {}),
      ...(body.pollIntervalSec !== undefined ? { pollIntervalSec: body.pollIntervalSec, nextCheckAt: new Date() } : {}),
    },
  });
  return json({ id: updated.id, monitoringOn: updated.monitoringOn, pollIntervalSec: updated.pollIntervalSec });
});

export const DELETE = withAuth(async ({ user, params }) => {
  const acc = await owned(user.id, params.id);
  if (!acc) return error("Account not found", 404);
  // Disconnect: remove credentials + account. Cascades detected posts/jobs.
  await prisma.socialAccount.delete({ where: { id: acc.id } });
  return json({ ok: true });
});
