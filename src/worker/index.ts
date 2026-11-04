// RepostFlow background worker. Runs as a SEPARATE Railway service.
// Owns all polling, scheduling, media processing, publishing and reconciliation
// so the product works with no browser open and no user's machine online.

import http from "node:http";
import { Worker, type Processor } from "bullmq";
import { createRedis } from "@/lib/redis";
import { QUEUE, queues } from "@/lib/queue";
import type {
  DetectPayload,
  MatchPayload,
  ProcessPayload,
  PublishPayload,
  ReconcilePayload,
  TokenRefreshPayload,
  MaintenancePayload,
} from "@/lib/queue";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { detectForAccount } from "@/lib/engine/detection";
import { executePublishJob, reconcilePublishJob } from "@/lib/engine/publish";
import { processDetectedPost, ensureAssetMatch } from "@/lib/engine/automations";
import { probeAndStoreAsset } from "@/lib/engine/media";
import { refreshAccountToken } from "@/lib/engine/maintenance";
import { ensureBucketCors, isStorageConfigured } from "@/lib/storage";

getEnv(); // validate env on startup; crash loudly if misconfigured.

const connection = createRedis();
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

function worker<T>(name: string, processor: Processor<T>, concurrency = CONCURRENCY): Worker<T> {
  const w = new Worker<T>(name, processor, {
    connection,
    concurrency,
    // Jobs limited so we respect provider rate limits.
    limiter: { max: 20, duration: 1000 },
  });
  w.on("failed", (job, err) => logger.error({ queue: name, jobId: job?.id, err: err.message }, "job failed"));
  w.on("completed", (job) => logger.debug({ queue: name, jobId: job.id }, "job completed"));
  return w;
}

const workers: Worker[] = [
  worker<DetectPayload>(QUEUE.detect, async (job) => {
    return detectForAccount(job.data.accountId, job.data.manual);
  }),

  worker<MatchPayload>(QUEUE.match, async (job) => {
    await ensureAssetMatch(job.data.detectedPostId);
    await processDetectedPost(job.data.detectedPostId);
  }),

  worker<ProcessPayload>(QUEUE.process, async (job) => {
    await probeAndStoreAsset(job.data.assetId);
  }),

  // Publish is single-flight per worker process to avoid double-publishing;
  // the DB idempotencyKey + BullMQ jobId are the real guards.
  worker<PublishPayload>(QUEUE.publish, async (job) => {
    await executePublishJob(job.data.jobId);
  }, Number(process.env.PUBLISH_CONCURRENCY ?? 3)),

  worker<ReconcilePayload>(QUEUE.reconcile, async (job) => {
    await reconcilePublishJob(job.data.jobId);
  }),

  worker<TokenRefreshPayload>(QUEUE.tokenRefresh, async (job) => {
    await refreshAccountToken(job.data.accountId);
  }),

  worker<MaintenancePayload>(QUEUE.maintenance, async (job) => {
    await runMaintenance(job.data.task);
  }),
];

async function runMaintenance(task: MaintenancePayload["task"]) {
  const now = new Date();
  if (task === "poll-scan") {
    // Enqueue detection for any account due for a check.
    const due = await prisma.socialAccount.findMany({
      where: {
        monitoringOn: true,
        status: "CONNECTED",
        OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
      },
      select: { id: true },
      take: 200,
    });
    for (const a of due) {
      await queues.detect().add("detect", { accountId: a.id }, { jobId: `detect:${a.id}:${Math.floor(now.getTime() / 60000)}` });
    }
    logger.info({ count: due.length }, "poll-scan enqueued detections");
  } else if (task === "scheduler") {
    // Safety net: re-enqueue SCHEDULED publish jobs that are due (survives
    // redeploys / lost delayed jobs).
    const due = await prisma.publishJob.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now } },
      select: { id: true, scheduledAt: true },
      take: 200,
    });
    for (const j of due) {
      await queues.publish().add("publish", { jobId: j.id }, { jobId: `publish:${j.id}` });
    }
    if (due.length) logger.info({ count: due.length }, "scheduler re-enqueued due jobs");
  } else if (task === "cleanup") {
    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90);
    await prisma.activityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    logger.info("cleanup complete");
  }
}

async function installRepeatables() {
  const mq = queues.maintenance();
  await mq.add("poll-scan", { task: "poll-scan" }, { repeat: { every: 60_000 }, jobId: "repeat:poll-scan" });
  await mq.add("scheduler", { task: "scheduler" }, { repeat: { every: 60_000 }, jobId: "repeat:scheduler" });
  await mq.add("cleanup", { task: "cleanup" }, { repeat: { pattern: "0 4 * * *" }, jobId: "repeat:cleanup" });
  logger.info("repeatable maintenance jobs installed");
}

// Lightweight health endpoint for Railway worker service.
const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8080);
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    try {
      await connection.ping();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", workers: workers.length }));
    } catch {
      res.writeHead(503);
      res.end(JSON.stringify({ status: "degraded" }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, () => logger.info({ port }, "worker health server listening"));

// Allow browser uploads/previews from the app's origin. Non-fatal: the worker
// keeps running if the provider rejects it, and the failure is logged.
if (isStorageConfigured()) {
  const origin = new URL(getEnv().APP_URL).origin;
  ensureBucketCors(origin)
    .then(() => logger.info({ origin }, "bucket CORS configured"))
    .catch((err) => logger.error({ err: err?.message ?? String(err) }, "bucket CORS configuration failed"));
} else {
  logger.warn("object storage not configured; video uploads are disabled");
}

installRepeatables().catch((err) => {
  logger.error({ err }, "failed to install repeatables");
  process.exit(1);
});

logger.info("RepostFlow worker started");

// Graceful shutdown: stop accepting new jobs, finish in-flight, then exit.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down worker");
  server.close();
  await Promise.allSettled(workers.map((w) => w.close()));
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
