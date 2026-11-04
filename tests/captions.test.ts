import { describe, it, expect } from "vitest";
import {
  buildCaption,
  buildTitle,
  renderTemplate,
  applyHashtags,
  trimToLimit,
} from "@/lib/core/captions";

const ctx = {
  originalCaption: "New edit is finally out 🔥 #anime",
  title: "My New Anime Edit",
  sourcePlatform: "TikTok",
  sourceUsername: "creator",
  now: new Date("2026-03-15T12:00:00Z"),
  timezone: "UTC",
};

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    const out = renderTemplate(
      "{{original_caption}} via @{{source_username}} on {{source_platform}} ({{date}})",
      ctx,
    );
    expect(out).toBe("New edit is finally out 🔥 #anime via @creator on TikTok (2026-03-15)");
  });

  it("blanks unknown variables", () => {
    expect(renderTemplate("hi {{nope}}!", ctx)).toBe("hi !");
  });
});

describe("applyHashtags", () => {
  it("adds only missing tags", () => {
    const out = applyHashtags("edit is out #anime", ["anime", "amvedit", "reels"]);
    expect(out).toContain("#amvedit");
    expect(out).toContain("#reels");
    // not duplicated
    expect(out.match(/#anime/gi)?.length).toBe(1);
  });

  it("removes tags case-insensitively", () => {
    const out = applyHashtags("cool #Anime clip #reels", [], ["anime"]);
    expect(out).not.toMatch(/#anime/i);
    expect(out).toContain("#reels");
  });
});

describe("trimToLimit", () => {
  it("never exceeds the limit", () => {
    const long = "a ".repeat(2000);
    expect(trimToLimit(long, 100).length).toBeLessThanOrEqual(100);
  });
  it("keeps short text untouched", () => {
    expect(trimToLimit("hello", 100)).toBe("hello");
  });
});

describe("buildCaption", () => {
  it("KEEP_ORIGINAL returns original", () => {
    const r = buildCaption("INSTAGRAM", { mode: "KEEP_ORIGINAL" }, ctx);
    expect(r.text).toBe(ctx.originalCaption);
    expect(r.truncated).toBe(false);
  });

  it("TEMPLATE renders and applies transforms", () => {
    const r = buildCaption(
      "INSTAGRAM",
      {
        mode: "TEMPLATE",
        template: "new anime edit is out 🔥 {{original_caption}}",
        addHashtags: ["amvedit", "reels"],
        removeHashtags: ["anime"],
        prefix: "",
      },
      ctx,
    );
    expect(r.text).toContain("#amvedit");
    expect(r.text).toContain("#reels");
    expect(r.text).not.toMatch(/#anime/i);
  });

  it("applies find/replace, prefix, suffix", () => {
    const r = buildCaption(
      "YOUTUBE",
      {
        mode: "CUSTOM",
        template: "watch this",
        findReplace: [{ find: "watch", replace: "see" }],
        prefix: ">> ",
        suffix: " <<",
      },
      ctx,
    );
    expect(r.text).toBe(">> see this <<");
  });

  it("truncates to platform limit and flags it", () => {
    const r = buildCaption(
      "TIKTOK",
      { mode: "CUSTOM", template: "x".repeat(5000) },
      ctx,
    );
    expect(r.text.length).toBeLessThanOrEqual(2200);
    expect(r.truncated).toBe(true);
  });
});

describe("buildTitle", () => {
  it("returns a title for YouTube within limit", () => {
    const t = buildTitle("YOUTUBE", { mode: "KEEP_ORIGINAL" }, ctx)!;
    expect(t.length).toBeLessThanOrEqual(100);
  });
  it("returns undefined for platforms without titles", () => {
    expect(buildTitle("TIKTOK", { mode: "KEEP_ORIGINAL" }, ctx)).toBeUndefined();
  });
});
