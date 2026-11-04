import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { automationSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const automations = await prisma.automation.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      sourceAccount: { select: { id: true, platform: true, username: true, avatarUrl: true } },
      targets: { include: { account: { select: { id: true, platform: true, username: true, avatarUrl: true } } } },
      _count: { select: { publishJobs: true } },
    },
  });
  return json({ automations });
});

export const POST = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, automationSchema);

  const source = await prisma.socialAccount.findFirst({
    where: { id: body.sourceAccountId, userId: user.id },
  });
  if (!source) return error("Source account not found", 404);
  if (source.platform !== body.sourcePlatform) return error("Source platform mismatch", 422);

  // Every destination must belong to the user.
  const destIds = body.targets.map((t) => t.accountId);
  const destAccounts = await prisma.socialAccount.findMany({
    where: { id: { in: destIds }, userId: user.id },
  });
  if (destAccounts.length !== destIds.length) return error("One or more destination accounts not found", 404);

  // Loop guard: destination may not equal source account.
  if (destIds.includes(body.sourceAccountId)) {
    return error("A destination cannot be the same account as the source", 422);
  }

  const automation = await prisma.automation.create({
    data: {
      userId: user.id,
      name: body.name,
      enabled: body.enabled,
      sourcePlatform: body.sourcePlatform,
      sourceAccountId: body.sourceAccountId,
      executionMode: body.executionMode,
      scheduleMode: body.scheduleMode,
      delaySeconds: body.delaySeconds,
      scheduleConfig: body.scheduleConfig as any,
      conditions: body.conditions as any,
      // Baseline on creation → only new content is processed, no backfill.
      baselineAt: new Date(),
      targets: {
        create: body.targets.map((t) => {
          const dest = destAccounts.find((d) => d.id === t.accountId)!;
          return {
            platform: dest.platform,
            accountId: t.accountId,
            captionMode: t.captionMode,
            captionConfig: t.captionConfig as any,
            visibility: t.visibility,
            extraDelaySec: t.extraDelaySec,
          };
        }),
      },
    },
    include: { targets: true },
  });
  return json({ automation }, 201);
});
