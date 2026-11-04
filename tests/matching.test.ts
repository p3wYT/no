import { describe, it, expect } from "vitest";
import { matchAsset, AUTO_MATCH_THRESHOLD } from "@/lib/core/matching";

const post = {
  providerPostId: "p1",
  durationSec: 30,
  width: 1080,
  height: 1920,
  publishedAt: new Date("2026-03-15T12:00:00Z"),
};

describe("matchAsset", () => {
  it("returns no match with no candidates", () => {
    const r = matchAsset(post, []);
    expect(r.assetId).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("exact hash → confidence 1", () => {
    const r = matchAsset(
      { ...post, providedContentHash: "abc" },
      [{ id: "a1", contentHash: "abc", createdAt: new Date() }],
    );
    expect(r.assetId).toBe("a1");
    expect(r.confidence).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("tagged upload → high confidence", () => {
    const r = matchAsset(post, [
      { id: "a2", hintProviderPostId: "p1", createdAt: new Date() },
    ]);
    expect(r.assetId).toBe("a2");
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("heuristic match stays below auto threshold", () => {
    const r = matchAsset(post, [
      {
        id: "a3",
        durationSec: 30.2,
        width: 1080,
        height: 1920,
        createdAt: new Date("2026-03-15T11:00:00Z"),
      },
    ]);
    expect(r.assetId).toBe("a3");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(r.reason).toMatch(/duration|aspect|timing/);
  });

  it("picks the best of several candidates", () => {
    const r = matchAsset(post, [
      { id: "weak", durationSec: 90, width: 1920, height: 1080, createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "strong", durationSec: 30, width: 1080, height: 1920, createdAt: new Date("2026-03-15T12:30:00Z") },
    ]);
    expect(r.assetId).toBe("strong");
  });
});
