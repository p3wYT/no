import { prisma } from "@/lib/db";
import { withAuth, json, error, parseBody } from "@/lib/api";
import { captionTemplateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const PATCH = withAuth(async ({ req, user, params }) => {
  const tpl = await prisma.captionTemplate.findFirst({ where: { id: params.id, userId: user.id } });
  if (!tpl) return error("Template not found", 404);
  const body = await parseBody(req, captionTemplateSchema.partial());
  const updated = await prisma.captionTemplate.update({ where: { id: tpl.id }, data: body });
  return json({ template: updated });
});

export const DELETE = withAuth(async ({ user, params }) => {
  const tpl = await prisma.captionTemplate.findFirst({ where: { id: params.id, userId: user.id } });
  if (!tpl) return error("Template not found", 404);
  await prisma.captionTemplate.delete({ where: { id: tpl.id } });
  return json({ ok: true });
});
