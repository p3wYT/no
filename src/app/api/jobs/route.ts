import { prisma } from "@/lib/db";
import { withAuth, json } from "@/lib/api";
import type { PublishStatus, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const TAB_STATUSES: Record<string, PublishStatus[]> = {
  upcoming: ["SCHEDULED", "QUEUED", "PENDING_APPROVAL"],
  processing: ["PROCESSING", "UPLOADING", "PUBLISHING"],
  awaiting_asset: ["AWAITING_ASSET"],
  awaiting_approval: ["PENDING_APPROVAL"],
  published: ["PUBLISHED", "DRAFT_HANDOFF"],
  failed: ["FAILED"],
};

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab");
  const where: Prisma.PublishJobWhereInput = { userId: user.id };
  if (tab && TAB_STATUSES[tab]) where.status = { in: TAB_STATUSES[tab] };

  const jobs = await prisma.publishJob.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      destinationAccount: { select: { id: true, platform: true, username: true, avatarUrl: true } },
      detectedPost: { select: { id: true, platform: true, thumbnailUrl: true, caption: true, title: true, permalink: true } },
      asset: { select: { id: true, title: true, thumbnailKey: true, durationSec: true } },
      automation: { select: { id: true, name: true } },
    },
  });

  // Counts per tab for the UI badges.
  const grouped = await prisma.publishJob.groupBy({
    by: ["status"],
    where: { userId: user.id },
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count;

  return json({ jobs, counts });
});
