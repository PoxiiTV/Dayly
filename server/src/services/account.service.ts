import type { Request } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpAuthUrl,
  generateTotpSecret,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyTotp,
  passwordPolicyError,
  normalizeRecoveryCode,
} from "../lib/crypto.js";
import { createSession, clearSessionCookie, toPublicUser } from "./auth.service.js";
import { audit } from "../middleware/audit.js";

const RATE_MESSAGE = "Credenciales incorrectas.";

/** Register a new account. Verification token is stored for email flows. */
export async function register(req: Request, body: { name: string; email: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { emailLower: body.email } });
  if (existing) throw ApiError.conflict("Ya existe una cuenta con ese email.");

  const pwError = passwordPolicyError(body.password);
  if (pwError) throw ApiError.validation(pwError);

  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: "USER" } });
  const passwordHash = await hashPassword(body.password);

  try {
    const user = await prisma.user.create({
      data: {
        email: body.email,
        emailLower: body.email,
        name: body.name,
        passwordHash,
        roleId: userRole.id,
      },
      include: { role: true },
    });
    await audit(req, "auth.register", { entityType: "user", entityId: user.id });
    const { makeVerifyToken, sendVerifyEmail, verifyUrl } = await import("../lib/mail.js");
    const token = makeVerifyToken(user.emailLower);
    await sendVerifyEmail(user.email, user.name, verifyUrl(token));
    return { user: toPublicUser(user) };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw ApiError.conflict("Ya existe una cuenta con ese email.");
    }
    throw err;
  }
}

export async function login(
  req: Request,
  body: { email: string; password: string; twoFactorCode?: string },
) {
  const user = await prisma.user.findUnique({
    where: { emailLower: body.email },
    include: { role: true },
  });

  // Same message whether user exists or not, to avoid user enumeration.
  if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
    throw ApiError.unauthorized(RATE_MESSAGE);
  }
  if (user.status !== "ACTIVE") {
    throw ApiError.forbidden("Tu cuenta está suspendida. Contacta con el administrador.");
  }

  if (user.twoFactorEnabled) {
    const secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : "";
    const code = (body.twoFactorCode ?? "").trim();
    const totpOk = !!code && verifyTotp(secret, code);
    const recoveryOk = !totpOk && !!code
      ? await consumeRecoveryCode(user.id, user.recoveryCodes, code)
      : false;
    if (!totpOk && !recoveryOk) {
      throw ApiError.unauthorized("Código de verificación en dos pasos no válido.");
    }
  }

  const token = await createSession(req, user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastIp: req.ip ?? null } });
  await audit(req, "auth.login", { entityType: "user", entityId: user.id });

  return { token, user: toPublicUser(user) };
}

export async function logout(req: Request) {
  if (req.sessionId) {
    await prisma.session.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } });
    await audit(req, "auth.logout");
  }
  clearSessionCookie(req);
}

/** List active sessions for the current user (excluding current). */
export async function listSessions(req: Request) {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    take: 50,
  });
  return sessions.map((s) => ({
    id: s.id,
    ip: s.ip,
    userAgent: s.userAgent,
    lastUsedAt: s.lastUsedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === req.sessionId,
  }));
}

/** Revoke a specific session. Users can always revoke their own sessions. */
export async function revokeSession(req: Request, sessionId: string) {
  const target = await prisma.session.findFirst({
    where: { id: sessionId, userId: req.user!.id },
  });
  if (!target) throw ApiError.notFound("Sesión no encontrada.");
  if (target.id === req.sessionId) throw ApiError.unauthorized("No puedes cerrar la sesión actual así.");
  await prisma.session.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
  await audit(req, "auth.session.revoke");
  return { ok: true };
}

export async function revokeAllOtherSessions(req: Request) {
  await prisma.session.updateMany({
    where: { userId: req.user!.id, revokedAt: null, id: { not: req.sessionId } },
    data: { revokedAt: new Date() },
  });
  await audit(req, "auth.session.revoke_all");
  return { ok: true };
}

export async function changePassword(req: Request, body: { currentPassword: string; newPassword: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
    throw ApiError.unauthorized("La contraseña actual no es correcta.");
  }
  const pwError = passwordPolicyError(body.newPassword);
  if (pwError) throw ApiError.validation(pwError);
  const passwordHash = await hashPassword(body.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
  // Rotate other sessions for defense in depth.
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: req.sessionId } },
    data: { revokedAt: new Date() },
  });
  await audit(req, "auth.password_change", { entityType: "user", entityId: user.id });
  return { ok: true };
}

/** First login after admin invite: the emailed password must be replaced. */
export async function firstPassword(req: Request, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.mustChangePassword) {
    throw ApiError.badRequest("Ya tienes una contraseña definitiva.");
  }
  const pwError = passwordPolicyError(newPassword);
  if (pwError) throw ApiError.validation(pwError);
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw ApiError.validation("Elige una contraseña distinta a la del correo.");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: req.sessionId } },
    data: { revokedAt: new Date() },
  });
  await audit(req, "auth.password_first", { entityType: "user", entityId: user.id });
  return { ok: true };
}

// ---------- 2FA ----------
export async function start2faSetup(req: Request) {
  const secret = generateTotpSecret();
  const url = generateTotpAuthUrl(secret, req.user!.email);
  const encrypted = encryptSecret(secret);
  // Store pending secret (flag set on enable).
  await prisma.user.update({ where: { id: req.user!.id }, data: { twoFactorSecret: encrypted } });
  return { secret, url };
}

