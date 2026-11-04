// Provider registry. Resolves the demo implementation in DEMO_MODE, else the
// real one. Also exposes capability info for the UI.

import type { Platform } from "@/lib/core/platform";
import type { Provider } from "./types";
import { getEnv } from "@/lib/env";
import { tiktokProvider } from "./tiktok";
import { instagramProvider } from "./instagram";
import { youtubeProvider } from "./youtube";
import { demoProviders } from "./demo";

const real: Record<Platform, Provider> = {
  TIKTOK: tiktokProvider,
  INSTAGRAM: instagramProvider,
  YOUTUBE: youtubeProvider,
};

export function getProvider(platform: Platform): Provider {
  if (getEnv().demo) return demoProviders[platform];
  return real[platform];
}

export interface ProviderCapabilityInfo {
  platform: Platform;
  configured: boolean;
  demo: boolean;
  canConnect: boolean;
  canDetect: boolean;
  canPublish: boolean;
  notes: string[];
}

export function allCapabilities(): ProviderCapabilityInfo[] {
  const demo = getEnv().demo;
  return (["TIKTOK", "INSTAGRAM", "YOUTUBE"] as Platform[]).map((p) => {
    const prov = getProvider(p);
    const caps = prov.capabilities();
    return {
      platform: p,
      configured: prov.isConfigured(),
      demo,
      canConnect: caps.canConnect,
      canDetect: caps.canDetect,
      canPublish: caps.canPublish,
      notes: caps.notes,
    };
  });
}

export * from "./types";
