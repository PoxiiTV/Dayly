import { Router } from "express";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toPublicUser } from "../services/auth.service.js";
import { audit } from "../middleware/audit.js";
import * as schemas from "../validation/schemas.js";
import { NICK_MAX, SUBNICK_MAX, sanitizeNick, sanitizeSegments, segmentsAreUniform, segmentsText } from "../lib/nick.js";
import {
  absUploadPath,
  attachmentFileExists,
  isJpegBuffer,
  purgeUserUploads,
  removeAttachmentFile,
  wallpaperStorageKey,
  writeAttachmentFile,
} from "../lib/uploads.js";
import { acceptWallpaperFile } from "../middleware/upload.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/me/wallpaper", asyncHandler(async (req, res) => {
  const key = wallpaperStorageKey(req.user!.id);
  if (!attachmentFileExists(key)) throw ApiError.notFound("No hay fondo personalizado.");
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(absUploadPath(key));
}));

usersRouter.post("/me/wallpaper", acceptWallpaperFile, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file?.buffer?.length) throw ApiError.badRequest("Sube una foto JPG, PNG o WebP.");
  if (!isJpegBuffer(file.buffer)) throw ApiError.badRequest("La foto no es válida.");
  const key = wallpaperStorageKey(req.user!.id);
  await writeAttachmentFile(key, file.buffer);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { wallpaper: "custom" },
    include: { role: true },
  });
  await audit(req, "user.update_wallpaper", { entityType: "user", entityId: user.id });
  res.json({ user: toPublicUser(user) });
}));

usersRouter.delete("/me/wallpaper", asyncHandler(async (req, res) => {
  await removeAttachmentFile(wallpaperStorageKey(req.user!.id));
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { wallpaper: "none" },
    include: { role: true },
  });
  await audit(req, "user.clear_wallpaper", { entityType: "user", entityId: user.id });
  res.json({ user: toPublicUser(user) });
}));

/** GET /api/users/me/preferences */
/**
 * The PARSED body, never `req.body`.
 *
 * `validate()` checks the payload but leaves `req.body` untouched, and these
 * handlers feed their data straight to `prisma.user.update`. Zod strips keys
 * the schema does not declare, so reading the parsed copy is what stops a
 * client from smuggling extra User columns into the update — sending
 * `{"name":"x","roleId":"<id de ADMIN>"}` to PATCH /me used to make a plain
 * user an administrator.
 */
function parsedBody<T>(req: Request): T {
  return (req as Request & { validatedBody?: T }).validatedBody ?? ({} as T);
}

usersRouter.get("/me", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { role: true } });
  res.json({ user: toPublicUser(user) });
}));

/** PATCH /api/users/me/preferences — update profile/settings. */
usersRouter.patch("/me/preferences", validate(schemas.updateProfileSchema), asyncHandler(async (req, res) => {
  const data = parsedBody<Record<string, unknown>>(req);
  if (data.notifyEmail === true) {
    const owner = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { defaultMailboxId: true } });
    const mailbox = owner?.defaultMailboxId
      ? await prisma.mailbox.findFirst({ where: { id: owner.defaultMailboxId, userId: req.user!.id }, select: { lastError: true } })
      : null;
    if (!mailbox) throw ApiError.badRequest("Elige primero un buzón predeterminado para enviar avisos por correo.");
    if (mailbox.lastError) throw ApiError.badRequest("Prueba o vuelve a conectar el buzón predeterminado antes de activar los avisos.");
  }
  const user = await prisma.user.update({ where: { id: req.user!.id }, data, include: { role: true } });
  await audit(req, "user.update_preferences", { entityType: "user", entityId: user.id });
  res.json({ user: toPublicUser(user) });
}));

/** PATCH /api/users/me — profile (name/avatar). */
usersRouter.patch("/me", validate(schemas.updateProfileSchema.pick({ name: true, avatarUrl: true, nick: true, nickColor: true, nickBold: true, subnick: true, nickSegments: true })), asyncHandler(async (req, res) => {
  const b = parsedBody<{
    name?: string;
    avatarUrl?: string | null;
    nick?: string | null;
    nickColor?: string | null;
    nickBold?: boolean;
    subnick?: string | null;
    nickSegments?: unknown;
  }>(req);
  const data: Prisma.UserUpdateInput = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.avatarUrl !== undefined) data.avatarUrl = b.avatarUrl;
  // The nick is rendered by OTHER people, so it is cleaned here rather than
  // trusted: see `sanitizeNick`.
  if (b.nick !== undefined) data.nick = sanitizeNick(b.nick, NICK_MAX);
  if (b.nickSegments !== undefined) {
    const pieces = sanitizeSegments(b.nickSegments, NICK_MAX);
    // `nick` always holds the plain text: search, notifications and every
    // fallback read it, and they must never have to understand pieces.
    data.nick = pieces ? segmentsText(pieces) : (b.nick !== undefined ? data.nick : null);
    // One colour throughout is not worth storing as pieces.
    data.nickSegments = pieces && !segmentsAreUniform(pieces)
      ? (pieces as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
    if (pieces && segmentsAreUniform(pieces)) data.nickColor = pieces[0].c ?? null;
  }
  if (b.subnick !== undefined) data.subnick = sanitizeNick(b.subnick, SUBNICK_MAX);
  if (b.nickColor !== undefined) data.nickColor = b.nickColor ?? null;
  if (b.nickBold !== undefined) data.nickBold = b.nickBold;
  const user = await prisma.user.update({ where: { id: req.user!.id }, data, include: { role: true } });
  await audit(req, "user.update_profile", { entityType: "user", entityId: user.id });
  res.json({ user: toPublicUser(user) });
}));

/** DELETE /api/users/me — self-delete (soft: suspend + anonymize). */
usersRouter.delete("/me", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  await purgeUserUploads(user.id);
  const anon = `deleted_${user.id.slice(0, 8)}@dayly.invalid`;
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { email: anon, emailLower: anon, name: "Cuenta eliminada", status: "SUSPENDED" } }),
    prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, "user.delete", { entityType: "user", entityId: user.id });
  res.json({ ok: true });
}));

/** GET /api/users/me/activity — own recent audit trail. */
usersRouter.get("/me/activity", asyncHandler(async (req, res) => {
  const logs = await prisma.auditLog.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ activity: logs });
}));
