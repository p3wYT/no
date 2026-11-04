// Deterministic in-memory provider for DEMO_MODE and e2e tests ONLY.
// getEnv() forbids DEMO_MODE in production, so this never runs in prod.

import type { Platform } from "@/lib/core/platform";
import type {
  Provider,
  OAuthTokens,
  RemoteAccountInfo,
  RemotePost,
  PublishOutcome,
} from "./types";

function makeDemo(platform: Platform): Provider {
  return {
    platform,
    isConfigured: () => true,
    capabilities: () => ({
      canConnect: true,
      canDetect: true,
      canPublish: true,
      notes: ["DEMO MODE — no real platform calls are made."],
    }),

    getAuthUrl({ state, redirectUri }) {
      // Short-circuit straight back to the callback with a synthetic code.
      const u = new URL(redirectUri);
      u.searchParams.set("code", `demo-code-${platform}`);
      u.searchParams.set("state", state);
      u.searchParams.set("demo", "1");
      return u.toString();
    },

    async exchangeCode(): Promise<{ tokens: OAuthTokens; account: RemoteAccountInfo }> {
      return {
        tokens: {
          accessToken: `demo-access-${platform}`,
          refreshToken: `demo-refresh-${platform}`,
          expiresAt: new Date(Date.now() + 3600_000),
          scopes: ["demo"],
        },
        account: {
          providerAccountId: `demo-${platform.toLowerCase()}-001`,
          username: `demo_${platform.toLowerCase()}`,
          displayName: `Demo ${platform}`,
          avatarUrl: undefined,
          canPublish: true,
          statusDetail: "Demo account",
        },
      };
    },

    async refresh(refreshToken): Promise<OAuthTokens> {
      return {
        accessToken: `demo-access-${platform}-${Date.now()}`,
        refreshToken,
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["demo"],
      };
    },

    async listRecentPosts({ limit = 3 }): Promise<RemotePost[]> {
      const now = Date.now();
      return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        providerPostId: `demo-${platform}-post-${i}`,
        caption: `Demo ${platform} video ${i} #demo #repostflow`,
        title: `Demo ${platform} clip ${i}`,
        durationSec: 20 + i,
        width: 1080,
        height: 1920,
        publishedAt: new Date(now - i * 3600_000),
      }));
    },

    async publish(): Promise<PublishOutcome> {
      if (platform === "TIKTOK") {
        return {
          kind: "draft_handoff",
          providerPostId: `demo-draft-${Date.now()}`,
          note: "Demo: TikTok handoff/draft (unaudited app behavior).",
        };
      }
      return {
        kind: "published",
        providerPostId: `demo-published-${Date.now()}`,
        url: `https://example.com/${platform.toLowerCase()}/demo`,
      };
    },
  };
}

export const demoProviders: Record<Platform, Provider> = {
  TIKTOK: makeDemo("TIKTOK"),
  INSTAGRAM: makeDemo("INSTAGRAM"),
  YOUTUBE: makeDemo("YOUTUBE"),
};
