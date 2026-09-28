import { Router } from "express";
import { z } from "zod";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { mailboxLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  listMailboxMessages,
  mailboxAuthType,
  MAX_MAILBOXES,
  publicMailbox,
  readMailboxMessage,
  replyMailboxMessage,
  saveGoogleMailbox,
  testMailboxConnection,
} from "../lib/mailbox.js";
import { imapErrorDetails, imapErrorMessage } from "../lib/mailboxText.js";
import {
  clearGoogleAccessCache,
  createPkceVerifier,
  exchangeGoogleCode,
  googleAccountEmail,
  googleAuthorizeUrl,
  googleCallbackUri,
  googleInboxUri,
  googleOAuthConfigured,
  originFromRequest,
  revokeGoogleToken,
} from "../lib/googleMail.js";
import { consumeOAuthAttempt, createOAuthAttempt } from "../lib/oauthAttempts.js";
import * as schemas from "../validation/schemas.js";
import { assertSafeMailboxConfig } from "../lib/networkSafety.js";

export const inboxMailRouter = Router();

inboxMailRouter.get("/google/callback", optionalAuth, asyncHandler(async (req, res) => {
  const originFallback = originFromRequest(req);
  const fail = (reason: string) => res.redirect(googleInboxUri(originFallback, { google: "error", reason }));
  const qError = typeof req.query.error === "string" ? req.query.error : "";
  if (qError) {
    return fail(qError === "access_denied" ? "denied" : "google");
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !stateRaw) return fail("google");
  if (!req.user || !req.sessionId) return fail("session");
  let attempt;
  try {
    attempt = await consumeOAuthAttempt({ provider: "GOOGLE_MAIL", state: stateRaw, userId: req.user.id, sessionId: req.sessionId });
  } catch (err) {
    logger.info({ reason: err instanceof ApiError ? err.message : "unknown" }, "google mail callback state rejected");
    return fail("google");
  }
  const attemptOrigin = new URL(attempt.redirectUri).origin;
  if (!attempt.verifier) return res.redirect(googleInboxUri(attemptOrigin, { google: "error", reason: "google" }));
  try {
    const tokens = await exchangeGoogleCode(code, attempt.redirectUri, attempt.verifier);
    const email = await googleAccountEmail(tokens.accessToken);
    await saveGoogleMailbox(req.user.id, email, tokens.refreshToken);
    return res.redirect(googleInboxUri(attemptOrigin, { google: "ok" }));
  } catch (err) {
    // Only our own messages: Google's responses and tokens never reach the log.
    logger.warn({ reason: err instanceof ApiError ? err.message : err instanceof Error ? err.name : "unknown", userId: req.user.id }, "google mail callback failed");
    return res.redirect(googleInboxUri(attemptOrigin, { google: "error", reason: "token" }));
  }
}));

inboxMailRouter.use(requireAuth);

inboxMailRouter.get("/google/config", asyncHandler(async (_req, res) => {
  res.json({ enabled: await googleOAuthConfigured() });
}));

inboxMailRouter.get("/google/start", asyncHandler(async (req, res) => {
  if (!await googleOAuthConfigured()) {
    throw ApiError.badRequest("Gmail con Google no está configurado en este servidor.");
  }
  const origin = originFromRequest(req);
  const redirectUri = googleCallbackUri(origin);
  const verifier = createPkceVerifier();
  const state = await createOAuthAttempt({ provider: "GOOGLE_MAIL", userId: req.user!.id, sessionId: req.sessionId!, redirectUri, returnTo: "/inbox", verifier });
  res.redirect(await googleAuthorizeUrl(state, redirectUri, verifier));
}));

function friendlyError(err: unknown, host?: string): never {
  if (err instanceof ApiError) throw err;
  const details = process.env.NODE_ENV === "development" ? imapErrorDetails(err, host) : undefined;
  throw ApiError.badRequest(imapErrorMessage(err, host), details);
}

async function loadMailbox(userId: string, id: string) {
  const mailbox = await prisma.mailbox.findFirst({ where: { id, userId } });
  if (!mailbox) throw ApiError.notFound("Buzón no encontrado.");
  return mailbox;
}

