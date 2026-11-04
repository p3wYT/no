import { prisma } from "@/lib/db";
import { withAuth, json, parseBody } from "@/lib/api";
import { prefsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const prefs = await prisma.userPreferences.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  return json({ user: { id: user.id, email: user.email, name: user.name }, preferences: prefs });
});

export const PATCH = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, prefsSchema);
  const prefs = await prisma.userPreferences.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...body },
    update: body,
  });
  return json({ preferences: prefs });
});
