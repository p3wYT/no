import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, error } from "@/lib/api";
import { isStorageConfigured, presignDownload } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Owner-only access to the original file: redirect to a short-lived presigned
// URL so bytes come straight from the bucket (no service egress).
export const GET = withAuth(async ({ user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  if (!asset.uploadComplete || !asset.storageKey || !isStorageConfigured()) {
    return error("This video has no stored file", 404);
  }
  const url = await presignDownload(asset.storageKey, 60 * 10);
  return NextResponse.redirect(url, 302);
});
