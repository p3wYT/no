// Pure caption transformation engine.
// No I/O. Fully unit-tested in tests/captions.test.ts.

import { platformSpec, type Platform } from "./platform";

export type CaptionMode = "KEEP_ORIGINAL" | "CUSTOM" | "TEMPLATE";

export interface CaptionContext {
  originalCaption: string;
  title?: string;
  sourcePlatform: string;
  sourceUsername: string;
  // ISO date the post is being published (for {{date}}).
  now: Date;
  timezone?: string;
}

export interface CaptionConfig {
  mode: CaptionMode;
  // For CUSTOM / TEMPLATE
  template?: string;
  // Transformations applied AFTER base text is produced.
  addHashtags?: string[];
  removeHashtags?: string[];
  prefix?: string;
  suffix?: string;
  findReplace?: Array<{ find: string; replace: string }>;
}

const VAR_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

function formatDate(d: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function renderTemplate(template: string, ctx: CaptionContext): string {
  const vars: Record<string, string> = {
    original_caption: ctx.originalCaption ?? "",
    caption: ctx.originalCaption ?? "",
    title: ctx.title ?? "",
    source_platform: ctx.sourcePlatform ?? "",
    source_username: ctx.sourceUsername ?? "",
    date: formatDate(ctx.now, ctx.timezone),
  };
  return template.replace(VAR_PATTERN, (_m, name: string) => {
    const key = name.toLowerCase();
    return key in vars ? vars[key] : "";
  });
}

function normalizeTag(tag: string): string {
  const t = tag.trim().replace(/^#+/, "");
  return t.toLowerCase();
}

export function applyHashtags(
  text: string,
  add: string[] = [],
  remove: string[] = [],
): string {
  let result = text;

  // Remove: strip matching hashtags (case-insensitive) wherever they appear.
  for (const raw of remove) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const re = new RegExp(`#${escapeRegExp(tag)}\\b`, "gi");
    result = result.replace(re, "").replace(/[ \t]{2,}/g, " ");
  }

  // Add: only append tags not already present.
  const existing = new Set(
    (result.match(/#[\p{L}0-9_]+/gu) || []).map((h) => normalizeTag(h)),
  );
  const toAdd: string[] = [];
  for (const raw of add) {
    const tag = normalizeTag(raw);
    if (!tag || existing.has(tag)) continue;
    existing.add(tag);
    toAdd.push(`#${raw.trim().replace(/^#+/, "")}`);
  }
  if (toAdd.length) {
    result = `${result.trimEnd()} ${toAdd.join(" ")}`.trim();
  }
  return result.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trim to a max length without cutting a word or a hashtag mid-token when
 * avoidable. Never produces more than `max` characters.
 */
export function trimToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  // Keep whole words if we can retain at least 60% of the budget.
  if (lastSpace > max * 0.6) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}

export interface BuiltCaption {
  text: string;
  truncated: boolean;
  limit: number;
}

/**
 * Produce the final caption text for a destination platform.
 */
export function buildCaption(
  platform: Platform,
  config: CaptionConfig,
  ctx: CaptionContext,
): BuiltCaption {
  let base: string;
  switch (config.mode) {
    case "KEEP_ORIGINAL":
      base = ctx.originalCaption ?? "";
      break;
    case "CUSTOM":
      base = config.template ?? "";
      break;
    case "TEMPLATE":
      base = renderTemplate(config.template ?? "", ctx);
      break;
    default:
      base = ctx.originalCaption ?? "";
  }

  if (config.findReplace) {
    for (const { find, replace } of config.findReplace) {
      if (!find) continue;
      base = base.split(find).join(replace);
    }
  }

  base = applyHashtags(base, config.addHashtags, config.removeHashtags);

  if (config.prefix) base = `${config.prefix}${base}`;
  if (config.suffix) base = `${base}${config.suffix}`;

  const limit = platformSpec(platform).captionMaxChars;
  const trimmed = trimToLimit(base, limit);
  return {
    text: trimmed,
    truncated: trimmed.length < base.length,
    limit,
  };
}

/**
 * YouTube needs a separate title. Derive one from the title var or caption.
 */
export function buildTitle(
  platform: Platform,
  config: CaptionConfig,
  ctx: CaptionContext,
): string | undefined {
  const spec = platformSpec(platform);
  if (!spec.titleMaxChars) return undefined;
  let raw =
    (config.mode === "TEMPLATE" && config.template
      ? renderTemplate(config.template, ctx)
      : ctx.title || ctx.originalCaption || "Untitled") ?? "Untitled";
  raw = raw.split("\n")[0].trim() || "Untitled";
  return trimToLimit(raw, spec.titleMaxChars);
}
