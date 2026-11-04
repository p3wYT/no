import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";
import { isStorageConfigured, deleteObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
});

export const PATCH = withAuth(async ({ req, user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  const body = await parseBody(req, patchSchema);
  const updated = await prisma.videoAsset.update({ where: { id: asset.id }, data: body });
  return json({ asset: { ...updated, sizeBytes: updated.sizeBytes?.toString() ?? null } });
});

export const DELETE = withAuth(async ({ user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  if (isStorageConfigured() && asset.storageKey) {
    try { await deleteObject(asset.storageKey); } catch { /* best effort */ }
  }
  await prisma.videoAsset.delete({ where: { id: asset.id } });
  return json({ ok: true });
});