export async function enable2fa(req: Request, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.twoFactorSecret) throw ApiError.badRequest("Inicia la configuración de 2FA primero.");
  const secret = decryptSecret(user.twoFactorSecret);
  if (!verifyTotp(secret, code)) throw ApiError.unauthorized("Código no válido.");
  const codes = generateRecoveryCodes();
  const { prisma: p } = await import("../lib/prisma.js");
  // Store hashed recovery codes (not plaintext) as a JSON list of sha256.
  const hashedCodes = await Promise.all(codes.map((c) => hashToken(normalizeRecoveryCode(c))));
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true, recoveryCodes: hashedCodes as unknown as object },
  });
  await p.notification.create({
    data: {
      userId: user.id,
      type: "SYSTEM",
      title: "Verificación en dos pasos activada",
      body: "Tu cuenta ahora requiere un código al iniciar sesión. Guarda tus códigos de recuperación.",
    },
  });
  await audit(req, "auth.2fa.enable", { entityType: "user", entityId: user.id });
  return { ok: true, recoveryCodes: codes };
}

export async function disable2fa(req: Request, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.twoFactorEnabled) throw ApiError.badRequest("2FA no está activada.");
  const secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : "";
  if (!verifyTotp(secret, code)) throw ApiError.unauthorized("Código no válido.");
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: undefined },
  });
  await audit(req, "auth.2fa.disable", { entityType: "user", entityId: user.id });
  return { ok: true };
}

export async function regenerateRecoveryCodes(req: Request, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.twoFactorEnabled) throw ApiError.badRequest("2FA no está activada.");
  const secret = user.twoFactorSecret ? decryptSecret(user.twoFactorSecret) : "";
  if (!verifyTotp(secret, code)) throw ApiError.unauthorized("Código no válido.");
  const codes = generateRecoveryCodes();
  const hashedCodes = await Promise.all(codes.map((c) => hashToken(normalizeRecoveryCode(c))));
  await prisma.user.update({
    where: { id: user.id },
    data: { recoveryCodes: hashedCodes as unknown as object },
  });
  await audit(req, "auth.2fa.recovery_regen", { entityType: "user", entityId: user.id });
  return { ok: true, recoveryCodes: codes };
}

function normalizeRecovery(code: string) {
  return normalizeRecoveryCode(code);
}

async function consumeRecoveryCode(userId: string, stored: unknown, input: string): Promise<boolean> {
  const list = asStringList(stored);
  if (!list.length) return false;
  const hashed = hashToken(normalizeRecovery(input));
  const idx = list.indexOf(hashed);
  if (idx < 0) return false;
  const next = list.filter((_, i) => i !== idx);
  await prisma.user.update({ where: { id: userId }, data: { recoveryCodes: next } });
  return true;
}

function asStringList(stored: unknown): string[] {
  if (Array.isArray(stored)) return stored.filter((x): x is string => typeof x === "string");
  if (stored && typeof stored === "object") {
    return Object.values(stored as Record<string, unknown>).filter((x): x is string => typeof x === "string");
  }
  return [];
}

// ---------- Password reset ----------
export async function forgotPassword(req: Request, email: string) {
  const user = await prisma.user.findUnique({ where: { emailLower: email } });
  // Always return ok to avoid account enumeration.
  if (!user) return { ok: true };
  const token = (await import("../lib/crypto.js")).randomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, id: hashToken(token), expiresAt },
  });
  await audit(req, "auth.password_reset_request", { entityType: "user", entityId: user.id });
  const { sendPasswordResetEmail, resetUrl } = await import("../lib/mail.js");
  try {
    await sendPasswordResetEmail(user.email, user.name, resetUrl(token));
  } catch (err) {
    const { logger } = await import("../lib/logger.js");
    logger.error({ err, userId: user.id }, "[mail] falló el envío de recuperación");
    throw err;
  }
  return { ok: true };
}

export async function resetPassword(req: Request, token: string, password: string) {
  const id = hashToken(token);
  const rec = await prisma.passwordResetToken.findUnique({ where: { id } });
  if (!rec || rec.usedAt) throw ApiError.unauthorized("El enlace de recuperación no es válido o ya se usó.");
  if (rec.expiresAt < new Date()) throw ApiError.unauthorized("El enlace ha caducado.");
  const pwError = passwordPolicyError(password);
  if (pwError) throw ApiError.validation(pwError);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, "auth.password_reset", { entityType: "user", entityId: rec.userId });
  return { ok: true };
}

export async function verifyEmail(req: Request, token: string) {
  const { prisma: p } = await import("../lib/prisma.js");
  const { createHmac } = await import("node:crypto");
  const { config: cfg } = await import("../config/env.js");
  // Stateless signed token: base64(email).hmac. Prevents forging/guessing.
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw ApiError.unauthorized("Enlace no válido.");
  const expected = createHmac("sha256", cfg.appSecret).update(payload).digest("base64url");
  if (sig !== expected) throw ApiError.unauthorized("Enlace no válido.");
  const email = Buffer.from(payload, "base64url").toString("utf8").toLowerCase();
  if (!email || !email.includes("@")) throw ApiError.unauthorized("Enlace no válido.");

  const user = await prisma.user.findUnique({ where: { emailLower: email } });
  if (!user) throw ApiError.unauthorized("Cuenta no encontrada.");
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: user.emailVerifiedAt ?? now },
  });
  await p.auditLog.create({
    data: { userId: user.id, action: "auth.email_verify", entityType: "user", entityId: user.id, ip: req.ip ?? undefined },
  });
  return { ok: true, emailConfirmed: true };
}