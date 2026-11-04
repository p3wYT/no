// Optional dev seed: creates a demo user you can log in with.
// Safe no-op in production.
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("Skipping seed in production.");
    return;
  }
  const email = "demo@repostflow.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Demo user already exists:", email);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash("demopassword", { type: argon2.argon2id }),
      name: "Demo Creator",
      preferences: { create: { timezone: "America/New_York" } },
    },
  });
  console.log(`Seeded demo user → ${email} / demopassword`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