async function recordMailboxError(id: string, err: unknown) {
  const message = err instanceof ApiError ? err.message : imapErrorMessage(err);
  await prisma.mailbox.updateMany({ where: { id }, data: { lastError: message.slice(0, 300) } });
}

async function recordMailboxOk(id: string) {
  await prisma.mailbox.updateMany({ where: { id }, data: { lastError: null, lastCheckedAt: new Date() } });
}

inboxMailRouter.get("/", asyncHandler(async (req, res) => {
  const [mailboxes, user] = await Promise.all([
    prisma.mailbox.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "asc" } }),
    prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { defaultMailboxId: true } }),
  ]);
  res.json({ mailboxes: mailboxes.map((mailbox) => ({ ...publicMailbox(mailbox), isDefault: mailbox.id === user.defaultMailboxId })) });
}));

inboxMailRouter.post("/", validate(schemas.mailboxCreateSchema), asyncHandler(async (req, res) => {
  const count = await prisma.mailbox.count({ where: { userId: req.user!.id } });
  if (count >= MAX_MAILBOXES) throw ApiError.badRequest(`Puedes conectar como máximo ${MAX_MAILBOXES} buzones.`);
  const b = req.body as z.infer<typeof schemas.mailboxCreateSchema>;
  const email = b.email;
  const label = (b.label?.trim() || email).slice(0, 80);
  const username = (b.username?.trim() || email).slice(0, 190);
  await assertSafeMailboxConfig(b);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const mailbox = await tx.mailbox.create({
        data: {
        userId: req.user!.id,
        label,
        email,
        imapHost: b.imapHost.trim(),
        imapPort: b.imapPort,
        imapSecure: b.imapSecure,
        smtpHost: b.smtpHost.trim(),
        smtpPort: b.smtpPort,
        smtpSecure: b.smtpSecure,
        username,
        authType: "password",
        passwordEnc: encryptSecret(b.password),
        },
      });
      await tx.user.updateMany({ where: { id: req.user!.id, defaultMailboxId: null }, data: { defaultMailboxId: mailbox.id } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { defaultMailboxId: true } });
      return { mailbox, defaultMailboxId: user.defaultMailboxId };
    });
    res.status(201).json({ mailbox: { ...publicMailbox(result.mailbox), isDefault: result.mailbox.id === result.defaultMailboxId } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw ApiError.conflict("Ese correo ya está conectado.");
    }
    throw err;
  }
}));

inboxMailRouter.patch("/:id", validate(schemas.mailboxUpdateSchema), asyncHandler(async (req, res) => {
  const current = await loadMailbox(req.user!.id, req.params.id);
  const b = req.body as z.infer<typeof schemas.mailboxUpdateSchema>;
  // A Gmail box connected with Google keeps its Google servers and account:
  // its OAuth token must never be presented to any other host or identity.
  const google = mailboxAuthType(current) === "google";
  if (google && !b.password) {
    const locked = { email: current.email, imapHost: current.imapHost, imapPort: current.imapPort, imapSecure: current.imapSecure, smtpHost: current.smtpHost, smtpPort: current.smtpPort, smtpSecure: current.smtpSecure, username: current.username };
    const changed = (Object.keys(locked) as Array<keyof typeof locked>).filter((key) => b[key] !== undefined && b[key] !== locked[key]);
    if (changed.length) throw ApiError.badRequest("Un buzón conectado con Google solo permite cambiar su nombre. Para usar otro servidor, cambia a contraseña.");
  }
  const email = b.email ?? current.email;
  await assertSafeMailboxConfig({
    imapHost: b.imapHost ?? current.imapHost,
    imapSecure: b.imapSecure ?? current.imapSecure,
    smtpHost: b.smtpHost ?? current.smtpHost,
    smtpPort: b.smtpPort ?? current.smtpPort,
    smtpSecure: b.smtpSecure ?? current.smtpSecure,
  });
  try {
    const replacedGrant = google && b.password && current.oauthRefreshEnc ? decryptSecret(current.oauthRefreshEnc) : null;
    const mailbox = await prisma.mailbox.update({
      where: { id: current.id },
      data: {
        label: b.label !== undefined ? (b.label.trim() || email).slice(0, 80) : undefined,
        email: b.email,
        imapHost: b.imapHost?.trim(),
        imapPort: b.imapPort,
        imapSecure: b.imapSecure,
        smtpHost: b.smtpHost?.trim(),
        smtpPort: b.smtpPort,
        smtpSecure: b.smtpSecure,
        username: b.username?.trim(),
        passwordEnc: b.password ? encryptSecret(b.password) : undefined,
        authType: b.password ? "password" : undefined,
        oauthRefreshEnc: b.password ? null : undefined,
        lastError: null,
      },
    });
    if (replacedGrant) {
      clearGoogleAccessCache(mailbox.id);
      await revokeGoogleToken(replacedGrant);
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { defaultMailboxId: true } });
    res.json({ mailbox: { ...publicMailbox(mailbox), isDefault: mailbox.id === user.defaultMailboxId } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw ApiError.conflict("Ese correo ya está conectado.");
    }
    throw err;
  }
}));

