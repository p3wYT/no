import { prisma } from "@/lib/db";
import { withAuth, json, error } from "@/lib/api";
import { backfillAutomation } from "@/lib/engine/automations";

export const dynamic = "force-dynamic";

// Explicit, user-initiated historical backfill (bypasses the baseline).
export const POST = withAuth(async ({ user, params }) => {
  const automation = await prisma.automation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!automation) return error("Automation not found", 404);
  const count = await backfillAutomation(automation.id);
  return json({ ok: true, queued: count });
});
