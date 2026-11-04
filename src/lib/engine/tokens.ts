// Valid-access-token resolution with transparent refresh + encryption.

import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { notify } from "./activity";
import { logger } from "@/lib/logger";
import type { SocialAccount } from "@prisma/client";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export async function getValidAccessToken(account: SocialAccount): Promise<string> {
  if (!account.accessTokenEnc) {
    throw new Error(`Account ${account.id} has no access token`);
  }
  const expired =
    account.tokenExpiresAt && account.tokenExpiresAt.getTime() - REFRESH_SKEW_MS < Date.now();

  if (!expired) {
    return decrypt(account.accessTokenEnc);
  }

  if (!account.refreshTokenEnc) {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: "TOKEN_EXPIRED", statusDetail: "Access token expired and no refresh token available" },
    });
    await notify({
      userId: account.userId,
      type: "TOKEN_REFRESH_FAILED",
      title: `${account.platform} account needs reconnection`,
      body: `@${account.username ?? account.providerAccountId} must be reconnected.`,
    });
    throw new Error("Token expired, reconnect required");
  }

  try {
    const provider = getProvider(account.platform);
    const refreshed = await provider.refresh(decrypt(account.refreshTokenEnc));
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encrypt(refreshed.accessToken),
        refreshTokenEnc: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : account.refreshTokenEnc,
        tokenExpiresAt: refreshed.expiresAt,
        status: "CONNECTED",
        statusDetail: null,
      },
    });
    return refreshed.accessToken;
  } catch (err) {
    logger.error({ err, accountId: account.id }, "token refresh failed");
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: "TOKEN_EXPIRED", statusDetail: "Token refresh failed" },
    });
    await notify({
      userId: account.userId,
      type: "TOKEN_REFRESH_FAILED",
      title: `${account.platform} token refresh failed`,
      body: `Please reconnect @${account.username ?? account.providerAccountId}.`,
    });
    throw err;
  }
}
