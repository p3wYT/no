import { prisma } from "@/lib/db";
import { withAuth, json, parseBody } from "@/lib/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  return json({ notifications, unread });
});

const schema = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() });

// Mark notifications read.
export const PATCH = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, schema);
  await prisma.notification.updateMany({
    where: { userId: user.id, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return json({ ok: true });
});
