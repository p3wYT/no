// FFmpeg/ffprobe media inspection. Runs server-side in the worker.
// Probes an uploaded asset's duration / dimensions / aspect ratio from object
// storage (via a presigned URL — ffprobe reads remote URLs natively).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isStorageConfigured, presignDownload } from "@/lib/storage";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSec?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function aspectRatioString(width: number, height: number): string {
  if (!width || !height) return "";
  const g = gcd(width, height) || 1;
  return `${width / g}:${height / g}`;
}

export async function ffprobeUrl(url: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration:format=duration",
      "-of", "json",
      url,
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const width = stream.width ? Number(stream.width) : undefined;
  const height = stream.height ? Number(stream.height) : undefined;
  const duration = Number(stream.duration ?? data.format?.duration);
  return {
    width,
    height,
    durationSec: isNaN(duration) ? undefined : duration,
    aspectRatio: width && height ? aspectRatioString(width, height) : undefined,
  };
}

export async function probeAndStoreAsset(assetId: string): Promise<void> {
  const asset = await prisma.videoAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;

  const env = getEnv();
  if (env.demo) {
    await prisma.videoAsset.update({
      where: { id: assetId },
      data: { durationSec: 22, width: 1080, height: 1920, aspectRatio: "9:16", probed: true, uploadComplete: true },
    });
    return;
  }

  if (!isStorageConfigured() || !asset.storageKey) {
    logger.warn({ assetId }, "cannot probe asset: storage not configured or no key");
    return;
  }

  try {
    const url = await presignDownload(asset.storageKey, 60 * 30);
    const probe = await ffprobeUrl(url);
    await prisma.videoAsset.update({
      where: { id: assetId },
      data: {
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        aspectRatio: probe.aspectRatio,
        probed: true,
      },
    });
    logger.info({ assetId, probe }, "asset probed");
  } catch (err) {
    logger.error({ assetId, err }, "ffprobe failed");
    throw err;
  }
}

export interface CompatIssue { platform: string; ok: boolean; reasons: string[] }

/** Lightweight, pure compatibility check used by the UI + pre-publish. */
export function checkCompatibility(
  asset: { durationSec?: number | null; width?: number | null; height?: number | null; mimeType?: string | null },
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE",
): CompatIssue {
  // Import lazily to keep this module tree-shakeable in the browser build.
  const { platformSpec } = require("@/lib/core/platform") as typeof import("@/lib/core/platform");
  const spec = platformSpec(platform);
  const reasons: string[] = [];
  if (asset.durationSec != null) {
    if (asset.durationSec > spec.maxDurationSec) reasons.push(`Longer than ${spec.maxDurationSec}s max`);
    if (asset.durationSec < spec.minDurationSec) reasons.push(`Shorter than ${spec.minDurationSec}s min`);
  }
  return { platform, ok: reasons.length === 0, reasons };
}
