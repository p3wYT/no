// Engine wiring for the Instagram fixes, against a real Postgres + Redis.
// The provider is scripted (no network); what is under test is how the engine
// persists, reconciles and retries around it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { encryptNullable, decrypt } from "@/lib/crypto";
import { signState } from "@/lib/auth/oauth-state";
import { demoProviders } from "@/lib/providers/demo";
import { ProviderError } from "@/lib/providers/types";
import { executePublishJob } from "@/lib/engine/publish";
import { findAccountsNeedingRefresh, refreshAccountToken } from "@/lib/engine/maintenance";
import { GET as callback } from "@/app/api/connect/[platform]/callback/route";
import { queues } from "@/lib/queue";

const EMAIL = "ig-engine@test.local";
let userId: string;
const ig = demoProviders.INSTAGRAM;
const original = { publish: ig.publish, reconcile: ig.reconcile, refresh: ig.refresh, exchangeCode: ig.exchangeCode };

const day = 86_400_000;
async function account(over: Record<string, unknown> = {}) {
  return prisma.socialAccount.create({
    data: {
      userId,
      platform: "INSTAGRAM",
      providerAccountId: `ig-${Math.random().toString(36).slice(2)}`,
      username: "tester",
      accessTokenEnc: encryptNullable("access-1"),
      refreshTokenEnc: encryptNullable("access-1"),
      tokenExpiresAt: new Date(Date.now() + 30 * day),
      status: "CONNECTED",
      canPublish: true,
      ...over,
    },
  });
}
async function job(accountId: string, assetId: string, over: Record<string, unknown> = {}) {
  return prisma.publishJob.create({
    data: {
      userId, destinationAccountId: accountId, destinationPlatform: "INSTAGRAM", assetId,
      status: "SCHEDULED", scheduledAt: new Date(), resolvedCaption: "c",
      idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, ...over,
    },
  });
}

let assetId: string;
beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const u = await prisma.user.create({ data: { email: EMAIL, passwordHash: await hashPassword("x".repeat(10)), preferences: { create: {} } } });
  userId = u.id;
  assetId = (await prisma.videoAsset.create({ data: { userId, uploadComplete: true, storageKey: "k/v.mp4" } })).id;
});
afterAll(async () => {
  Object.assign(ig, original);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await queues.reconcile().obliterate({ force: true }).catch(() => undefined);
  await Promise.all(Object.values(queues).map((q) => q().close()));
  await prisma.$disconnect();
});

describe("a lost media_publish response cannot cause a second post", () => {
  it("persists the container id on failure, then the retry reconciles instead of re-uploading", async () => {
    const acc = await account();
    const j = await job(acc.id, assetId);
    let publishCalls = 0;
    let reconciled: string | undefined;
    ig.publish = async () => {
      publishCalls++;
      throw new ProviderError("socket hang up", { retryable: true, uploadRef: "container-1" });
    };
    ig.reconcile = async (a) => {
      reconciled = `${a.providerUploadRef}@${a.providerAccountId}`;
      return { kind: "published", providerPostId: "media-1", url: "https://www.instagram.com/reel/x/" };
    };

    await executePublishJob(j.id).catch(() => undefined); // retryable error is rethrown for BullMQ
    const failed = await prisma.publishJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.providerUploadRef).toBe("container-1");
    expect(publishCalls).toBe(1);

    await executePublishJob(j.id); // BullMQ retry
    const done = await prisma.publishJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(done.status).toBe("PUBLISHED");
    expect(done.providerPostId).toBe("media-1");
    expect(publishCalls).toBe(1); // never uploaded a second time
    expect(reconciled).toBe(`container-1@${acc.providerAccountId}`);
  });

  it("forgets a dead (expired/errored) container so a manual retry can upload again", async () => {
    const acc = await account();
    const j = await job(acc.id, assetId, { providerUploadRef: "dead-container", status: "FAILED" });
    ig.reconcile = async () => {
      throw new ProviderError("container EXPIRED", { clearUploadRef: true });
    };
    await executePublishJob(j.id).catch(() => undefined);
    const after = await prisma.publishJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(after.status).toBe("FAILED");
    expect(after.providerUploadRef).toBeNull();
  });
});

