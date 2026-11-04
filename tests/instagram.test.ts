// Contract tests for the Instagram provider ("API setup with Facebook Login").
// fetch is stubbed, so these verify the REQUESTS we send (host, path, params)
// and how we react to Meta's documented responses. They do not prove Meta
// accepts the app; that needs a live connection with real credentials.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  instagramProvider as ig,
  SCOPES,
  REQUIRED_FOR_PUBLISH,
  GRAPH_VERSION,
  pollConfig,
} from "@/lib/providers/instagram";
import { ProviderError } from "@/lib/providers/types";
import { redactUrl } from "@/lib/providers/http";

type Call = { url: URL; method: string; body: URLSearchParams };
let calls: Call[];
let routes: Array<{ match: (c: Call) => boolean; respond: (c: Call) => unknown | Error }>;

function on(match: (c: Call) => boolean, respond: (c: Call) => unknown | Error) {
  routes.push({ match, respond });
}
const path = (p: string) => (c: Call) => c.url.pathname === `/${GRAPH_VERSION}${p}`;

beforeEach(() => {
  calls = [];
  routes = [];
  process.env.INSTAGRAM_APP_ID = "app123";
  process.env.INSTAGRAM_APP_SECRET = "secret456";
  pollConfig.intervalMs = 0;
  pollConfig.maxPolls = 3;
  vi.stubGlobal("fetch", async (input: any, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      body: new URLSearchParams(String(init.body ?? "")),
    };
    calls.push(call);
    const route = routes.find((r) => r.match(call));
    if (!route) throw new Error(`unexpected request: ${call.method} ${call.url.pathname}`);
    const out = route.respond(call);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("authorization request (Facebook Login, not Instagram Login / FLfB)", () => {
  it("uses the Facebook dialog with scope, and no config_id", () => {
    const u = new URL(ig.getAuthUrl({ state: "st", challenge: "ch", redirectUri: "https://x.test/cb" }));
    expect(u.origin + u.pathname).toBe(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    expect(u.searchParams.get("client_id")).toBe("app123");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.test/cb");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("config_id")).toBeNull();
    expect(u.searchParams.get("override_default_response_type")).toBeNull();
    expect(u.hostname).not.toContain("instagram.com");
  });

  it("requests the Facebook-Login permissions, and none of the Instagram-Login ones", () => {
    const scope = new URL(ig.getAuthUrl({ state: "s", challenge: "c", redirectUri: "https://x.test/cb" })).searchParams
      .get("scope")!
      .split(",");
    for (const p of ["instagram_basic", "instagram_content_publishing", "pages_show_list", "pages_read_engagement"]) {
      expect(scope).toContain(p);
    }
    expect(scope.some((p) => p.startsWith("instagram_business_"))).toBe(false);
    expect(scope).toEqual(SCOPES);
  });
});

describe("code exchange and account discovery", () => {
  const exchange = () => ig.exchangeCode({ code: "the-code", verifier: "v", redirectUri: "https://x.test/cb" });

  function happyRoutes(permissions: Array<[string, string]>) {
    on(
      (c) => path("/oauth/access_token")(c) && !c.url.searchParams.get("grant_type"),
      () => ({ access_token: "short-token" }),
    );
    on(
      (c) => path("/oauth/access_token")(c) && c.url.searchParams.get("grant_type") === "fb_exchange_token",
      () => ({ access_token: "long-token", expires_in: 5184000 }),
    );
    on(path("/me/permissions"), () => ({ data: permissions.map(([permission, status]) => ({ permission, status })) }));
  }
  const allGranted: Array<[string, string]> = SCOPES.map((p) => [p, "granted"]);

  it("exchanges the code on graph.facebook.com, then upgrades to a long-lived token", async () => {
    happyRoutes(allGranted);
    on(path("/me/accounts"), () => ({ data: [] }));
    await exchange();
    const first = calls[0];
    expect(first.url.origin).toBe("https://graph.facebook.com");
    expect(first.url.searchParams.get("code")).toBe("the-code");
    expect(first.url.searchParams.get("client_id")).toBe("app123");
    expect(first.url.searchParams.get("client_secret")).toBe("secret456");
    expect(first.url.searchParams.get("redirect_uri")).toBe("https://x.test/cb");
    const second = calls[1];
    expect(second.url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(second.url.searchParams.get("fb_exchange_token")).toBe("short-token");
  });

  it("discovers Instagram accounts via /me/accounts across ALL pages", async () => {
    happyRoutes(allGranted);
    on(path("/me/accounts"), (c) =>
      c.url.searchParams.get("after") === "p2"
        ? { data: [{ id: "page2", instagram_business_account: { id: "ig2", username: "second" } }] }
        : {
            data: [
              { id: "page0" }, // a Page with no Instagram account
              { id: "page1", instagram_business_account: { id: "ig1", username: "first", name: "First" } },
            ],
            paging: { next: `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?after=p2&access_token=long-token` },
          },
    );
    const r = await exchange();
    const accounts = [r.account, ...(r.additionalAccounts ?? [])];
    expect(accounts.map((a) => a.providerAccountId)).toEqual(["ig1", "ig2"]);
    expect(accounts.every((a) => a.canPublish)).toBe(true);
    const disc = calls.find((c) => c.url.pathname.endsWith("/me/accounts"))!;
    expect(disc.url.searchParams.get("fields")).toContain("instagram_business_account{");
    expect(disc.url.searchParams.get("access_token")).toBe("long-token");
  });

  it("stores the long-lived token as its own refresh credential, with an expiry", async () => {
    happyRoutes(allGranted);
    on(path("/me/accounts"), () => ({ data: [{ id: "p", instagram_business_account: { id: "ig1" } }] }));
    const { tokens } = await exchange();
    expect(tokens.accessToken).toBe("long-token");
    expect(tokens.refreshToken).toBe("long-token");
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });

  it("records GRANTED permissions, and disables publishing if one was declined", async () => {
    const declined = allGranted.map(([p, s]) => (p === "instagram_content_publishing" ? [p, "declined"] : [p, s])) as Array<[string, string]>;
    happyRoutes(declined);
    on(path("/me/accounts"), () => ({ data: [{ id: "p", instagram_business_account: { id: "ig1", username: "u" } }] }));
    const { account, tokens } = await exchange();
    expect(tokens.scopes).not.toContain("instagram_content_publishing");
    expect(account.canPublish).toBe(false);
    expect(account.statusDetail).toContain("instagram_content_publishing");
  });

  it("fails closed when granted permissions cannot be verified", async () => {
    on((c) => path("/oauth/access_token")(c) && !c.url.searchParams.get("grant_type"), () => ({ access_token: "short-token" }));
    on((c) => path("/oauth/access_token")(c) && c.url.searchParams.get("grant_type") === "fb_exchange_token", () => ({ access_token: "long-token", expires_in: 5184000 }));
    on(path("/me/permissions"), () => new Error("network down"));
    on(path("/me/accounts"), () => ({ data: [{ id: "p", instagram_business_account: { id: "ig1" } }] }));
    const { account } = await exchange();
    expect(account.canPublish).toBe(false);
    expect(account.statusDetail).toMatch(/could not verify/i);
  });

  it("reports a clear limitation when no Instagram professional account is linked", async () => {
    happyRoutes(allGranted);
    on(path("/me/accounts"), () => ({ data: [{ id: "page9", name: "My Page" }] }));
    const { account, additionalAccounts } = await exchange();
    expect(account.canPublish).toBe(false);
    expect(account.providerAccountId).toBe("fb:page9");
    expect(account.statusDetail).toMatch(/linked/i);
    expect(additionalAccounts).toEqual([]);
  });

  it("requires every publish permission to be granted", () => {
    expect(REQUIRED_FOR_PUBLISH).toEqual(
      expect.arrayContaining(["instagram_basic", "instagram_content_publishing", "pages_show_list", "pages_read_engagement"]),
    );
  });
});

describe("token renewal", () => {
  it("re-exchanges the current long-lived token (fb_exchange_token)", async () => {
    on(path("/oauth/access_token"), () => ({ access_token: "renewed", expires_in: 5184000 }));
    const t = await ig.refresh("current-long-token");
    expect(calls[0].url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(calls[0].url.searchParams.get("fb_exchange_token")).toBe("current-long-token");
    expect(t.accessToken).toBe("renewed");
    expect(t.refreshToken).toBe("renewed");
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });
});

describe("publishing a Reel", () => {
  const input = { mediaUrl: "https://bucket.test/v.mp4?sig=1", caption: "hello #reels", visibility: "public" as const };
  const args = { accessToken: "tok", providerAccountId: "ig1", input };

  it("creates a REELS container, waits for FINISHED, then calls media_publish once", async () => {
    let statusCalls = 0;
    on((c) => path("/ig1/media")(c) && c.method === "POST", () => ({ id: "cont1" }));
    on(path("/cont1"), () => ({ status_code: ++statusCalls < 2 ? "IN_PROGRESS" : "FINISHED" }));
    on((c) => path("/ig1/media_publish")(c) && c.method === "POST", () => ({ id: "media9" }));
    on(path("/media9"), () => ({ permalink: "https://www.instagram.com/reel/abc/" }));

    const out = await ig.publish(args);
    expect(out).toEqual({ kind: "published", providerPostId: "media9", url: "https://www.instagram.com/reel/abc/" });

    const create = calls.find((c) => c.url.pathname.endsWith("/ig1/media"))!;
    expect(create.url.origin).toBe("https://graph.facebook.com");
    expect(create.body.get("media_type")).toBe("REELS");
    expect(create.body.get("video_url")).toBe(input.mediaUrl);
    expect(create.body.get("caption")).toBe("hello #reels");
    expect(create.body.get("access_token")).toBe("tok");
    const pub = calls.filter((c) => c.url.pathname.endsWith("/media_publish"));
    expect(pub).toHaveLength(1);
    expect(pub[0].body.get("creation_id")).toBe("cont1");
  });

  it("hands over to reconcile (does not publish) when transcoding outlasts the poll window", async () => {
    on((c) => path("/ig1/media")(c) && c.method === "POST", () => ({ id: "cont1" }));
    on(path("/cont1"), () => ({ status_code: "IN_PROGRESS" }));
    const out = await ig.publish(args);
    expect(out).toEqual({ kind: "processing", providerUploadRef: "cont1" });
    expect(calls.some((c) => c.url.pathname.endsWith("/media_publish"))).toBe(false);
  });

  it("fails permanently and drops the container when Instagram reports ERROR or EXPIRED", async () => {
    on((c) => path("/ig1/media")(c) && c.method === "POST", () => ({ id: "cont1" }));
    on(path("/cont1"), () => ({ status_code: "ERROR" }));
    const err = await ig.publish(args).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.opts.clearUploadRef).toBe(true);
    expect(err.opts.retryable).toBeFalsy();
  });

  it("keeps the container id when media_publish's response is lost, so a retry cannot double-post", async () => {
    on((c) => path("/ig1/media")(c) && c.method === "POST", () => ({ id: "cont1" }));
    on(path("/cont1"), () => ({ status_code: "FINISHED" }));
    on((c) => path("/ig1/media_publish")(c), () => new Error("socket hang up"));
    const err = await ig.publish(args).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.opts.uploadRef).toBe("cont1");
    expect(err.opts.retryable).toBe(true);
  });
});

describe("reconcile (recovering an in-flight or lost publish)", () => {
  const args = { accessToken: "tok", providerAccountId: "ig1", providerUploadRef: "cont1" };

  it("publishes a container that finished AFTER the poll window (previously stuck forever)", async () => {
    on(path("/cont1"), () => ({ status_code: "FINISHED" }));
    on((c) => path("/ig1/media_publish")(c) && c.method === "POST", () => ({ id: "media9" }));
    on(path("/media9"), () => ({ permalink: "https://www.instagram.com/reel/abc/" }));
    const out = await ig.reconcile!(args);
    expect(out).toMatchObject({ kind: "published", providerPostId: "media9" });
    expect(calls.filter((c) => c.url.pathname.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("does NOT publish again when the container is already PUBLISHED; recovers the media id instead", async () => {
    on(path("/cont1"), () => ({ status_code: "PUBLISHED" }));
    on(path("/ig1/media"), () => ({
      data: [
        { id: "photo1", media_product_type: "FEED" },
        { id: "reel7", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/zzz/" },
      ],
    }));
    const out = await ig.reconcile!(args);
    expect(out).toMatchObject({ kind: "published", providerPostId: "reel7", url: "https://www.instagram.com/reel/zzz/" });
    expect(calls.some((c) => c.url.pathname.endsWith("/media_publish"))).toBe(false);
  });

  it("keeps waiting while IN_PROGRESS", async () => {
    on(path("/cont1"), () => ({ status_code: "IN_PROGRESS" }));
    expect(await ig.reconcile!(args)).toEqual({ kind: "processing", providerUploadRef: "cont1" });
  });

  it("drops an EXPIRED container so a manual retry re-uploads instead of looping", async () => {
    on(path("/cont1"), () => ({ status_code: "EXPIRED" }));
    const err = await ig.reconcile!(args).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.opts.clearUploadRef).toBe(true);
  });
});

describe("credentials never reach error text", () => {
  it("redacts tokens and secrets from URLs", () => {
    const u = "https://graph.facebook.com/v25.0/me/accounts?fields=id&access_token=EAAB123&client_secret=s3cr3t&code=abc";
    const r = redactUrl(u);
    expect(r).not.toContain("EAAB123");
    expect(r).not.toContain("s3cr3t");
    expect(r).not.toContain("=abc");
    expect(r).toContain("fields=id");
  });

  it("does not leak the access token when a Graph call fails", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token." } }), { status: 400 }),
    );
    const err = await ig.listRecentPosts({ accessToken: "EAAB-SECRET-TOKEN", providerAccountId: "ig1" }).catch((e) => e);
    expect(err.message).toContain("HTTP 400");
    expect(err.message).not.toContain("EAAB-SECRET-TOKEN");
  });
});
