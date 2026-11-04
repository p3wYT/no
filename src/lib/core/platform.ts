// Platform capability + constraint reference.
// These encode REAL, documented limits. They are the single source of truth
// used by caption trimming, compatibility checks, and the UI capability cards.

export type Platform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

export interface PlatformSpec {
  key: Platform;
  label: string;
  // Max chars for the primary text field (caption/description).
  captionMaxChars: number;
  // Max chars for title where a separate title exists (YouTube).
  titleMaxChars?: number;
  // Max video duration we will attempt to publish (seconds). Conservative.
  maxDurationSec: number;
  minDurationSec: number;
  // Accepted container/codec summary for compatibility messaging.
  acceptedContainers: string[];
  // Aspect ratios the short-form surface prefers.
  preferredAspect: string[];
  // Whether the official API supports fully automatic public publishing
  // for a *typical* (unaudited) developer app. See providers/* for detail.
  autoPublishTypicallyAvailable: boolean;
  docsUrl: string;
}

export const PLATFORMS: Record<Platform, PlatformSpec> = {
  TIKTOK: {
    key: "TIKTOK",
    label: "TikTok",
    // TikTok caption limit was raised substantially; keep a safe cap.
    captionMaxChars: 2200,
    maxDurationSec: 600,
    minDurationSec: 1,
    acceptedContainers: ["mp4", "mov", "webm"],
    preferredAspect: ["9:16"],
    // TikTok Content Posting API requires app audit for direct public post;
    // unaudited apps can only create private/draft content ("handoff").
    autoPublishTypicallyAvailable: false,
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  },
  INSTAGRAM: {
    key: "INSTAGRAM",
    label: "Instagram",
    captionMaxChars: 2200,
    maxDurationSec: 900,
    minDurationSec: 3,
    acceptedContainers: ["mp4", "mov"],
    preferredAspect: ["9:16"],
    // Requires a Business/Creator account linked to a FB Page + app review.
    autoPublishTypicallyAvailable: true,
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  },
  YOUTUBE: {
    key: "YOUTUBE",
    label: "YouTube",
    captionMaxChars: 5000,
    titleMaxChars: 100,
    maxDurationSec: 60 * 60,
    minDurationSec: 1,
    acceptedContainers: ["mp4", "mov", "webm", "avi"],
    preferredAspect: ["9:16", "16:9"],
    autoPublishTypicallyAvailable: true,
    docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
  },
};

export function platformSpec(p: Platform): PlatformSpec {
  return PLATFORMS[p];
}
