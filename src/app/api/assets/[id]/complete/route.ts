import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";
import { queues } from "@/lib/queue";
import { getEnv } from "@/lib/env";
import { headObject, isStorageConfigured } from "@/lib/storage";

export const dynamic = "force-dynamic";

const schema = z.object({ contentHash: z.string().max(128).optional() });

// Called after the browser finishes the presigned PUT upload. The object must
// actually exist in storage before the asset is marked usable.
export const POST = withAuth(async ({ req, user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  const body = await parseBody(req, schema);

  if (getEnv().demo) {
    await prisma.videoAsset.update({
      where: { id: asset.id },
      data: {
        uploadComplete: true,
        ...(body.contentHash ? { contentHash: body.contentHash } : {}),
        durationSec: 22, width: 1080, height: 1920, aspectRatio: "9:16", probed: true,
      },
    });
    return json({ ok: true });
  }

  if (!isStorageConfigured() || !asset.storageKey) {
    return error("Object storage is not configured; the video cannot be stored.", 409);
  }

  let size: number | undefined;
  try {
    const head = await headObject(asset.storageKey);
    size = head.ContentLength;
  } catch {
    return error("Upload not found in storage. Please upload the file again.", 409);
  }
  if (asset.sizeBytes != null && size != null && BigInt(size) !== asset.sizeBytes) {
    return error("Uploaded file size does not match the declared size.", 409);
  }

  await prisma.videoAsset.update({
    where: { id: asset.id },
    data: { uploadComplete: true, ...(body.contentHash ? { contentHash: body.contentHash } : {}) },
  });

  // Probe duration/dimensions with ffprobe in the worker.
  await queues.process().add("process", { assetId: asset.id }, { jobId: `process-${asset.id}` });

  return json({ ok: true });
});
