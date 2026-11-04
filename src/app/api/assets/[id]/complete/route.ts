import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";
import { queues } from "@/lib/queue";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.object({ contentHash: z.string().max(128).optional() });

// Called after the browser finishes the presigned PUT upload.
export const POST = withAuth(async ({ req, user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  const body = await parseBody(req, schema);

  await prisma.videoAsset.update({
    where: { id: asset.id },
    data: { uploadComplete: true, ...(body.contentHash ? { contentHash: body.contentHash } : {}) },
  });

  // Probe metadata (ffprobe) in the worker — unless demo (no real file).
  if (!getEnv().demo) {
    await queues.process().add("process", { assetId: asset.id }, { jobId: `process:${asset.id}` });
  } else {
    await prisma.videoAsset.update({
      where: { id: asset.id },
      data: { durationSec: 22, width: 1080, height: 1920, aspectRatio: "9:16", probed: true },
    });
  }

  return json({ ok: true });
});
