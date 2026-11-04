import { prisma } from "@/lib/db";
import { getValidAccessToken, refreshStoredToken } from "./tokens";
import { notify } from "./activity";
import { logger } from "@/lib/logger";
import type { Platform } from "@prisma/client";

// Long-lived credentials that must be renewed BEFORE they lapse. (Google and
// TikTok access tokens are short-lived and refreshed on demand with a durable
// refresh token, so they do not need this.)
export const PROACTIVE_REFRESH_PLATFORMS: Platform[] = ["INSTAGRAM"];
export const REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const WARN_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Accounts whose long-lived token expires within the refresh window. */
export async function findAccountsNeedingRefresh(now = new Date()) {
  return prisma.socialAccount.findMany({
    where: {
      platform: { in: PROACTIVE_REFRESH_PLATFORMS },
      status: { in: ["CONNECTED", "LIMITED"] },
      refreshTokenEnc: { not: null },
      tokenExpiresAt: { not: null, lte: new Date(now.getTime() + REFRESH_WINDOW_MS) },
    },
    select: { id: true },
    take: 500,
  });
}

/** Proactively refresh an account's token (called by the token-refresh queue). */
export async function refreshAccountToken(accountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status === "REVOKED" || !account.refreshTokenEnc || !account.tokenExpiresAt) return;
  if (account.tokenExpiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) return;

  // Already lapsed: the on-demand path marks the account and notifies once.
  if (account.tokenExpiresAt.getTime() <= Date.now()) {
    await getValidAccessToken(account).catch(() => undefined);
    return;
  }

  try {
    await refreshStoredToken(account);
    logger.info({ accountId, platform: account.platform }, "token renewed ahead of expiry");
  } catch (err) {
    // The current token still works, so keep the account usable and warn the
    // user (at most weekly) while there is time to reconnect.
    logger.warn({ accountId, err: (err as Error).message }, "proactive token renewal failed");
    const recent = await prisma.notification.findFirst({
      where: {
        userId: account.userId,
        type: "TOKEN_REFRESH_FAILED",
        createdAt: { gt: new Date(Date.now() - WARN_EVERY_MS) },
        meta: { path: ["accountId"], equals: account.id },
      },
      select: { id: true },
    });
    if (!recent) {
      const days = Math.max(1, Math.ceil((account.tokenExpiresAt.getTime() - Date.now()) / 86_400_000));
      await notify({
        userId: account.userId,
        type: "TOKEN_REFRESH_FAILED",
        title: `Reconnect ${account.platform} within ${days} day${days === 1 ? "" : "s"}`,
        body: `@${account.username ?? account.providerAccountId} could not be renewed automatically and will stop working when its access expires.`,
        meta: { accountId: account.id },
      });
    }
  }
}
