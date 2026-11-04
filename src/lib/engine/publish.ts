// Execute a single PublishJob against its destination provider.
// Idempotent, reconciliation-aware, with durable status transitions.

import { prisma } from "@/lib/db";
import { getProvider, ProviderError } from "@/lib/providers";
import { getValidAccessToken } from "./tokens";
import { logActivity, notify } from "./activity";
import { isStorageConfigured, presignDownload } from "@/lib/storage";
import { getEnv } from "@/lib/env";
import { isTerminal, type PublishStatus } from "@/lib/core/jobState";
import { queues } from "@/lib/queue";
import { logger } from "@/lib/logger";

async function setStatus(jobId: string, status: PublishStatus, extra: Record<string, unknown> = {}) {
  await prisma.publishJob.update({ where: { id: jobId }, data: { status: status as any, ...extra } });
}

export async function executePublishJob(jobId: string): Promise<void> {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { asset: true, destinationAccount: true },
  });
  if (!job) {
    logger.warn({ jobId }, "publish job not found");
    return;
  }
  if (isTerminal(job.status as PublishStatus) || job.status === "PUBLISHED") return;
  if (job.status === "PENDING_APPROVAL") return; // must be approved first
  if (job.status === "CANCELLED") return;

  // Must have an asset to publish.
  if (!job.assetId || !job.asset) {
    await setStatus(jobId, "AWAITING_ASSET");
    return;
  }

  const provider = getProvider(job.destinationPlatform);
  const env = getEnv();

  try {
    const token = await getValidAccessToken(job.destinationAccount);

    // Reconcile a possibly-lost prior attempt before uploading again.
    if (job.providerUploadRef && provider.reconcile) {
      const outcome = await provider.reconcile({ accessToken: token, providerUploadRef: job.providerUploadRef });
      if (outcome.kind === "published") {
        await finalizePublished(job.id, job.userId, job.destinationPlatform, outcome.providerPostId, outcome.url, outcome.note);
        return;
      }
      if (outcome.kind === "processing") {
        await setStatus(jobId, "PUBLISHING", { providerUploadRef: outcome.providerUploadRef });
        await scheduleReconcile(jobId);
        return;
      }
    }

    await setStatus(jobId, "PROCESSING", { startedAt: new Date(), attempts: { increment: 1 } as any });

    // Resolve a media URL the provider can pull from.
    let mediaUrl: string;
    if (env.demo) {
      mediaUrl = "https://example.com/demo-media.mp4";
    } else if (isStorageConfigured() && job.asset.storageKey) {
      mediaUrl = await presignDownload(job.asset.storageKey, 60 * 60);
    } else {
      await setStatus(jobId, "AWAITING_ASSET");
      await notify({
        userId: job.userId,
        type: "ASSET_MISSING",
        title: `Source media unavailable for ${job.destinationPlatform}`,
        body: "Upload the original video to object storage to publish this post.",
        meta: { jobId },
      });
      return;
    }

    await setStatus(jobId, "UPLOADING");

    const outcome = await provider.publish({
      accessToken: token,
      providerAccountId: job.destinationAccount.providerAccountId,
      input: {
        mediaUrl,
        caption: job.resolvedCaption ?? "",
        title: job.resolvedTitle ?? undefined,
        description: job.resolvedDescription ?? undefined,
        visibility: (job.visibility as "public" | "unlisted" | "private") ?? "public",
        priorUploadRef: job.providerUploadRef ?? undefined,
      },
    });

    switch (outcome.kind) {
      case "published":
        await finalizePublished(job.id, job.userId, job.destinationPlatform, outcome.providerPostId, outcome.url, outcome.note);
        break;
      case "processing":
        await setStatus(jobId, "PUBLISHING", { providerUploadRef: outcome.providerUploadRef });
        await scheduleReconcile(jobId);
        break;
      case "draft_handoff":
        await setStatus(jobId, "DRAFT_HANDOFF", { providerPostId: outcome.providerPostId });
        await logActivity({
          userId: job.userId,
          kind: "publish.handoff",
          jobId,
          message: `${job.destinationPlatform}: ${outcome.note}`,
        });
        break;
    }
  } catch (err) {
    await handleFailure(jobId, err);
    // Rethrow only retryable errors so BullMQ retries with backoff.
    if (err instanceof ProviderError && err.opts.retryable) throw err;
  }
}

async function finalizePublished(
  jobId: string,
  userId: string,
  platform: string,
  providerPostId: string,
  url?: string,
  note?: string,
) {
  await setStatus(jobId, "PUBLISHED", {
    providerPostId,
    publishedUrl: url,
    publishedAt: new Date(),
    // Keep provider caveats visible on the job (shown in the queue).
    lastError: note ?? null,
  });
  if (note) {
    await logActivity({ userId, kind: "publish.caveat", jobId, message: `${platform}: ${note}` });
  }
  await logActivity({
    userId,
    kind: "publish.succeeded",
    jobId,
    message: `${platform} published successfully`,
    meta: { url, providerPostId },
  });
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  if (prefs?.notifyOnPublish !== false) {
    await notify({
      userId,
      type: "PUBLISH_SUCCEEDED",
      title: `Published to ${platform}`,
      body: url ?? undefined,
      meta: { jobId },
    });
  }
}

async function handleFailure(jobId: string, err: unknown) {
  const job = await prisma.publishJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const message = String((err as any)?.message ?? err).slice(0, 1000);
  const attempts = job.attempts;
  const willRetry = err instanceof ProviderError && err.opts.retryable && attempts < job.maxAttempts;

  await prisma.publishJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: message },
  });

  logger.error({ jobId, attempts, willRetry, err }, "publish failed");

  if (!willRetry) {
    await logActivity({
      userId: job.userId,
      kind: "publish.failed",
      jobId,
      message: `${job.destinationPlatform} publish failed: ${message}`,
    });
    const prefs = await prisma.userPreferences.findUnique({ where: { userId: job.userId } });
    if (prefs?.notifyOnFailure !== false) {
      await notify({
        userId: job.userId,
        type: "PUBLISH_FAILED",
        title: `Publish failed: ${job.destinationPlatform}`,
        body: message,
        meta: { jobId },
      });
    }
  }
}

async function scheduleReconcile(jobId: string) {
  await queues.reconcile().add("reconcile", { jobId }, { delay: 15000, attempts: 10, backoff: { type: "exponential", delay: 15000 } });
}

/** Called by the reconcile queue to verify an in-flight publish completed. */
export async function reconcilePublishJob(jobId: string): Promise<void> {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { destinationAccount: true },
  });
  if (!job || job.status !== "PUBLISHING" || !job.providerUploadRef) return;
  const provider = getProvider(job.destinationPlatform);
  if (!provider.reconcile) return;

  const token = await getValidAccessToken(job.destinationAccount);
  const outcome = await provider.reconcile({ accessToken: token, providerUploadRef: job.providerUploadRef });
  if (outcome.kind === "published") {
    await finalizePublished(job.id, job.userId, job.destinationPlatform, outcome.providerPostId, outcome.url, outcome.note);
  } else if (outcome.kind === "processing") {
    throw new Error("still processing"); // BullMQ retries reconcile with backoff
  }
}
