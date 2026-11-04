// YouTube Data API v3 integration (Google OAuth 2.0).
// Docs: https://developers.google.com/youtube/v3

import type {
  Provider,
  OAuthTokens,
  RemoteAccountInfo,
  RemotePost,
  PublishInput,
  PublishOutcome,
} from "./types";
import { NotConfiguredError, ProviderError } from "./types";
import { httpJson, form } from "./http";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new NotConfiguredError("YOUTUBE");
  return { id, secret };
}

export const youtubeProvider: Provider = {
  platform: "YOUTUBE",

  isConfigured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },

  capabilities() {
    const ok = this.isConfigured();
    return {
      canConnect: ok,
      canDetect: ok,
      canPublish: ok,
      notes: ok
        ? [
            "Uploading counts against a daily quota (default 10,000 units; an upload ≈ 1,600 units).",
            "Until Google completes the YouTube API audit for this project, uploads are restricted to private visibility.",
            "While the Google consent screen is in Testing mode, only listed test users can connect and access expires after 7 days.",
          ]
        : ["Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable YouTube."],
    };
  },

  getAuthUrl({ state, challenge, redirectUri }) {
    const { id } = creds();
    const q = form({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },

  async exchangeCode({ code, verifier, redirectUri }) {
    const { id, secret } = creds();
    const tok = await httpJson<any>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tokens: OAuthTokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined,
      scopes: (tok.scope || "").split(" ").filter(Boolean),
    };
    const chan = await httpJson<any>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,status&mine=true",
      { headers: { authorization: `Bearer ${tokens.accessToken}` } },
    );
    const c = chan.items?.[0];
    if (!c) throw new ProviderError("No YouTube channel on this Google account", { platform: "YOUTUBE" });
    const account: RemoteAccountInfo = {
      providerAccountId: c.id,
      username: c.snippet?.customUrl || c.snippet?.title,
      displayName: c.snippet?.title,
      avatarUrl: c.snippet?.thumbnails?.default?.url,
      canPublish: tokens.scopes.some((s) => s.includes("youtube.upload")),
      statusDetail: undefined,
    };
    return { tokens, account };
  },

  async refresh(refreshToken) {
    const { id, secret } = creds();
    const tok = await httpJson<any>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({
        refresh_token: refreshToken,
        client_id: id,
        client_secret: secret,
        grant_type: "refresh_token",
      }),
    });
    return {
      accessToken: tok.access_token,
      refreshToken, // Google keeps the same refresh token.
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined,
      scopes: (tok.scope || "").split(" ").filter(Boolean),
    };
  },

  async listRecentPosts({ accessToken, providerAccountId, limit = 15 }) {
    const chan = await httpJson<any>(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${providerAccountId}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    const uploads = chan.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const pl = await httpJson<any>(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${limit}&playlistId=${uploads}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    return (pl.items || []).map((i: any): RemotePost => ({
      providerPostId: i.contentDetails?.videoId,
      caption: i.snippet?.description,
      title: i.snippet?.title,
      permalink: `https://www.youtube.com/watch?v=${i.contentDetails?.videoId}`,
      thumbnailUrl: i.snippet?.thumbnails?.medium?.url,
      publishedAt: i.contentDetails?.videoPublishedAt
        ? new Date(i.contentDetails.videoPublishedAt)
        : undefined,
    }));
  },

  async publish({ accessToken, input }): Promise<PublishOutcome> {
    // Resumable upload: 1) start session with metadata, 2) PUT the bytes
    // pulled from the presigned media URL.
    const metadata = {
      snippet: {
        title: (input.title || input.caption || "Untitled").slice(0, 100),
        description: input.description || input.caption || "",
      },
      status: {
        privacyStatus: input.visibility === "unlisted" ? "unlisted" : input.visibility === "private" ? "private" : "public",
        selfDeclaredMadeForKids: false,
      },
    };

    const media = await fetch(input.mediaUrl);
    if (!media.ok || !media.body) {
      throw new ProviderError("Could not read source media for upload", { retryable: true, platform: "YOUTUBE" });
    }
    const contentLength = media.headers.get("content-length") || undefined;

    const startRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/*",
          ...(contentLength ? { "X-Upload-Content-Length": contentLength } : {}),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!startRes.ok) {
      const t = await startRes.text();
      throw new ProviderError(`YouTube upload init failed: ${startRes.status} ${t}`, {
        retryable: startRes.status >= 500 || startRes.status === 403,
        platform: "YOUTUBE",
      });
    }
    const uploadUrl = startRes.headers.get("location");
    if (!uploadUrl) throw new ProviderError("No resumable upload URL returned", { retryable: true, platform: "YOUTUBE" });

    const buf = Buffer.from(await media.arrayBuffer());
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "video/*", "content-length": String(buf.length) },
      body: buf,
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new ProviderError(`YouTube upload failed: ${putRes.status} ${t}`, {
        retryable: putRes.status >= 500,
        platform: "YOUTUBE",
      });
    }
    const result = await putRes.json();
    const videoId = result.id as string;
    const requested = metadata.status.privacyStatus;
    const applied: string | undefined = result.status?.privacyStatus;
    return {
      kind: "published",
      providerPostId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      note:
        applied && applied !== requested
          ? `YouTube set this video to "${applied}" instead of "${requested}" (unaudited API projects can only upload private videos).`
          : undefined,
    };
  },
};
