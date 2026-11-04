import { prisma } from "@/lib/db";
import type { NotificationType } from "@prisma/client";

export async function logActivity(args: {
  userId: string;
  kind: string;
  message: string;
  jobId?: string;
  meta?: Record<string, unknown>;
}) {
  await prisma.activityEvent.create({
    data: {
      userId: args.userId,
      kind: args.kind,
      message: args.message,
      jobId: args.jobId,
      meta: args.meta as any,
    },
  });
}

export async function notify(args: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
}) {
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      meta: args.meta as any,
    },
  });
}