describe("proactive renewal of Instagram's ~60-day token", () => {
  it("selects only Instagram accounts expiring within 14 days", async () => {
    const soon = await account({ tokenExpiresAt: new Date(Date.now() + 3 * day) });
    const later = await account({ tokenExpiresAt: new Date(Date.now() + 40 * day) });
    const noRefresh = await account({ tokenExpiresAt: new Date(Date.now() + 3 * day), refreshTokenEnc: null });
    const yt = await account({ platform: "YOUTUBE", tokenExpiresAt: new Date(Date.now() + 3 * day) });
    const ids = (await findAccountsNeedingRefresh()).map((a) => a.id);
    expect(ids).toContain(soon.id);
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(noRefresh.id);
    expect(ids).not.toContain(yt.id);
  });

  it("renews, re-encrypts and extends the expiry", async () => {
    const acc = await account({ tokenExpiresAt: new Date(Date.now() + 3 * day) });
    let received = "";
    ig.refresh = async (t) => {
      received = t;
      return { accessToken: "access-2", refreshToken: "access-2", expiresAt: new Date(Date.now() + 60 * day), scopes: [] };
    };
    await refreshAccountToken(acc.id);
    const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(received).toBe("access-1");
    expect(decrypt(after.accessTokenEnc!)).toBe("access-2");
    expect(decrypt(after.refreshTokenEnc!)).toBe("access-2");
    expect(after.accessTokenEnc).not.toContain("access-2");
    expect(after.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * day);
  });

  it("if renewal fails while the token still works, keeps the account usable and warns once", async () => {
    const acc = await account({ tokenExpiresAt: new Date(Date.now() + 5 * day) });
    ig.refresh = async () => {
      throw new Error("exchange rejected");
    };
    await refreshAccountToken(acc.id);
    await refreshAccountToken(acc.id);
    const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(after.status).toBe("CONNECTED");
    const warnings = await prisma.notification.findMany({ where: { userId, type: "TOKEN_REFRESH_FAILED" } });
    expect(warnings.filter((n) => (n.meta as any)?.accountId === acc.id)).toHaveLength(1);
  });
});

describe("OAuth callback saves every Instagram account behind one login", () => {
  it("creates one account row per discovered account, sharing encrypted credentials", async () => {
    const accounts = [
      { providerAccountId: "ig-A", username: "alpha", canPublish: true },
      { providerAccountId: "ig-B", username: "beta", canPublish: true },
      { providerAccountId: "ig-C", username: "gamma", canPublish: false, statusDetail: "permission missing" },
    ];
    ig.exchangeCode = async () => ({
      tokens: { accessToken: "long-A", refreshToken: "long-A", expiresAt: new Date(Date.now() + 60 * day), scopes: ["instagram_basic"] },
      account: accounts[0],
      additionalAccounts: accounts.slice(1),
    });
    const state = await signState({ userId, platform: "INSTAGRAM", verifier: "v" });
    const res = await callback(new NextRequest(`http://localhost:3000/api/connect/instagram/callback?code=abc&state=${state}`), {
      params: Promise.resolve({ platform: "instagram" }),
    });
    expect(res.headers.get("location")).toContain("/accounts?connected=INSTAGRAM");

    const rows = await prisma.socialAccount.findMany({ where: { userId, providerAccountId: { in: ["ig-A", "ig-B", "ig-C"] } }, orderBy: { providerAccountId: "asc" } });
    expect(rows.map((r) => r.username)).toEqual(["alpha", "beta", "gamma"]);
    expect(rows.map((r) => r.status)).toEqual(["CONNECTED", "CONNECTED", "LIMITED"]);
    expect(rows.every((r) => decrypt(r.accessTokenEnc!) === "long-A")).toBe(true);
    expect(rows[2].statusDetail).toBe("permission missing");
  });

  it("rejects a tampered state without touching the database", async () => {
    const before = await prisma.socialAccount.count({ where: { userId } });
    const res = await callback(new NextRequest(`http://localhost:3000/api/connect/instagram/callback?code=abc&state=forged`), {
      params: Promise.resolve({ platform: "instagram" }),
    });
    expect(res.headers.get("location")).toContain("error=invalid_state");
    expect(await prisma.socialAccount.count({ where: { userId } })).toBe(before);
  });
});
