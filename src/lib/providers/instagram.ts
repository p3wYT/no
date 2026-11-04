// Instagram, "API setup with Facebook Login" (Instagram API with Facebook Login).
//
// This implementation uses the classic Facebook Login dialog (scope-based, no
// config_id) and Facebook User access tokens. All calls go to graph.facebook.com.
//   authorize : https://www.facebook.com/{ver}/dialog/oauth
//   token     : https://graph.facebook.com/{ver}/oauth/access_token (+ fb_exchange_token)
//   discovery : GET /me/accounts?fields=instagram_business_account{...}  (paged)
//   publish   : POST /{ig-user-id}/media (REELS) -> GET /{container}?fields=status_code
//               -> POST /{ig-user-id}/media_publish
// It is NOT "Instagram Login" (api.instagram.com / graph.instagram.com,
// instagram_business_* scopes) and NOT Facebook Login for Business (config_id,
// system-user tokens). A Facebook Page linked to the Instagram professional
// account is required.

import type {
  Provider,
  OAuthTokens,
  RemoteAccountInfo,
  RemotePost,
  PublishOutcome,
} from "./types";
import { NotConfiguredError, ProviderError } from "./types";
import { httpJson, form } from "./http";

// Pinned Graph API version. v21.0 reaches end of life on 2027-01-21 per Meta's
// changelog; v25.0 is supported well beyond that.
export const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export const SCOPES = [
  "instagram_basic",
  "instagram_content_publishing",
  "pages_show_list",
  "pages_read_engagement",
  // Needed when the Page is owned by a Business portfolio rather than a person.
  "business_management",
];

// Without every one of these, publishing is not possible; the account is
// connected as read-limited and the missing permissions are listed.
export const REQUIRED_FOR_PUBLISH = [
  "instagram_basic",
  "instagram_content_publishing",
  "pages_show_list",
  "pages_read_engagement",
];

// Reels are transcoded asynchronously. Poll briefly, then hand over to the
// reconcile queue instead of holding a worker.
export const pollConfig = { intervalMs: 3000, maxPolls: 20 };

function creds() {
  // These are the Meta APP ID / APP SECRET (App settings > Basic), not the
  // separate "Instagram app ID" shown under Instagram Login.
  const id = process.env.INSTAGRAM_APP_ID;
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!id || !secret) throw new NotConfiguredError("INSTAGRAM");
  return { id, secret };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const placeholderAccount = (pageId: string | undefined, detail: string): RemoteAccountInfo => ({
  providerAccountId: `fb:${pageId ?? "unknown"}`,
  canPublish: false,
  statusDetail: detail,
});

async function grantedPermissions(accessToken: string): Promise<string[] | null> {
  try {
    const res = await httpJson<any>(`${GRAPH}/me/permissions?` + form({ access_token: accessToken }));
    return (res.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission as string);
  } catch {
    return null;
  }
}

/** Every Instagram professional account reachable through the user's Pages. */
async function discoverAccounts(accessToken: string): Promise<{ found: RemoteAccountInfo[]; firstPageId?: string }> {
  let url: string | undefined =
    `${GRAPH}/me/accounts?` +
    form({
      fields: "id,name,instagram_business_account{id,username,name,profile_picture_url}",
      limit: "100",
      access_token: accessToken,
    });
  const found: RemoteAccountInfo[] = [];
  const seen = new Set<string>();
  let firstPageId: string | undefined;
  for (let i = 0; i < 10 && url; i++) {
    const res: any = await httpJson<any>(url);
    for (const page of res.data || []) {
      firstPageId ??= page.id;
      const ig = page.instagram_business_account;
      if (ig && !seen.has(ig.id)) {
        seen.add(ig.id);
        found.push({
          providerAccountId: ig.id,
          username: ig.username,
          displayName: ig.name,
          avatarUrl: ig.profile_picture_url,
          canPublish: true, // adjusted by granted permissions in exchangeCode
        });
      }
    }
    url = res.paging?.next;
  }
  return { found, firstPageId };
}

