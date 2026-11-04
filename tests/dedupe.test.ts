import { describe, it, expect } from "vitest";
import { buildIdempotencyKey, isNewSourcePost } from "@/lib/core/dedupe";

describe("buildIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    const p = { automationId: "a1", detectedPostId: "d1", destinationAccountId: "acc1" };
    expect(buildIdempotencyKey(p)).toBe(buildIdempotencyKey(p));
  });
  it("differs across destinations", () => {
    const k1 = buildIdempotencyKey({ automationId: "a1", detectedPostId: "d1", destinationAccountId: "acc1" });
    const k2 = buildIdempotencyKey({ automationId: "a1", detectedPostId: "d1", destinationAccountId: "acc2" });
    expect(k1).not.toBe(k2);
  });
});

describe("isNewSourcePost", () => {
  const known = new Set(["seen1"]);
  const lineage = new Set(["mine1"]);

  it("accepts a genuinely new post", () => {
    expect(
      isNewSourcePost({ providerPostId: "fresh", knownProviderPostIds: known, lineageProviderPostIds: lineage }),
    ).toBe(true);
  });
  it("rejects already-detected posts", () => {
    expect(
      isNewSourcePost({ providerPostId: "seen1", knownProviderPostIds: known, lineageProviderPostIds: lineage }),
    ).toBe(false);
  });
  it("rejects posts RepostFlow itself published (loop guard)", () => {
    expect(
      isNewSourcePost({ providerPostId: "mine1", knownProviderPostIds: known, lineageProviderPostIds: lineage }),
    ).toBe(false);
  });
  it("rejects explicit repost artifacts", () => {
    expect(
      isNewSourcePost({ providerPostId: "x", knownProviderPostIds: known, lineageProviderPostIds: lineage, isRepostArtifact: true }),
    ).toBe(false);
  });
});
