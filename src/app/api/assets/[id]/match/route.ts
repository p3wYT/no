import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";
import { enqueuePublishAt } from "@/lib/queue";
import { logActivity } from "@/lib/engine/activity";

export const dynamic = "force-dynamic";

const schema = z.object({ detectedPostId: z.string().min(1) });

// Explicitly associate an original asset with a detected post, then release
// any jobs that were AWAITING_ASSET for that post.
export const POST = withAuth(async ({ req, user, params }) => {
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, userId: user.id } });
  if (!asset) return error("Asset not found", 404);
  const body = await parseBody(req, schema);

  const post = await prisma.detectedPost.findFirst({ where: { id: body.detectedPostId, userId: user.id } });
  if (!post) return error("Detected post not found", 404);

  await prisma.detectedPost.update({ where: { id: post.id }, data: { matchedAssetId: asset.id } });

  // Release awaiting jobs for this post.
  const awaiting = await prisma.publishJob.findMany({
    where: { detectedPostId: post.id, status: "AWAITING_ASSET", userId: user.id },
  });
  for (const job of awaiting) {
    const when = job.scheduledAt && job.scheduledAt > new Date() ? job.scheduledAt : new Date();
    await prisma.publishJob.update({ where: { id: job.id }, data: { assetId: asset.id, status: "SCHEDULED", scheduledAt: when } });
    await enqueuePublishAt(job.id, when);
  }

  await logActivity({
    userId: user.id,
    kind: "asset.matched",
    message: `Original media associated with a detected ${post.platform} post`,
    meta: { assetId: asset.id, detectedPostId: post.id, released: awaiting.length },
  });

  return json({ ok: true, released: awaiting.length });
});
