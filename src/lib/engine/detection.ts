// Source-post detection: poll a connected account, persist genuinely-new
// posts, and fan them out through automations. Loop-safe via lineage checks.

import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import { getValidAccessToken } from "./tokens";
import { isNewSourcePost } from "@/lib/core/dedupe";
import { processDetectedPost } from "./automations";
import { logActivity } from "./activity";
import { logger } from "@/lib/logger";

export interface DetectSummary {
  accountId: string;
  fetched: number;
  created: number;
  skipped: number;
}

export async function detectForAccount(accountId: string, manual = false): Promise<DetectSummary> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  if (!manual && (!account.monitoringOn || account.status !== "CONNECTED")) {
    return { accountId, fetched: 0, created: 0, skipped: 0 };
  }

  const summary: DetectSummary = { accountId, fetched: 0, created: 0, skipped: 0 };

  try {
    const token = await getValidAccessToken(account);
    const provider = getProvider(account.platform);
    const posts = await provider.listRecentPosts({
      accessToken: token,
      providerAccountId: account.providerAccountId,
      limit: 20,
    });
    summary.fetched = posts.length;

    // Known ids already stored for this account.
    const known = new Set(
      (
        await prisma.detectedPost.findMany({
          where: { accountId },
          select: { providerPostId: true },
        })
      ).map((p) => p.providerPostId),
    );

    // Lineage: provider post ids RepostFlow itself published to THIS account.
    const lineage = new Set(
      (
        await prisma.publishJob.findMany({
          where: { destinationAccountId: accountId, providerPostId: { not: null } },
          select: { providerPostId: true },
        })
      )
        .map((j) => j.providerPostId)
        .filter((x): x is string => !!x),
    );

    for (const post of posts) {
      if (!post.providerPostId) continue;
      const isArtifact = lineage.has(post.providerPostId);
      const fresh = isNewSourcePost({
        providerPostId: post.providerPostId,
        knownProviderPostIds: known,
        lineageProviderPostIds: lineage,
      });

      if (!fresh) {
        summary.skipped++;
        continue;
      }

      const created = await prisma.detectedPost.create({
        data: {
          userId: account.userId,
          accountId,
          platform: account.platform,
          providerPostId: post.providerPostId,
          caption: post.caption,
          title: post.title,
          permalink: post.permalink,
          thumbnailUrl: post.thumbnailUrl,
          durationSec: post.durationSec,
          width: post.width,
          height: post.height,
          publishedAt: post.publishedAt,
          isRepostArtifact: isArtifact,
        },
      });
      summary.created++;

      if (!isArtifact) {
        await logActivity({
          userId: account.userId,
          kind: "post.detected",
          message: `New ${account.platform} video detected${post.title ? `: ${post.title}` : ""}`,
          meta: { detectedPostId: created.id },
        });
        await processDetectedPost(created.id);
      }
    }

    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        lastCheckedAt: new Date(),
        nextCheckAt: new Date(Date.now() + account.pollIntervalSec * 1000),
        lastError: null,
        status: "CONNECTED",
      },
    });
  } catch (err: any) {
    logger.error({ err, accountId }, "detection failed");
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        lastError: String(err?.message ?? err).slice(0, 500),
        nextCheckAt: new Date(Date.now() + account.pollIntervalSec * 1000),
      },
    });
    throw err;
  }

  return summary;
}
