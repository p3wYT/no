import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { z } from "zod";
import { enqueuePublishAt } from "@/lib/queue";
import { logActivity } from "@/lib/engine/activity";
import { canTransition } from "@/lib/core/jobState";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum(["approve", "cancel", "retry", "reschedule", "update"]),
  scheduledAt: z.string().datetime().optional(),
  resolvedCaption: z.string().max(5000).optional(),
  resolvedTitle: z.string().max(200).optional(),
});

export const GET = withAuth(async ({ user, params }) => {
  const job = await prisma.publishJob.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      destinationAccount: { select: { platform: true, username: true } },
      detectedPost: true,
      asset: true,
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!job) return error("Job not found", 404);
  return json({ job });
});

export const PATCH = withAuth(async ({ req, user, params }) => {
  const job = await prisma.publishJob.findFirst({ where: { id: params.id, userId: user.id } });
  if (!job) return error("Job not found", 404);
  const body = await parseBody(req, patchSchema);

  switch (body.action) {
    case "approve": {
      if (job.status !== "PENDING_APPROVAL") return error("Job is not awaiting approval", 409);
      const next = job.assetId ? "SCHEDULED" : "AWAITING_ASSET";
      const when = job.scheduledAt && job.scheduledAt > new Date() ? job.scheduledAt : new Date();
      await prisma.publishJob.update({ where: { id: job.id }, data: { status: next, scheduledAt: when } });
      if (next === "SCHEDULED") await enqueuePublishAt(job.id, when);
      await logActivity({ userId: user.id, kind: "publish.approved", jobId: job.id, message: `Approved ${job.destinationPlatform} post` });
      return json({ ok: true, status: next });
    }
    case "cancel": {
      if (job.status === "PUBLISHED" || job.status === "CANCELLED") return error("Cannot cancel this job", 409);
      await prisma.publishJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
      await logActivity({ userId: user.id, kind: "publish.cancelled", jobId: job.id, message: `Cancelled ${job.destinationPlatform} post` });
      return json({ ok: true, status: "CANCELLED" });
    }
    case "retry": {
      if (!canTransition(job.status as any, "QUEUED")) return error("Job cannot be retried from its current state", 409);
      await prisma.publishJob.update({ where: { id: job.id }, data: { status: "QUEUED", lastError: null } });
      await enqueuePublishAt(job.id, new Date());
      await logActivity({ userId: user.id, kind: "publish.retry", jobId: job.id, message: `Retrying ${job.destinationPlatform} post` });
      return json({ ok: true, status: "QUEUED" });
    }
    case "reschedule": {
      if (!body.scheduledAt) return error("scheduledAt required", 422);
      if (["PUBLISHED", "CANCELLED", "PROCESSING", "UPLOADING", "PUBLISHING"].includes(job.status)) {
        return error("Cannot reschedule a job in progress or completed", 409);
      }
      const when = new Date(body.scheduledAt);
      await prisma.publishJob.update({ where: { id: job.id }, data: { scheduledAt: when, status: job.status === "AWAITING_ASSET" ? job.status : "SCHEDULED" } });
      if (job.status !== "AWAITING_ASSET" && job.status !== "PENDING_APPROVAL") await enqueuePublishAt(job.id, when);
      return json({ ok: true, scheduledAt: when });
    }
    case "update": {
      if (["PUBLISHED", "CANCELLED", "UPLOADING", "PUBLISHING"].includes(job.status)) {
        return error("Cannot edit a job that is in progress or completed", 409);
      }
      await prisma.publishJob.update({
        where: { id: job.id },
        data: {
          ...(body.resolvedCaption !== undefined ? { resolvedCaption: body.resolvedCaption } : {}),
          ...(body.resolvedTitle !== undefined ? { resolvedTitle: body.resolvedTitle } : {}),
        },
      });
      return json({ ok: true });
    }
  }
});
