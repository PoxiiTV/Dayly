import type { OAuthProvider } from "@prisma/client";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "./crypto.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

const ATTEMPT_TTL_MS = 15 * 60_000;

export async function createOAuthAttempt(input: {
  provider: OAuthProvider;
  userId: string;
  sessionId: string;
  redirectUri: string;
  returnTo?: string;
  verifier?: string;
}) {
  const state = randomToken(32);
  await prisma.oAuthAttempt.deleteMany({
    where: { userId: input.userId, provider: input.provider, OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });
  await prisma.oAuthAttempt.create({
    data: {
      provider: input.provider,
      userId: input.userId,
      sessionId: input.sessionId,
      stateHash: hashToken(state),
      verifierEnc: input.verifier ? encryptSecret(input.verifier) : null,
      redirectUri: input.redirectUri,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    },
  });
  return state;
}

export async function consumeOAuthAttempt(input: {
  provider: OAuthProvider;
  state: string;
  userId: string;
  sessionId: string;
}) {
  const row = await prisma.oAuthAttempt.findFirst({
    where: {
      provider: input.provider,
      stateHash: hashToken(input.state),
      userId: input.userId,
      sessionId: input.sessionId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!row) throw ApiError.badRequest("La autorización ha caducado o ya se ha utilizado.");
  const claimed = await prisma.oAuthAttempt.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw ApiError.badRequest("La autorización ya se ha utilizado.");
  return { ...row, verifier: row.verifierEnc ? decryptSecret(row.verifierEnc) : null };
}

function safeReturnTo(value: string | undefined): string {
  const raw = (value ?? "/").trim();
  return raw.startsWith("/") && !raw.startsWith("//") ? raw.slice(0, 500) : "/";
}
