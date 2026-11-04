import { prisma } from "@/lib/db";
import { withAuth, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const [accounts, automations, activeAutomations, detected, statusGroups, recentActivity, upcoming] = await Promise.all([
    prisma.socialAccount.count({ where: { userId: user.id } }),
    prisma.automation.count({ where: { userId: user.id } }),
    prisma.automation.count({ where: { userId: user.id, enabled: true } }),
    prisma.detectedPost.count({ where: { userId: user.id, isRepostArtifact: false } }),
    prisma.publishJob.groupBy({ by: ["status"], where: { userId: user.id }, _count: true }),
    prisma.activityEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.publishJob.findMany({
      where: { userId: user.id, status: { in: ["SCHEDULED", "QUEUED", "PENDING_APPROVAL"] }, scheduledAt: { not: null } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      include: { destinationAccount: { select: { platform: true, username: true } } },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of statusGroups) counts[g.status] = g._count;

  return json({
    stats: {
      accounts,
      automations,
      activeAutomations,
      detected,
      published: counts.PUBLISHED ?? 0,
      pending: (counts.SCHEDULED ?? 0) + (counts.QUEUED ?? 0) + (counts.PENDING_APPROVAL ?? 0) + (counts.AWAITING_ASSET ?? 0),
      failed: counts.FAILED ?? 0,
      processing: (counts.PROCESSING ?? 0) + (counts.UPLOADING ?? 0) + (counts.PUBLISHING ?? 0),
    },
    recentActivity,
    upcoming,
  });
});
