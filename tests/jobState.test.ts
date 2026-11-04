import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  canRetry,
  backoffMs,
} from "@/lib/core/jobState";

describe("job state machine", () => {
  it("allows legal transitions", () => {
    expect(canTransition("SCHEDULED", "QUEUED")).toBe(true);
    expect(canTransition("QUEUED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "UPLOADING")).toBe(true);
    expect(canTransition("UPLOADING", "PUBLISHED")).toBe(true);
    expect(canTransition("FAILED", "QUEUED")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("SCHEDULED", "PUBLISHED")).toBe(false);
    expect(canTransition("PUBLISHED", "QUEUED")).toBe(false);
    expect(canTransition("CANCELLED", "PROCESSING")).toBe(false);
    expect(canTransition("QUEUED", "QUEUED")).toBe(false);
  });

  it("assertTransition throws on illegal", () => {
    expect(() => assertTransition("PUBLISHED", "QUEUED")).toThrow();
    expect(() => assertTransition("SCHEDULED", "QUEUED")).not.toThrow();
  });

  it("identifies terminal states", () => {
    expect(isTerminal("PUBLISHED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("DRAFT_HANDOFF")).toBe(true);
    expect(isTerminal("FAILED")).toBe(false);
  });

  it("retry respects max attempts", () => {
    expect(canRetry("FAILED", 2, 5)).toBe(true);
    expect(canRetry("FAILED", 5, 5)).toBe(false);
    expect(canRetry("PUBLISHED", 0, 5)).toBe(false);
  });

  it("backoff grows exponentially and caps", () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(50)).toBeLessThanOrEqual(1000 * 60 * 30);
  });
});
