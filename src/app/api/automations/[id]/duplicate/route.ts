import { prisma } from "@/lib/db";
import { withAuth, json, error } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withAuth(async ({ user, params }) => {
  const src = await prisma.automation.findFirst({
    where: { id: params.id, userId: user.id },
    include: { targets: true },
  });
  if (!src) return error("Automation not found", 404);

  const copy = await prisma.automation.create({
    data: {
      userId: user.id,
      name: `${src.name} (copy)`,
      enabled: false,
      sourcePlatform: src.sourcePlatform,
      sourceAccountId: src.sourceAccountId,
      executionMode: src.executionMode,
      scheduleMode: src.scheduleMode,
      delaySeconds: src.delaySeconds,
      scheduleConfig: src.scheduleConfig as any,
      conditions: src.conditions as any,
      baselineAt: new Date(),
      targets: {
        create: src.targets.map((t) => ({
          platform: t.platform,
          accountId: t.accountId,
          captionMode: t.captionMode,
          captionConfig: t.captionConfig as any,
          visibility: t.visibility,
          extraDelaySec: t.extraDelaySec,
        })),
      },
    },
    include: { targets: true },
  });
  return json({ automation: copy }, 201);
});
