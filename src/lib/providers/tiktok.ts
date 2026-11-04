// TikTok Login Kit + Content Posting API (v2).
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
//
// IMPORTANT COMPLIANCE NOTE: Unaudited apps can ONLY create private/self-only
// content. A public direct-post from an unaudited client is rejected with
// `unaudited_client_can_only_post_to_private_accounts`. RepostFlow therefore
// treats TikTok publishing as a DRAFT/HANDOFF for unaudited apps and never
// claims a public post it cannot make.

import type {
  Provider,
  OAuthTokens,
  RemoteAccountInfo,
  RemotePost,
  PublishOutcome,
} from "./types";
import { NotConfiguredError, ProviderError } from "./types";
import { httpJson, form } from "./http";

const SCOPES = ["user.info.basic", "video.list", "video.upload", "video.publish"];

function creds() {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) throw new NotConfiguredError("TIKTOK");
  return { key, secret };
}

// Whether this app has been audited for public direct-post. Opt-in only when
// TikTok has actually granted it. Defaults to false (compliant).
function isAudited(): boolean {
  return process.env.TIKTOK_AUDITED === "true";
}

export const tiktokProvider: Provider = {
  platform: "TIKTOK",

  isConfigured() {
    return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  },

  capabilities() {
    const ok = this.isConfigured();
    const audited = isAudited();
    return {
      canConnect: ok,
      canDetect: ok,
      canPublish: ok, // but see notes — draft/handoff unless audited
      notes: ok
        ? audited
          ? ["App is marked audited: direct public posting enabled where the creator permits."]
          : [
              "App is NOT audited by TikTok: the API can only create PRIVATE/self-only posts.",
              "RepostFlow uploads to the creator's TikTok inbox/drafts for manual review & public posting.",
              "Submit your app for TikTok's Content Posting API audit to enable direct public posts.",
            ]
        : ["Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to enable TikTok."],
    };
  },

  getAuthUrl({ state, challenge, redirectUri }) {
    const { key } = creds();
    const q = form({
      client_key: key,
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },

  async exchangeCode({ code, verifier, redirectUri }) {
    const { key, secret } = creds();
    const tok = await httpJson<any>("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        client_key: key,
        client_secret: secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    const tokens: OAuthTokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined,
      scopes: (tok.scope || "").split(",").filter(Boolean),
    };
    const info = await httpJson<any>(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
      { headers: { authorization: `Bearer ${tokens.accessToken}` } },
    );
    const u = info.data?.user;
    const account: RemoteAccountInfo = {
      providerAccountId: u?.open_id || tok.open_id,
      username: u?.display_name,
      displayName: u?.display_name,
      avatarUrl: u?.avatar_url,
      canPublish: tokens.scopes.includes("video.publish") || tokens.scopes.includes("video.upload"),
      statusDetail: isAudited() ? undefined : "Unaudited app: publishing is draft/handoff only.",
    };
    return { tokens, account };
  },

  async refresh(refreshToken) {
    const { key, secret } = creds();
    const tok = await httpJson<any>("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        client_key: key,
        client_secret: secret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined,
      scopes: (tok.scope || "").split(",").filter(Boolean),
    };
  },

  async listRecentPosts({ accessToken, limit = 15 }) {
    const res = await httpJson<any>(
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,share_url,create_time",
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ max_count: limit }),
      },
    );
    return (res.data?.videos || []).map((v: any): RemotePost => ({
      providerPostId: String(v.id),
      caption: v.video_description || v.title,
      title: v.title,
      permalink: v.share_url,
      thumbnailUrl: v.cover_image_url,
      durationSec: v.duration,
      publishedAt: v.create_time ? new Date(v.create_time * 1000) : undefined,
    }));
  },

  async publish({ accessToken, input }): Promise<PublishOutcome> {
    const audited = isAudited();

    if (!audited) {
      // Compliant path: upload to the creator's inbox as a draft for them to
      // review and post publicly themselves. This is NOT a public post.
      const init = await httpJson<any>(
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrl },
          }),
        },
      );
      const publishId = init.data?.publish_id;
      return {
        kind: "draft_handoff",
        providerPostId: publishId,
        note: "Uploaded to the creator's TikTok inbox as a draft. The creator must review and post it publicly in the TikTok app (required for unaudited apps).",
      };
    }

    // Audited path: direct post. privacy_level must be one the creator allows.
    const privacy =
      input.visibility === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE";
    const init = await httpJson<any>(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          post_info: {
            title: (input.title || input.caption || "").slice(0, 2200),
            privacy_level: privacy,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrl },
        }),
      },
    );
    const publishId = init.data?.publish_id;
    if (!publishId) throw new ProviderError("TikTok did not return a publish_id", { retryable: true, platform: "TIKTOK" });
    return { kind: "processing", providerUploadRef: publishId };
  },

  async reconcile({ accessToken, providerUploadRef }): Promise<PublishOutcome> {
    const res = await httpJson<any>(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ publish_id: providerUploadRef }),
      },
    );
    const status = res.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      const id = res.data?.publicaly_available_post_id?.[0] || res.data?.post_id;
      return { kind: "published", providerPostId: id ? String(id) : providerUploadRef };
    }
    if (status === "FAILED") {
      throw new ProviderError(`TikTok publish failed: ${res.data?.fail_reason || "unknown"}`, { platform: "TIKTOK" });
    }
    return { kind: "processing", providerUploadRef };
  },
};
