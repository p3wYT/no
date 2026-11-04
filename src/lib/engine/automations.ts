// Automation fan-out: turn one detected post into scheduled publish jobs.

import { prisma } from "@/lib/db";
import { evaluateConditions, type RuleConditions } from "@/lib/core/rules";
import { computeScheduledAt, type ScheduleConfig } from "@/lib/core/scheduling";
import { buildCaption, buildTitle, type CaptionConfig } from "@/lib/core/captions";
import { buildIdempotencyKey } from "@/lib/core/dedupe";
import { matchAsset, AUTO_MATCH_THRESHOLD } from "@/lib/core/matching";
import { enqueuePublishAt } from "@/lib/queue";
import { logActivity, notify } from "./activity";
import { logger } from "@/lib/logger";
import type { Platform, PublishStatus } from "@prisma/client";

function captionConfigFor(mode: string, raw: any): CaptionConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    mode: mode as CaptionConfig["mode"],
    template: typeof c.template === "string" ? c.template : undefined,
    addHashtags: Array.isArray(c.addHashtags) ? (c.addHashtags as string[]) : undefined,
    removeHashtags: Array.isArray(c.removeHashtags) ? (c.removeHashtags as string[]) : undefined,
    prefix: typeof c.prefix === "string" ? c.prefix : undefined,
    suffix: typeof c.suffix === "string" ? c.suffix : undefined,
    findReplace: Array.isArray(c.findReplace) ? (c.findReplace as any) : undefined,
  };
}

/**
 * Attempt to find/attach an original media asset for a detected post.
 * Returns the matched assetId or null.
 */
