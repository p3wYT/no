import { prisma } from "@/lib/db";
import { getValidAccessToken } from "./tokens";
import { logger } from "@/lib/logger";

/** Proactively refresh an account's token (called by the token-refresh queue). */
export async function refreshAccountToken(accountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status === "REVOKED") return;
  try {
    await getValidAccessToken(account); // refreshes if near expiry
  } catch (err) {
    logger.warn({ accountId, err }, "proactive token refresh failed");
  }
}
