// Publish-job status state machine. Pure; unit-tested.
// Enforces durable, legal transitions so a job can never skip from, say,
// SCHEDULED straight to PUBLISHED without passing through processing states.

export type PublishStatus =
  | "PENDING_APPROVAL"
  | "AWAITING_ASSET"
  | "SCHEDULED"
  | "QUEUED"
  | "PROCESSING"
  | "UPLOADING"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED"
  | "DRAFT_HANDOFF";

export const TERMINAL: ReadonlySet<PublishStatus> = new Set([
  "PUBLISHED",
  "CANCELLED",
  "DRAFT_HANDOFF",
]);

// FAILED is "soft terminal": retry can move it back to QUEUED.
const TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  PENDING_APPROVAL: ["SCHEDULED", "QUEUED", "AWAITING_ASSET", "CANCELLED"],
  AWAITING_ASSET: ["SCHEDULED", "QUEUED", "PENDING_APPROVAL", "CANCELLED"],
  SCHEDULED: ["QUEUED", "AWAITING_ASSET", "CANCELLED", "PROCESSING"],
  QUEUED: ["PROCESSING", "AWAITING_ASSET", "CANCELLED"],
  PROCESSING: ["UPLOADING", "FAILED", "AWAITING_ASSET", "DRAFT_HANDOFF", "CANCELLED"],
  UPLOADING: ["PUBLISHING", "PUBLISHED", "FAILED", "DRAFT_HANDOFF"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["QUEUED", "CANCELLED"],
  CANCELLED: [],
  DRAFT_HANDOFF: ["QUEUED", "CANCELLED"],
};

export function canTransition(from: PublishStatus, to: PublishStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: PublishStatus, to: PublishStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal publish-job transition: ${from} -> ${to}`);
  }
}

export function isTerminal(s: PublishStatus): boolean {
  return TERMINAL.has(s);
}

/** Can this job be retried (attempts remaining and in a retryable state)? */
export function canRetry(
  status: PublishStatus,
  attempts: number,
  maxAttempts: number,
): boolean {
  return status === "FAILED" && attempts < maxAttempts;
}

/** Exponential backoff in ms with a cap (used by worker retry scheduling). */
export function backoffMs(attempt: number, baseMs = 2000, capMs = 1000 * 60 * 30): number {
  const exp = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exp, capMs);
}
