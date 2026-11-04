import { prisma } from "@/lib/db";
import { withAuth, json, parseBody } from "@/lib/api";
import { captionTemplateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withAuth(async ({ user }) => {
  const templates = await prisma.captionTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return json({ templates });
});

export const POST = withAuth(async ({ req, user }) => {
  const body = await parseBody(req, captionTemplateSchema);
  const template = await prisma.captionTemplate.create({
    data: { userId: user.id, name: body.name, platform: body.platform, body: body.body, isDefault: body.isDefault },
  });
  return json({ template }, 201);
});
