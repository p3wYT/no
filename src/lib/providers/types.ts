// Common provider contract. Real providers implement officially-supported
// OAuth + API flows. When credentials are absent they throw NotConfigured so
// the UI shows "Setup required" — never a faked connection.

import type { Platform } from "@/lib/core/platform";

export class NotConfiguredError extends Error {
  constructor(public platform: Platform) {
    super(`${platform} integration is not configured (missing credentials)`);
    this.name = "NotConfiguredError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public opts: { retryable?: boolean; code?: string; platform?: Platform } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface RemoteAccountInfo {
  providerAccountId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  // Can this account publish through the official API at its current tier?
  canPublish: boolean;
  statusDetail?: string;
}

export interface RemotePost {
  providerPostId: string;
  caption?: string;
  title?: string;
  permalink?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  publishedAt?: Date;
}

export interface PublishInput {
  // Presigned, SSRF-checked URL the provider can pull media from, OR a stream.
  mediaUrl: string;
  caption: string;
  title?: string;
  description?: string;
  visibility: "public" | "unlisted" | "private";
  // Provider upload ref from a prior attempt, for reconciliation.
  priorUploadRef?: string;
}

export type PublishOutcome =
  | { kind: "published"; providerPostId: string; url?: string }
  | { kind: "processing"; providerUploadRef: string }
  // Platform/app tier only permits a private draft / handoff, not public post.
  | { kind: "draft_handoff"; providerPostId?: string; note: string };

export interface Provider {
  platform: Platform;
  /** Whether real credentials are present for this provider. */
  isConfigured(): boolean;
  /** Human-readable capability summary for the UI. */
  capabilities(): {
    canConnect: boolean;
    canDetect: boolean;
    canPublish: boolean;
    notes: string[];
  };

  getAuthUrl(args: { state: string; challenge: string; redirectUri: string }): string;
  exchangeCode(args: { code: string; verifier: string; redirectUri: string }): Promise<{
    tokens: OAuthTokens;
    account: RemoteAccountInfo;
  }>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  listRecentPosts(args: { accessToken: string; providerAccountId: string; limit?: number }): Promise<RemotePost[]>;
  publish(args: { accessToken: string; providerAccountId: string; input: PublishInput }): Promise<PublishOutcome>;
  /** Reconcile a possibly-lost publish response. */
  reconcile?(args: { accessToken: string; providerUploadRef: string }): Promise<PublishOutcome>;
}