async function permalinkOf(accessToken: string, mediaId: string): Promise<string | undefined> {
  try {
    const r = await httpJson<any>(`${GRAPH}/${mediaId}?` + form({ fields: "permalink", access_token: accessToken }));
    return r.permalink;
  } catch {
    return undefined;
  }
}

async function publishContainer(accessToken: string, igUserId: string, containerId: string): Promise<PublishOutcome> {
  let pub: any;
  try {
    pub = await httpJson<any>(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ creation_id: containerId, access_token: accessToken }),
    });
  } catch (err) {
    // The response may have been lost AFTER Instagram published. Keep the
    // container id so the retry reconciles instead of creating a second Reel.
    throw new ProviderError(`Instagram media_publish failed: ${(err as Error).message}`, {
      retryable: true,
      platform: "INSTAGRAM",
      uploadRef: containerId,
    });
  }
  if (!pub?.id) {
    throw new ProviderError("Instagram media_publish returned no media id", {
      retryable: true,
      platform: "INSTAGRAM",
      uploadRef: containerId,
    });
  }
  return { kind: "published", providerPostId: pub.id, url: await permalinkOf(accessToken, pub.id) };
}

export const instagramProvider: Provider = {
  platform: "INSTAGRAM",

  isConfigured() {
    return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  },

  capabilities() {
    const ok = this.isConfigured();
    return {
      canConnect: ok,
      canDetect: ok,
      canPublish: ok,
      notes: ok
        ? [
            "Requires an Instagram Business or Creator account linked to a Facebook Page.",
            "Personal accounts cannot publish through the official API.",
            "Up to 100 API-published posts per rolling 24 hours.",
            "Until Meta approves the app (App Review), only people with a role on the Meta app can connect.",
          ]
        : ["Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (the Meta app's ID and secret) to enable Instagram."],
    };
  },

  getAuthUrl({ state, redirectUri }) {
    const { id } = creds();
    // Classic Facebook Login: scope-based, no config_id. Facebook has no PKCE
    // support here; the signed `state` binds the round trip to the user.
    const q = form({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `${DIALOG}?${q}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const { id, secret } = creds();
    const tok = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({ client_id: id, client_secret: secret, redirect_uri: redirectUri, code }),
    );
    // Short-lived user token -> long-lived (~60 days).
    const long = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({
          grant_type: "fb_exchange_token",
          client_id: id,
          client_secret: secret,
          fb_exchange_token: tok.access_token,
        }),
    );
    const accessToken: string = long.access_token || tok.access_token;

    // Record what the user actually GRANTED (the dialog lets them untick
    // permissions), not what was requested.
    const granted = await grantedPermissions(accessToken);
    const missing = granted ? REQUIRED_FOR_PUBLISH.filter((p) => !granted.includes(p)) : REQUIRED_FOR_PUBLISH;
    const permissionDetail = !granted
      ? "Could not verify which permissions were granted. Reconnect to try again."
      : missing.length
        ? `Publishing is disabled: these permissions were not granted: ${missing.join(", ")}. Reconnect and approve them.`
        : undefined;

    const { found, firstPageId } = await discoverAccounts(accessToken);
    const accounts: RemoteAccountInfo[] = found.length
      ? found.map((a) => ({
          ...a,
          canPublish: !permissionDetail,
          statusDetail: permissionDetail,
        }))
      : [
          placeholderAccount(
            firstPageId,
            firstPageId
              ? "None of your Facebook Pages has an Instagram Business/Creator account linked. Link one in Page settings, then reconnect."
              : "No Facebook Page was found. Instagram publishing needs a Page linked to an Instagram Business/Creator account.",
          ),
        ];

    const tokens: OAuthTokens = {
      accessToken,
      // A long-lived user token is renewed by exchanging it again before it
      // expires, so it doubles as its own refresh credential.
      refreshToken: accessToken,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
      scopes: granted ?? [],
    };
    return { tokens, account: accounts[0], additionalAccounts: accounts.slice(1) };
  },

  async refresh(currentLongLivedToken) {
    const { id, secret } = creds();
    const long = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({
          grant_type: "fb_exchange_token",
          client_id: id,
          client_secret: secret,
          fb_exchange_token: currentLongLivedToken,
        }),
    );
    return {
      accessToken: long.access_token,
      refreshToken: long.access_token,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
      scopes: [],
    };
  },

  async listRecentPosts({ accessToken, providerAccountId, limit = 15 }) {
    const res = await httpJson<any>(
      `${GRAPH}/${providerAccountId}/media?` +
        form({
          fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp",
          limit: String(limit),
          access_token: accessToken,
        }),
    );
    return (res.data || [])
      .filter((m: any) => m.media_product_type === "REELS" || m.media_type === "VIDEO")
      .map((m: any): RemotePost => ({
        providerPostId: m.id,
        caption: m.caption,
        permalink: m.permalink,
        thumbnailUrl: m.thumbnail_url,
        publishedAt: m.timestamp ? new Date(m.timestamp) : undefined,
      }));
  },

  async publish({ accessToken, providerAccountId, input }): Promise<PublishOutcome> {
    // 1. Create a REELS container; Instagram fetches the video from this URL.
    const container = await httpJson<any>(`${GRAPH}/${providerAccountId}/media`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        media_type: "REELS",
        video_url: input.mediaUrl,
        caption: input.caption || "",
        access_token: accessToken,
      }),
    });
    const containerId = container.id as string;
    if (!containerId) {
      throw new ProviderError("Instagram did not return a container id", { retryable: true, platform: "INSTAGRAM" });
    }

    // 2. Poll the container until it is FINISHED (asynchronous transcoding).
    let status = "IN_PROGRESS";
    for (let i = 0; i < pollConfig.maxPolls && status === "IN_PROGRESS"; i++) {
      if (pollConfig.intervalMs) await sleep(pollConfig.intervalMs);
      const s = await httpJson<any>(
        `${GRAPH}/${containerId}?` + form({ fields: "status_code", access_token: accessToken }),
      );
      status = s.status_code;
    }
    if (status === "ERROR" || status === "EXPIRED") {
      throw new ProviderError(`Instagram could not process the video (container ${status}).`, {
        platform: "INSTAGRAM",
        clearUploadRef: true,
      });
    }
    if (status !== "FINISHED") {
      // Still transcoding: hand over to reconcile (which will publish it).
      return { kind: "processing", providerUploadRef: containerId };
    }

    // 3. Publish.
    return publishContainer(accessToken, providerAccountId, containerId);
  },

  async reconcile({ accessToken, providerUploadRef, providerAccountId }): Promise<PublishOutcome> {
    const s = await httpJson<any>(
      `${GRAPH}/${providerUploadRef}?` + form({ fields: "status_code", access_token: accessToken }),
    );
    switch (s.status_code) {
      case "FINISHED":
        // Ready but not yet published: publish exactly once.
        return publishContainer(accessToken, providerAccountId, providerUploadRef);

      case "PUBLISHED": {
        // Instagram published it but our record of the media id was lost.
        // Recover the id from the account's newest Reel instead of re-posting.
        const recent = await httpJson<any>(
          `${GRAPH}/${providerAccountId}/media?` +
            form({ fields: "id,permalink,media_product_type,timestamp", limit: "5", access_token: accessToken }),
        );
        const reel = (recent.data || []).find((m: any) => m.media_product_type === "REELS");
        if (!reel) {
          throw new ProviderError(
            "Instagram reports this Reel as published, but its media id could not be recovered. Check the account before retrying.",
            { platform: "INSTAGRAM" },
          );
        }
        return {
          kind: "published",
          providerPostId: reel.id,
          url: reel.permalink,
          note: "Recovered after a lost response; matched to the newest Reel on the account.",
        };
      }

      case "ERROR":
      case "EXPIRED":
        throw new ProviderError(`Instagram container is ${s.status_code}; the video must be uploaded again.`, {
          platform: "INSTAGRAM",
          clearUploadRef: true,
        });

      default:
        return { kind: "processing", providerUploadRef };
    }
  },
};
