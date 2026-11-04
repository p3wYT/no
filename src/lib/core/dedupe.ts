// Duplicate-publish prevention + content lineage (loop protection).
// Pure; unit-tested. The DB unique constraint on PublishJob.idempotencyKey is
// the durable enforcement — this computes the key deterministically.

import { createHash } from "node:crypto";

/**
 * Deterministic idempotency key for a single (automation, source post,
 * destination account) publish. Re-running detection or a worker retry yields
 * the SAME key, so the unique constraint rejects a second insert.
 */
export function buildIdempotencyKey(params: {
  automationId: string;
  detectedPostId: string;
  destinationAccountId: string;
}): string {
  const raw = `${params.automationId}::${params.detectedPostId}::${params.destinationAccountId}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

/**
 * Decide whether a freshly observed provider post is genuinely new source
 * content worth considering (not a prior detection, not a repost we made).
 */
export function isNewSourcePost(params: {
  providerPostId: string;
  knownProviderPostIds: Set<string>;
  // Provider ids that RepostFlow published (its own outputs) — never re-ingest.
  lineageProviderPostIds: Set<string>;
  isRepostArtifact?: boolean;
}): boolean {
  if (params.isRepostArtifact) return false;
  if (params.lineageProviderPostIds.has(params.providerPostId)) return false;
  if (params.knownProviderPostIds.has(params.providerPostId)) return false;
  return true;
}
