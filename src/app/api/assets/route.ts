import { prisma } from "@/lib/db";
import { withAuth, json, parseBody } from "@/lib/api";
import { assetInitSchema } from "@/lib/validation";
import { isStorageConfigured, presignUpload, buildKey } from "@/lib/storage";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/mov": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
};

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const assets = await prisma.videoAsset.findMany({
    where: {
      userId: user.id,
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { originalName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      publishJobs: { select: { id: true, destinationPlatform: true, status: true, publishedUrl: true } },
      _count: { select: { detectedPosts: true } },
    },
  });
  // BigInt -> string for JSON safety.
  const safe = assets.map((a) => ({ ...a, sizeBytes: a.sizeBytes ? a.sizeBytes.toString() : null }));
  return json({ assets: safe });
});

export const POST = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, assetInitSchema);
  const ext = EXT[body.mimeType] ?? "mp4";

  const asset = await prisma.videoAsset.create({
    data: {
      userId: user.id,
      source: body.detectedPostId ? "MATCHED_UPLOAD" : "USER_UPLOAD",
      title: body.title,
      description: body.description,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: BigInt(body.sizeBytes),
      contentHash: body.contentHash,
      uploadComplete: false,
    },
  });

  const storageKey = buildKey(user.id, "original", asset.id, ext);
  await prisma.videoAsset.update({ where: { id: asset.id }, data: { storageKey } });

  let uploadUrl: string | null = null;
  if (isStorageConfigured()) {
    uploadUrl = await presignUpload(storageKey, body.mimeType, body.sizeBytes);
  }

  return json(
    {
      asset: { id: asset.id, storageKey },
      uploadUrl,
      storageConfigured: isStorageConfigured(),
      demo: getEnv().demo,
      note: uploadUrl
        ? "PUT the file bytes directly to uploadUrl, then POST /api/assets/{id}/complete."
        : "Object storage is not configured; set S3_* env vars to enable real uploads.",
    },
    201,
  );
});