inboxMailRouter.post("/:id/default", asyncHandler(async (req, res) => {
  const mailbox = await loadMailbox(req.user!.id, req.params.id);
  const disableEmail = Boolean(mailbox.lastError);
  await prisma.user.update({ where: { id: req.user!.id }, data: { defaultMailboxId: mailbox.id, ...(disableEmail ? { notifyEmail: false } : {}) } });
  res.json({ ok: true, defaultMailboxId: mailbox.id, emailNotificationsDisabled: disableEmail });
}));

inboxMailRouter.delete("/:id", asyncHandler(async (req, res) => {
  const current = await loadMailbox(req.user!.id, req.params.id);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { defaultMailboxId: true } });
    await tx.mailbox.delete({ where: { id: current.id } });
    if (user.defaultMailboxId === current.id) {
      const replacement = await tx.mailbox.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: "asc" }, select: { id: true, lastError: true } });
      await tx.user.update({
        where: { id: req.user!.id },
        data: {
          defaultMailboxId: replacement?.id ?? null,
          ...(!replacement || replacement.lastError ? { notifyEmail: false } : {}),
        },
      });
    }
  });
  if (current.oauthRefreshEnc) {
    clearGoogleAccessCache(current.id);
    await revokeGoogleToken(decryptSecret(current.oauthRefreshEnc));
  }
  res.json({ ok: true });
}));

inboxMailRouter.post("/:id/test", mailboxLimiter, asyncHandler(async (req, res) => {
  const mailbox = await loadMailbox(req.user!.id, req.params.id);
  try {
    await testMailboxConnection(mailbox);
    await recordMailboxOk(mailbox.id);
    res.json({ ok: true });
  } catch (err) {
    await recordMailboxError(mailbox.id, err);
    friendlyError(err, mailbox.imapHost);
  }
}));

inboxMailRouter.get("/:id/messages", mailboxLimiter, asyncHandler(async (req, res) => {
  const mailbox = await loadMailbox(req.user!.id, req.params.id);
  try {
    const messages = await listMailboxMessages(mailbox);
    await recordMailboxOk(mailbox.id);
    res.json({ messages });
  } catch (err) {
    await recordMailboxError(mailbox.id, err);
    friendlyError(err, mailbox.imapHost);
  }
}));

inboxMailRouter.get("/:id/messages/:uid", mailboxLimiter, asyncHandler(async (req, res) => {
  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid < 1) throw ApiError.badRequest("Mensaje no válido.");
  const mailbox = await loadMailbox(req.user!.id, req.params.id);
  try {
    const message = await readMailboxMessage(mailbox, uid);
    await recordMailboxOk(mailbox.id);
    res.json({ message });
  } catch (err) {
    await recordMailboxError(mailbox.id, err);
    friendlyError(err, mailbox.imapHost);
  }
}));

inboxMailRouter.post("/:id/messages/:uid/reply", mailboxLimiter, validate(schemas.mailboxReplySchema), asyncHandler(async (req, res) => {
  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid < 1) throw ApiError.badRequest("Mensaje no válido.");
  const mailbox = await loadMailbox(req.user!.id, req.params.id);
  const { text } = req.body as z.infer<typeof schemas.mailboxReplySchema>;
  try {
    await replyMailboxMessage(mailbox, uid, text);
    await recordMailboxOk(mailbox.id);
    res.json({ ok: true });
  } catch (err) {
    await recordMailboxError(mailbox.id, err);
    friendlyError(err, mailbox.imapHost);
  }
}));
