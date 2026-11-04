import { prisma } from "@/lib/db";
import { withAuth, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const unmatchedOnly = url.searchParams.get("unmatched") === "1";
  const posts = await prisma.detectedPost.findMany({
    where: {
      userId: user.id,
      isRepostArtifact: false,
      ...(unmatchedOnly ? { matchedAssetId: null } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
    include: { account: { select: { platform: true, username: true } } },
  });
  return json({ posts });
});
