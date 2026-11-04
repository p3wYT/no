// Match a detected source post to an original media asset in the library.
// Pure; unit-tested. Platforms do not reliably expose downloadable originals,
// so matching bridges a detected post to user-provided media.

export interface AssetCandidate {
  id: string;
  contentHash?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt: Date;
  // If the asset was uploaded already tagged to a post/account.
  hintProviderPostId?: string | null;
}

export interface DetectedPostLike {
  providerPostId: string;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  publishedAt?: Date | null;
  // Hash computed from media the user explicitly attached to this post.
  providedContentHash?: string | null;
}

export interface MatchResult {
  assetId: string | null;
  // 0..1
  confidence: number;
  reason: string;
}

function aspect(w?: number | null, h?: number | null): number | null {
  if (!w || !h) return null;
  return w / h;
}

/**
 * Score each candidate and return the best. Confidence >= 0.9 is safe to
 * auto-associate; 0.5..0.9 should ask the user to confirm; below → no match.
 */
export function matchAsset(
  post: DetectedPostLike,
  candidates: AssetCandidate[],
): MatchResult {
  let best: MatchResult = { assetId: null, confidence: 0, reason: "No candidate media" };

  for (const c of candidates) {
    // 1. Exact content hash → certain.
    if (post.providedContentHash && c.contentHash && post.providedContentHash === c.contentHash) {
      return { assetId: c.id, confidence: 1, reason: "Exact file hash match" };
    }

    // 2. Explicit upload hint tagging this post.
    if (c.hintProviderPostId && c.hintProviderPostId === post.providerPostId) {
      return { assetId: c.id, confidence: 0.98, reason: "Uploaded and tagged to this post" };
    }

    // 3. Heuristic: duration + aspect + upload recency near publish time.
    let score = 0;
    const reasons: string[] = [];

    if (post.durationSec != null && c.durationSec != null) {
      const diff = Math.abs(post.durationSec - c.durationSec);
      if (diff <= 0.75) {
        score += 0.5;
        reasons.push("duration");
      } else if (diff <= 2) {
        score += 0.25;
      }
    }

    const pa = aspect(post.width, post.height);
    const ca = aspect(c.width, c.height);
    if (pa != null && ca != null && Math.abs(pa - ca) < 0.05) {
      score += 0.25;
      reasons.push("aspect");
    }

    if (post.publishedAt) {
      const hrs = Math.abs(post.publishedAt.getTime() - c.createdAt.getTime()) / 3_600_000;
      if (hrs <= 24) {
        score += 0.2;
        reasons.push("upload timing");
      } else if (hrs <= 24 * 7) {
        score += 0.08;
      }
    }

    if (score > best.confidence) {
      best = {
        assetId: c.id,
        confidence: Math.min(score, 0.89),
        reason: reasons.length ? `Heuristic match (${reasons.join(", ")})` : "Weak heuristic match",
      };
    }
  }

  return best;
}

export const AUTO_MATCH_THRESHOLD = 0.9;
export const SUGGEST_MATCH_THRESHOLD = 0.5;
