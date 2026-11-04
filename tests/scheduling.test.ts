import { describe, it, expect } from "vitest";
import { computeScheduledAt, nextWindowStart } from "@/lib/core/scheduling";

const now = new Date("2026-03-15T15:00:00Z"); // Sunday 15:00 UTC

describe("computeScheduledAt", () => {
  it("IMMEDIATE returns now (plus extra delay)", () => {
    expect(computeScheduledAt({ mode: "IMMEDIATE", now, timezone: "UTC" }).getTime()).toBe(
      now.getTime(),
    );
    expect(
      computeScheduledAt({ mode: "IMMEDIATE", now, timezone: "UTC", extraDelaySec: 60 }).getTime(),
    ).toBe(now.getTime() + 60000);
  });

  it("FIXED_DELAY adds delay + extra", () => {
    const r = computeScheduledAt({
      mode: "FIXED_DELAY",
      now,
      timezone: "UTC",
      delaySeconds: 1800,
      extraDelaySec: 120,
    });
    expect(r.getTime()).toBe(now.getTime() + 1920_000);
  });

  it("SPECIFIC_TIME in the future is honored", () => {
    const at = "2026-03-20T09:30:00Z";
    const r = computeScheduledAt({
      mode: "SPECIFIC_TIME",
      now,
      timezone: "UTC",
      config: { specific: { at } },
    });
    expect(r.toISOString()).toBe(new Date(at).toISOString());
  });

  it("SPECIFIC_TIME in the past falls back to now", () => {
    const r = computeScheduledAt({
      mode: "SPECIFIC_TIME",
      now,
      timezone: "UTC",
      config: { specific: { at: "2020-01-01T00:00:00Z" } },
    });
    expect(r.getTime()).toBe(now.getTime());
  });

  it("QUEUE spaces items after the last queued time", () => {
    const last = new Date("2026-03-15T16:00:00Z");
    const r = computeScheduledAt({
      mode: "QUEUE",
      now,
      timezone: "UTC",
      config: { queue: { spacingMinutes: 30 } },
      lastQueuedAt: last,
    });
    expect(r.getTime()).toBe(last.getTime() + 30 * 60_000);
  });

  it("SCHEDULED_WINDOW returns now when already inside window", () => {
    const r = computeScheduledAt({
      mode: "SCHEDULED_WINDOW",
      now,
      timezone: "UTC",
      config: { window: { startHour: 9, endHour: 21 } },
    });
    // 15:00 UTC is inside 9-21 window.
    expect(r.getTime()).toBe(now.getTime());
  });

  it("SCHEDULED_WINDOW defers to next window when outside", () => {
    const night = new Date("2026-03-15T23:00:00Z");
    const r = computeScheduledAt({
      mode: "SCHEDULED_WINDOW",
      now: night,
      timezone: "UTC",
      config: { window: { startHour: 9, endHour: 21 } },
    });
    expect(r.getTime()).toBeGreaterThan(night.getTime());
    expect(r.getUTCHours()).toBe(9);
  });
});

describe("nextWindowStart", () => {
  it("respects allowed days", () => {
    // now Sunday(0) 23:00; allow only Tuesday(2)
    const night = new Date("2026-03-15T23:00:00Z");
    const r = nextWindowStart(night, "UTC", { startHour: 10, endHour: 18, days: [2] });
    expect(r.getUTCDay()).toBe(2);
    expect(r.getUTCHours()).toBe(10);
  });
});
