// Pure rule / condition evaluation. No I/O. Unit-tested.

export interface RuleConditions {
  minDurationSec?: number;
  maxDurationSec?: number;
  // Only posts published at/after this ISO datetime.
  publishedAfter?: string;
  // Caption must contain at least one of these (case-insensitive).
  includeKeywords?: string[];
  // Caption must contain none of these.
  excludeKeywords?: string[];
  // Only vertical (height > width).
  onlyVertical?: boolean;
  // Provider post ids to always skip.
  excludePostIds?: string[];
  // 0-6 (Sun-Sat) in the automation's timezone; empty = any day.
  allowedDays?: number[];
  // [startHour, endHour) 0-23 window; omitted = any hour.
  allowedHours?: { start: number; end: number };
}

export interface CandidatePost {
  providerPostId: string;
  caption?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  publishedAt?: Date | null;
  // Guard: a post RepostFlow itself produced must never re-enter as source.
  isRepostArtifact?: boolean;
}

export interface EvalResult {
  pass: boolean;
  reasons: string[];
}

/** Returns hour (0-23) and day-of-week (0-6) in a timezone. */
export function zonedParts(d: Date, timezone: string): { hour: number; day: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(d);
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    let hour = parseInt(hourStr, 10);
    if (hour === 24) hour = 0;
    const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return { hour, day: map[wdStr] ?? 0 };
  } catch {
    return { hour: d.getUTCHours(), day: d.getUTCDay() };
  }
}

/**
 * Evaluate whether a candidate post should be processed by an automation.
 * `evalTime` is when the decision is made (for day/hour windows).
 */
export function evaluateConditions(
  post: CandidatePost,
  cond: RuleConditions | null | undefined,
  opts: { evalTime: Date; timezone: string; baselineAt?: Date | null },
): EvalResult {
  const reasons: string[] = [];

  // Hard loop guard — always first, cannot be overridden by config.
  if (post.isRepostArtifact) {
    return { pass: false, reasons: ["Post was created by RepostFlow (loop protection)"] };
  }

  // Baseline: no historical reposting unless explicitly backfilled.
  if (opts.baselineAt && post.publishedAt && post.publishedAt < opts.baselineAt) {
    reasons.push("Published before automation baseline");
  }

  const c = cond ?? {};

  if (c.excludePostIds?.includes(post.providerPostId)) {
    reasons.push("Post is in the exclusion list");
  }

  const dur = post.durationSec ?? undefined;
  if (c.minDurationSec != null && dur != null && dur < c.minDurationSec) {
    reasons.push(`Shorter than minimum (${c.minDurationSec}s)`);
  }
  if (c.maxDurationSec != null && dur != null && dur > c.maxDurationSec) {
    reasons.push(`Longer than maximum (${c.maxDurationSec}s)`);
  }

  if (c.publishedAfter && post.publishedAt) {
    const after = new Date(c.publishedAfter);
    if (!isNaN(after.getTime()) && post.publishedAt < after) {
      reasons.push("Published before the required date");
    }
  }

  const caption = (post.caption ?? "").toLowerCase();
  if (c.includeKeywords?.length) {
    const hit = c.includeKeywords.some((k) => caption.includes(k.toLowerCase()));
    if (!hit) reasons.push("Caption missing required keyword");
  }
  if (c.excludeKeywords?.length) {
    const bad = c.excludeKeywords.find((k) => caption.includes(k.toLowerCase()));
    if (bad) reasons.push(`Caption contains excluded keyword "${bad}"`);
  }

  if (c.onlyVertical) {
    const w = post.width ?? 0;
    const h = post.height ?? 0;
    if (w && h && h <= w) reasons.push("Video is not vertical");
  }

  if (c.allowedDays?.length) {
    const { day } = zonedParts(opts.evalTime, opts.timezone);
    if (!c.allowedDays.includes(day)) reasons.push("Outside allowed days");
  }

  if (c.allowedHours) {
    const { hour } = zonedParts(opts.evalTime, opts.timezone);
    const { start, end } = c.allowedHours;
    const inWindow =
      start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!inWindow) reasons.push("Outside allowed hours");
  }

  return { pass: reasons.length === 0, reasons };
}
