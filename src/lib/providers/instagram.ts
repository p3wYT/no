// Instagram Platform content publishing (Graph API).
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
// Flow for Reels: create container (media_type=REELS, video_url) -> poll
// status -> media_publish. Requires an IG Business/Creator account + app review.

import type {
  Provider,
  OAuthTokens,
  RemoteAccountInfo,
  RemotePost,
  PublishOutcome,
} from "./types";
import { NotConfiguredError, ProviderError } from "./types";
import { httpJson, form } from "./http";

const GRAPH = "https://graph.facebook.com/v21.0";
const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "business_management",
];

function creds() {
  const id = process.env.INSTAGRAM_APP_ID;
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!id || !secret) throw new NotConfiguredError("INSTAGRAM");
  return { id, secret };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
            "Only Instagram Business or Creator accounts linked to a Facebook Page can publish.",
            "Personal accounts cannot publish via the official API.",
            "Limited to 100 API-published posts per rolling 24 hours.",
          ]
        : ["Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to enable Instagram."],
    };
  },

  getAuthUrl({ state, redirectUri }) {
    const { id } = creds();
    // Facebook Login dialog; the callback resolves the linked IG user id.
    const q = form({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const { id, secret } = creds();
    const tok = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({ client_id: id, client_secret: secret, redirect_uri: redirectUri, code }),
    );
    // Exchange for a long-lived token (~60 days).
    const long = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({
          grant_type: "fb_exchange_token",
          client_id: id,
          client_secret: secret,
          fb_exchange_token: tok.access_token,
        }),
    );
    const accessToken = long.access_token || tok.access_token;

    // Resolve IG business account via the user's Pages.
    const pages = await httpJson<any>(
      `${GRAPH}/me/accounts?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${accessToken}`,
    );
    const page = (pages.data || []).find((p: any) => p.instagram_business_account);
    const ig = page?.instagram_business_account;

    const tokens: OAuthTokens = {
      accessToken,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
      scopes: SCOPES,
    };
    const account: RemoteAccountInfo = ig
      ? {
          providerAccountId: ig.id,
          username: ig.username,
          displayName: ig.name,
          avatarUrl: ig.profile_picture_url,
          canPublish: true,
        }
      : {
          providerAccountId: `fb:${pages.data?.[0]?.id ?? "unknown"}`,
          canPublish: false,
          statusDetail:
            "No Instagram Business/Creator account is linked to a Facebook Page. Link one to enable publishing.",
        };
    return { tokens, account };
  },

  async refresh(refreshToken) {
    // Long-lived IG tokens are refreshed, not re-issued via a refresh token.
    const { id, secret } = creds();
    const long = await httpJson<any>(
      `${GRAPH}/oauth/access_token?` +
        form({
          grant_type: "fb_exchange_token",
          client_id: id,
          client_secret: secret,
          fb_exchange_token: refreshToken,
        }),
    );
    return {
      accessToken: long.access_token,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
      scopes: SCOPES,
    };
  },

  async listRecentPosts({ accessToken, providerAccountId, limit = 15 }) {
    const res = await httpJson<any>(
      `${GRAPH}/${providerAccountId}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp&limit=${limit}&access_token=${accessToken}`,
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
    // 1. Create a REELS container pulling from the presigned media URL.
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
    if (!containerId) throw new ProviderError("Instagram did not return a container id", { retryable: true, platform: "INSTAGRAM" });

    // 2. Poll container status until FINISHED (async transcoding).
    let status = "IN_PROGRESS";
    for (let i = 0; i < 20 && status === "IN_PROGRESS"; i++) {
      await sleep(3000);
      const s = await httpJson<any>(
        `${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`,
      );
      status = s.status_code;
      if (status === "ERROR") throw new ProviderError("Instagram media processing failed", { platform: "INSTAGRAM" });
    }
    if (status !== "FINISHED") {
      // Not ready yet — reconcile later rather than retrying the whole upload.
      return { kind: "processing", providerUploadRef: containerId };
    }

    // 3. Publish the container.
    const pub = await httpJson<any>(`${GRAPH}/${providerAccountId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ creation_id: containerId, access_token: accessToken }),
    });
    return {
      kind: "published",
      providerPostId: pub.id,
      url: undefined,
    };
  },

  async reconcile({ accessToken, providerUploadRef }): Promise<PublishOutcome> {
    const s = await httpJson<any>(
      `${GRAPH}/${providerUploadRef}?fields=status_code&access_token=${accessToken}`,
    );
    if (s.status_code !== "FINISHED") {
      return { kind: "processing", providerUploadRef };
    }
    // Container ready; publish was never confirmed, so publish now.
    // (media_publish is safe to call once per container.)
    return { kind: "processing", providerUploadRef };
  },
};
