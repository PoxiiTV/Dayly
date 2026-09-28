import type { Request } from "express";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import { config } from "../config/env.js";
import { ApiError } from "./errors.js";
import { decryptSecret, hashToken, randomToken, verifyTotp } from "./crypto.js";

export const VAULT_COOKIE = "dayly_vault";
/** Sliding vault *session*: blobs may be fetched; the AES key never leaves the browser. */
export const VAULT_UNLOCK_MS = 12 * 60 * 60 * 1000;
export const VAULT_EMAIL_OTP_MS = 10 * 60 * 1000;
export const VAULT_EMAIL_OTP_ATTEMPTS = 5;
export const VAULT_KDF = "pbkdf2-sha256";
export const VAULT_ITERATIONS_MIN = 210_000;
export const VAULT_ITERATIONS_MAX = 1_000_000;
export const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const VAULT_BACKUP_KIND = "kalendiario-cofre";

const PLAINTEXT_KEYS = new Set([
  "password", "pass", "passwd", "username", "user", "login", "title", "secret",
  "notes", "note", "url", "totp", "otp", "content", "plaintext", "item", "name",
  "credential", "clave", "contraseña", "contrasena", "otpsecret", "otp_secret",
  "folder", "folders", "tag", "tags", "etiqueta",
  "passwordhistory", "password_history", "passwordchangedat", "changedat", "history",
  "kind", "fields", "cardnumber", "card_number", "cvv", "ssid", "wifi",
]);

export function assertNoPlaintextSecrets(body: unknown, depth = 0): void {
  if (depth > 6 || body == null) return;
  if (Array.isArray(body)) {
    for (const item of body) assertNoPlaintextSecrets(item, depth + 1);
    return;
  }
  if (typeof body !== "object") return;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (PLAINTEXT_KEYS.has(key.toLowerCase())) {
      throw ApiError.badRequest("El Cofre no acepta secretos en claro. Solo blobs cifrados.");
    }
    assertNoPlaintextSecrets(value, depth + 1);
  }
}

export function isVaultBlob(nonce: string, ciphertext: string): boolean {
  return B64URL_RE.test(nonce) && nonce.length >= 16 && nonce.length <= 32
    && B64URL_RE.test(ciphertext) && ciphertext.length >= 24 && ciphertext.length <= 24_000;
}

export async function requireVaultTotp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.forbidden("Activa la verificación en dos pasos (Authy, Google Authenticator o Aegis) antes de usar el Cofre.");
  }
  const secret = decryptSecret(user.twoFactorSecret);
  if (!verifyTotp(secret, code.trim())) {
    throw ApiError.forbidden("Código de verificación no válido.");
  }
}

export function setVaultCookie(req: Request, token: string, expiresAt: Date) {
  const res = req.res;
  if (!res) return;
  res.cookie(VAULT_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearVaultCookie(req: Request) {
  const res = req.res;
  if (!res) return;
  res.clearCookie(VAULT_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" });
}

export async function issueVaultUnlock(req: Request, userId: string, vaultId: string): Promise<void> {
  await prisma.vaultUnlock.deleteMany({ where: { userId } });
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + VAULT_UNLOCK_MS);
  await prisma.vaultUnlock.create({
    data: { userId, vaultId, tokenHash: hashToken(token), expiresAt },
  });
  setVaultCookie(req, token, expiresAt);
}

export async function revokeVaultUnlock(req: Request, userId: string): Promise<void> {
  await prisma.vaultUnlock.deleteMany({ where: { userId } });
  clearVaultCookie(req);
}

export async function resolveVaultUnlock(req: Request, userId: string) {
  const token = req.cookies?.[VAULT_COOKIE] as string | undefined;
  if (!token) return null;
  const row = await prisma.vaultUnlock.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.userId !== userId || row.expiresAt < new Date()) {
    if (row) await prisma.vaultUnlock.deleteMany({ where: { id: row.id } }).catch(() => undefined);
    clearVaultCookie(req);
    return null;
  }
  const expiresAt = new Date(Date.now() + VAULT_UNLOCK_MS);
  await prisma.vaultUnlock.update({ where: { id: row.id }, data: { expiresAt } });
  setVaultCookie(req, token, expiresAt);
  return row;
}

function hashVaultEmailOtp(userId: string, code: string): string {
  return createHmac("sha256", process.env.APP_SECRET ?? "")
    .update(`vault-email-otp:${userId}:${code.trim()}`)
    .digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function startVaultEmailChallenge(userId: string, vaultId: string): Promise<{ code: string; expiresAt: Date }> {
  await prisma.vaultEmailChallenge.deleteMany({ where: { userId } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + VAULT_EMAIL_OTP_MS);
  await prisma.vaultEmailChallenge.create({
    data: { userId, vaultId, codeHash: hashVaultEmailOtp(userId, code), expiresAt },
  });
  return { code, expiresAt };
}

export async function consumeVaultEmailChallenge(userId: string, code: string): Promise<{ vaultId: string }> {
  const row = await prisma.vaultEmailChallenge.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (!row || row.expiresAt < new Date()) {
    if (row) await prisma.vaultEmailChallenge.deleteMany({ where: { id: row.id } }).catch(() => undefined);
    throw ApiError.forbidden("El código del correo no es válido o ha caducado.");
  }
  if (row.attempts >= VAULT_EMAIL_OTP_ATTEMPTS) {
    await prisma.vaultEmailChallenge.deleteMany({ where: { id: row.id } });
    throw ApiError.forbidden("Demasiados intentos. Vuelve a pedir un código con la app de autenticación.");
  }
  if (!hashesMatch(row.codeHash, hashVaultEmailOtp(userId, code))) {
    await prisma.vaultEmailChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw ApiError.forbidden("El código del correo no es válido o ha caducado.");
  }
  const vaultId = row.vaultId;
  await prisma.vaultEmailChallenge.deleteMany({ where: { userId } });
  return { vaultId };
}
