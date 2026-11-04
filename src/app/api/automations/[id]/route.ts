import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { automationSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user, params }) => {
  const automation = await prisma.automation.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      sourceAccount: { select: { id: true, platform: true, username: true } },
      targets: { include: { account: { select: { id: true, platform: true, username: true } } } },
    },
  });
  if (!automation) return error("Automation not found", 404);
  return json({ automation });
});

export const PATCH = withAuth(async ({ req, user, params }) => {
  const existing = await prisma.automation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!existing) return error("Automation not found", 404);

  const body = await parseBody(req, automationSchema.partial());

  // If targets provided, validate ownership and replace them.
  let targetsOp = {};
  if (body.targets) {
    const destIds = body.targets.map((t) => t.accountId);
    const destAccounts = await prisma.socialAccount.findMany({ where: { id: { in: destIds }, userId: user.id } });
    if (destAccounts.length !== destIds.length) return error("Destination account not found", 404);
    if (body.sourceAccountId && destIds.includes(body.sourceAccountId)) {
      return error("A destination cannot be the source account", 422);
    }
    targetsOp = {
      targets: {
        deleteMany: {},
        create: body.targets.map((t) => {
          const dest = destAccounts.find((d) => d.id === t.accountId)!;
          return {
            platform: dest.platform,
            accountId: t.accountId,
            captionMode: t.captionMode ?? "KEEP_ORIGINAL",
            captionConfig: t.captionConfig as any,
            visibility: t.visibility ?? "public",
            extraDelaySec: t.extraDelaySec ?? 0,
          };
        }),
      },
    };
  }

  const updated = await prisma.automation.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.executionMode !== undefined ? { executionMode: body.executionMode } : {}),
      ...(body.scheduleMode !== undefined ? { scheduleMode: body.scheduleMode } : {}),
      ...(body.delaySeconds !== undefined ? { delaySeconds: body.delaySeconds } : {}),
      ...(body.scheduleConfig !== undefined ? { scheduleConfig: body.scheduleConfig as any } : {}),
      ...(body.conditions !== undefined ? { conditions: body.conditions as any } : {}),
      // Re-baseline when (re)enabling so a paused automation doesn't backfill.
      ...(body.enabled === true && !existing.enabled ? { baselineAt: new Date() } : {}),
      ...targetsOp,
    },
    include: { targets: true },
  });
  return json({ automation: updated });
});

export const DELETE = withAuth(async ({ user, params }) => {
  const existing = await prisma.automation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!existing) return error("Automation not found", 404);
  await prisma.automation.delete({ where: { id: existing.id } });
  return json({ ok: true });
});
