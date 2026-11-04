import { prisma } from "@/lib/db";
import { withAuth, json } from "@/lib/api";
import { allCapabilities } from "@/lib/providers";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const accounts = await prisma.socialAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, platform: true, providerAccountId: true, username: true, displayName: true,
      avatarUrl: true, status: true, canPublish: true, statusDetail: true, scopes: true,
      monitoringOn: true, pollIntervalSec: true, lastCheckedAt: true, nextCheckAt: true,
      lastError: true, createdAt: true,
    },
  });
  return json({ accounts, capabilities: allCapabilities() });
});
