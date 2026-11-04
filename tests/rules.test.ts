import { describe, it, expect } from "vitest";
import { evaluateConditions, zonedParts } from "@/lib/core/rules";

const base = {
  providerPostId: "p1",
  caption: "awesome #anime edit, long version",
  durationSec: 30,
  width: 1080,
  height: 1920,
  publishedAt: new Date("2026-03-10T10:00:00Z"),
};

const opts = { evalTime: new Date("2026-03-15T15:00:00Z"), timezone: "UTC" };

describe("evaluateConditions", () => {
  it("passes with no conditions", () => {
    expect(evaluateConditions(base, {}, opts).pass).toBe(true);
  });

  it("blocks repost artifacts regardless of config (loop protection)", () => {
    const r = evaluateConditions({ ...base, isRepostArtifact: true }, {}, opts);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/loop protection/i);
  });

  it("enforces min/max duration", () => {
    expect(evaluateConditions(base, { minDurationSec: 60 }, opts).pass).toBe(false);
    expect(evaluateConditions(base, { maxDurationSec: 10 }, opts).pass).toBe(false);
    expect(evaluateConditions(base, { minDurationSec: 5, maxDurationSec: 60 }, opts).pass).toBe(true);
  });

  it("enforces include/exclude keywords", () => {
    expect(evaluateConditions(base, { includeKeywords: ["anime"] }, opts).pass).toBe(true);
    expect(evaluateConditions(base, { includeKeywords: ["cooking"] }, opts).pass).toBe(false);
    expect(evaluateConditions(base, { excludeKeywords: ["anime"] }, opts).pass).toBe(false);
  });

  it("enforces onlyVertical", () => {
    expect(evaluateConditions(base, { onlyVertical: true }, opts).pass).toBe(true);
    const horizontal = { ...base, width: 1920, height: 1080 };
    expect(evaluateConditions(horizontal, { onlyVertical: true }, opts).pass).toBe(false);
  });

  it("enforces exclusion list", () => {
    expect(evaluateConditions(base, { excludePostIds: ["p1"] }, opts).pass).toBe(false);
  });

  it("enforces baseline (no historical reposting)", () => {
    const r = evaluateConditions(base, {}, { ...opts, baselineAt: new Date("2026-03-12T00:00:00Z") });
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/baseline/i);
  });

  it("enforces allowed hours window", () => {
    // evalTime 15:00 UTC
    expect(evaluateConditions(base, { allowedHours: { start: 9, end: 17 } }, opts).pass).toBe(true);
    expect(evaluateConditions(base, { allowedHours: { start: 18, end: 22 } }, opts).pass).toBe(false);
  });

  it("enforces allowed days", () => {
    // 2026-03-15 is a Sunday (day 0)
    expect(evaluateConditions(base, { allowedDays: [0] }, opts).pass).toBe(true);
    expect(evaluateConditions(base, { allowedDays: [1, 2, 3] }, opts).pass).toBe(false);
  });
});

describe("zonedParts", () => {
  it("computes hour/day in timezone", () => {
    const d = new Date("2026-03-15T02:00:00Z");
    // In New York (UTC-4 DST) this is 22:00 Sat the 14th.
    const p = zonedParts(d, "America/New_York");
    expect(p.hour).toBe(22);
    expect(p.day).toBe(6); // Saturday
  });
});
