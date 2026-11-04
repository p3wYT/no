import { prisma } from "@/lib/db";
import { withAuth, json, error } from "@/lib/api";
import { enqueueDetect } from "@/lib/queue";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Manual "Check for new posts" — rate limited to protect provider quotas.
export const POST = withAuth(async ({ user, params }) => {
  const acc = await prisma.socialAccount.findFirst({ where: { id: params.id, userId: user.id } });
  if (!acc) return error("Account not found", 404);

  const rl = await rateLimit(`check:${acc.id}`, 3, 60);
  if (!rl.ok) return error("Please wait before checking again", 429);

  await enqueueDetect(acc.id, true);
  return json({ ok: true, message: "Checking for new posts…" });
});
