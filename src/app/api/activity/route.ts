import { prisma } from "@/lib/db";
import { withAuth, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const events = await prisma.activityEvent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  const nextCursor = events.length === 50 ? events[events.length - 1].id : null;
  return json({ events, nextCursor });
});
