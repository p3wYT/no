// BullMQ queue definitions. One place defines queue names + typed payloads
// so producers (web) and consumers (worker) stay in sync.

import { Queue, type JobsOptions } from "bullmq";
import { createRedis } from "./redis";

export const QUEUE = {
  detect: "detect", // poll a source account for new posts
  match: "match", // match a detected post to an asset
  process: "process", // ffmpeg probe / convert an asset
  publish: "publish", // publish one PublishJob to a destination
  reconcile: "reconcile", // verify a provider accepted an upload
  tokenRefresh: "token-refresh",
  maintenance: "maintenance", // cleanup, scheduler scans
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface DetectPayload { accountId: string; manual?: boolean }
export interface MatchPayload { detectedPostId: string }
export interface ProcessPayload { assetId: string }
export interface PublishPayload { jobId: string }
export interface ReconcilePayload { jobId: string }
export interface TokenRefreshPayload { accountId: string }
export interface MaintenancePayload { task: "scheduler" | "cleanup" | "poll-scan" | "token-scan" }

const connection = createRedis();

function makeQueue<T>(name: QueueName): Queue<T> {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  });
}

const globalForQueues = globalThis as unknown as {
  __rf_queues?: Record<string, Queue>;
};

function getQueues() {
  if (!globalForQueues.__rf_queues) {
    globalForQueues.__rf_queues = {
      [QUEUE.detect]: makeQueue<DetectPayload>(QUEUE.detect),
      [QUEUE.match]: makeQueue<MatchPayload>(QUEUE.match),
      [QUEUE.process]: makeQueue<ProcessPayload>(QUEUE.process),
      [QUEUE.publish]: makeQueue<PublishPayload>(QUEUE.publish),
      [QUEUE.reconcile]: makeQueue<ReconcilePayload>(QUEUE.reconcile),
      [QUEUE.tokenRefresh]: makeQueue<TokenRefreshPayload>(QUEUE.tokenRefresh),
      [QUEUE.maintenance]: makeQueue<MaintenancePayload>(QUEUE.maintenance),
    };
  }
  return globalForQueues.__rf_queues;
}

export const queues = {
  detect: () => getQueues()[QUEUE.detect] as Queue<DetectPayload>,
  match: () => getQueues()[QUEUE.match] as Queue<MatchPayload>,
  process: () => getQueues()[QUEUE.process] as Queue<ProcessPayload>,
  publish: () => getQueues()[QUEUE.publish] as Queue<PublishPayload>,
  reconcile: () => getQueues()[QUEUE.reconcile] as Queue<ReconcilePayload>,
  tokenRefresh: () => getQueues()[QUEUE.tokenRefresh] as Queue<TokenRefreshPayload>,
  maintenance: () => getQueues()[QUEUE.maintenance] as Queue<MaintenancePayload>,
};

/**
 * Enqueue a publish at a specific time using a jobId derived from the DB
 * PublishJob id — BullMQ de-duplicates jobs with the same jobId, giving a
 * second layer of idempotency on top of the DB unique constraint.
 */
export async function enqueuePublishAt(jobId: string, when: Date): Promise<void> {
  const q = queues.publish();
  const id = `publish:${jobId}`;
  // BullMQ ignores add() for an id that already exists (finished jobs are kept
  // for days), which would turn retries and reschedules into silent no-ops.
  // Replace any existing job unless it is running right now; the DB status is
  // the guard against double-publishing.
  const existing = await q.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (state === "active") return;
    await existing.remove().catch(() => undefined);
  }
  const delay = when.getTime() - Date.now();
  // Only pass delay when positive: an explicit delay of 0 parks the job in the
  // delayed set instead of the wait queue.
  const opts: JobsOptions = delay > 0 ? { jobId: id, delay } : { jobId: id };
  await q.add("publish", { jobId }, opts);
}

export async function enqueueDetect(accountId: string, manual = false): Promise<void> {
  await queues.detect().add("detect", { accountId, manual }, { jobId: manual ? undefined : `detect:${accountId}:${Math.floor(Date.now() / 60000)}` });
}