export async function ensureAssetMatch(detectedPostId: string): Promise<string | null> {
  const post = await prisma.detectedPost.findUnique({ where: { id: detectedPostId } });
  if (!post) return null;
  if (post.matchedAssetId) return post.matchedAssetId;

  const assets = await prisma.videoAsset.findMany({
    where: { userId: post.userId, uploadComplete: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const result = matchAsset(
    {
      providerPostId: post.providerPostId,
      durationSec: post.durationSec,
      width: post.width,
      height: post.height,
      publishedAt: post.publishedAt,
    },
    assets.map((a) => ({
      id: a.id,
      contentHash: a.contentHash,
      durationSec: a.durationSec,
      width: a.width,
      height: a.height,
      createdAt: a.createdAt,
    })),
  );

  if (result.assetId && result.confidence >= AUTO_MATCH_THRESHOLD) {
    await prisma.detectedPost.update({
      where: { id: post.id },
      data: { matchedAssetId: result.assetId },
    });
    await logActivity({
      userId: post.userId,
      kind: "asset.matched",
      message: `Original media matched automatically (${result.reason})`,
      meta: { detectedPostId: post.id, assetId: result.assetId },
    });
    return result.assetId;
  }
  return null;
}

type PostLike = Awaited<ReturnType<typeof prisma.detectedPost.findUnique>> & {
  account: { username: string | null };
};
type AutomationWithTargets = Awaited<ReturnType<typeof prisma.automation.findFirst>> & {
  targets: Array<{
    accountId: string;
    platform: Platform;
    captionMode: string;
    captionConfig: unknown;
    visibility: string;
    extraDelaySec: number;
  }>;
};

export async function processDetectedPost(detectedPostId: string): Promise<void> {
  const post = await prisma.detectedPost.findUnique({
    where: { id: detectedPostId },
    include: { account: true },
  });
  if (!post || post.isRepostArtifact) return;

  const prefs = await prisma.userPreferences.findUnique({ where: { userId: post.userId } });
  const timezone = prefs?.timezone ?? "UTC";

  const automations = await prisma.automation.findMany({
    where: { userId: post.userId, enabled: true, sourceAccountId: post.accountId },
    include: { targets: { include: { account: true } } },
  });
  if (automations.length === 0) return;

  const assetId = await ensureAssetMatch(detectedPostId);
  const now = new Date();

  for (const automation of automations) {
    const conditions = (automation.conditions ?? {}) as RuleConditions;
    const evaluation = evaluateConditions(
      {
        providerPostId: post.providerPostId,
        caption: post.caption,
        durationSec: post.durationSec,
        width: post.width,
        height: post.height,
        publishedAt: post.publishedAt,
        isRepostArtifact: post.isRepostArtifact,
      },
      conditions,
      { evalTime: now, timezone, baselineAt: automation.baselineAt },
    );

    if (!evaluation.pass) {
      logger.debug({ automationId: automation.id, reasons: evaluation.reasons }, "post filtered out");
      continue;
    }

    await fanOutToTargets(automation as any, post as any, timezone, assetId, now);
    await prisma.automation.update({ where: { id: automation.id }, data: { lastRunAt: now } });
  }
}

/**
 * Explicit backfill: process the source account's existing detected posts for
 * one automation, bypassing the baseline. Never triggered automatically.
 */
export async function backfillAutomation(automationId: string, limit = 50): Promise<number> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    include: { targets: { include: { account: true } } },
  });
  if (!automation) return 0;
  const prefs = await prisma.userPreferences.findUnique({ where: { userId: automation.userId } });
  const timezone = prefs?.timezone ?? "UTC";
  const now = new Date();

  const posts = await prisma.detectedPost.findMany({
    where: { accountId: automation.sourceAccountId, isRepostArtifact: false },
    include: { account: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });

  let count = 0;
  for (const post of posts) {
    const conditions = (automation.conditions ?? {}) as RuleConditions;
    const evaluation = evaluateConditions(
      {
        providerPostId: post.providerPostId,
        caption: post.caption,
        durationSec: post.durationSec,
        width: post.width,
        height: post.height,
        publishedAt: post.publishedAt,
        isRepostArtifact: post.isRepostArtifact,
      },
      conditions,
      { evalTime: now, timezone, baselineAt: null }, // bypass baseline
    );
    if (!evaluation.pass) continue;
    const assetId = await ensureAssetMatch(post.id);
    await fanOutToTargets(automation as any, post as any, timezone, assetId, now);
    count++;
  }
  return count;
}

async function fanOutToTargets(
  automation: AutomationWithTargets,
  post: PostLike,
  timezone: string,
  assetId: string | null,
  now: Date,
): Promise<void> {
  {
    for (const target of automation.targets) {
      const idempotencyKey = buildIdempotencyKey({
        automationId: automation.id,
        detectedPostId: post.id,
        destinationAccountId: target.accountId,
      });

      // QUEUE mode needs the latest scheduled time on this destination.
      let lastQueuedAt: Date | null = null;
      if (automation.scheduleMode === "QUEUE") {
        const last = await prisma.publishJob.findFirst({
          where: {
            destinationAccountId: target.accountId,
            status: { in: ["SCHEDULED", "QUEUED"] },
          },
          orderBy: { scheduledAt: "desc" },
        });
        lastQueuedAt = last?.scheduledAt ?? null;
      }

      const scheduledAt = computeScheduledAt({
        mode: automation.scheduleMode,
        config: (automation.scheduleConfig ?? undefined) as ScheduleConfig | undefined,
        delaySeconds: automation.delaySeconds,
        extraDelaySec: target.extraDelaySec,
        now,
        timezone,
        lastQueuedAt,
      });

      const captionConfig = captionConfigFor(target.captionMode, target.captionConfig);
      const ctx = {
        originalCaption: post.caption ?? "",
        title: post.title ?? undefined,
        sourcePlatform: post.platform,
        sourceUsername: post.account.username ?? "",
        now: scheduledAt,
        timezone,
      };
      const caption = buildCaption(target.platform as Platform, captionConfig, ctx);
      const title = buildTitle(target.platform as Platform, captionConfig, ctx);

      let status: PublishStatus;
      if (automation.executionMode === "APPROVAL_REQUIRED") {
        status = "PENDING_APPROVAL";
      } else if (!assetId) {
        status = "AWAITING_ASSET";
      } else {
        status = "SCHEDULED";
      }

      try {
        const job = await prisma.publishJob.create({
          data: {
            userId: post.userId,
            automationId: automation.id,
            detectedPostId: post.id,
            assetId: assetId ?? undefined,
            destinationAccountId: target.accountId,
            destinationPlatform: target.platform,
            status,
            scheduledAt,
            resolvedCaption: caption.text,
            resolvedTitle: title,
            resolvedDescription: caption.text,
            visibility: target.visibility,
            idempotencyKey,
          },
        });

        await logActivity({
          userId: post.userId,
          kind: "publish.scheduled",
          jobId: job.id,
          message:
            status === "PENDING_APPROVAL"
              ? `${target.platform} post awaiting approval`
              : status === "AWAITING_ASSET"
                ? `${target.platform} post awaiting source video`
                : `${target.platform} post scheduled for ${scheduledAt.toISOString()}`,
          meta: { scheduledAt, status },
        });

        if (status === "PENDING_APPROVAL") {
          await notify({
            userId: post.userId,
            type: "APPROVAL_REQUIRED",
            title: `Approval needed: ${target.platform}`,
            body: `A new ${post.platform} video is ready to cross-post to ${target.platform}.`,
            meta: { jobId: job.id },
          });
        } else if (status === "AWAITING_ASSET") {
          await notify({
            userId: post.userId,
            type: "ASSET_MISSING",
            title: `Source video needed for ${target.platform}`,
            body: `Upload or match the original video to publish this post.`,
            meta: { jobId: job.id },
          });
        } else {
          await enqueuePublishAt(job.id, scheduledAt);
        }
      } catch (err: any) {
        // Unique constraint on idempotencyKey => already created. Idempotent.
        if (err?.code === "P2002") {
          logger.debug({ idempotencyKey }, "publish job already exists, skipping");
          continue;
        }
        throw err;
      }
    }
  }
}
