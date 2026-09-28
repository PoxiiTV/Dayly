import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../middleware/audit.js";
import { hashPassword } from "../lib/crypto.js";
import { paginate } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";
import { getSmtpSettings, loginUrl, mailConfigured, saveSmtpSettings, sendAdminPasswordResetEmail, sendAdminWelcomeEmail, testSmtpConnection } from "../lib/mail.js";
import { getSpotifySettings, saveSpotifySettings } from "../lib/spotifyApp.js";
import { getGifSettings, saveGifSettings } from "../lib/gifSettings.js";
import {
  getGooglePlatformConfig,
  getTelegramPlatformSettings,
  getWhatsAppPlatformConfig,
  saveGooglePlatformConfig,
  saveTelegramPlatformSettings,
  saveWhatsAppPlatformConfig,
} from "../lib/integrationSettings.js";
import { logger } from "../lib/logger.js";
import { purgeUserUploads } from "../lib/uploads.js";
import { clearGoogleAccessCache } from "../lib/googleMail.js";
import { getIntegrationDisplaySettings, saveIntegrationDisplaySettings } from "../lib/integrationVisibility.js";
import { clearSpotifyAccessCache } from "../lib/spotifyConnection.js";

/**
 * /api/admin — completely separate from the user surface. Every handler is
 * protected by requireRole("ADMIN") checked on the backend (never trust UI).
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

// ---------- SMTP configuration ----------
adminRouter.get("/smtp", asyncHandler(async (_req, res) => {
  res.json({ smtp: await getSmtpSettings() });
}));

adminRouter.patch("/smtp", validate(schemas.adminSmtpSettingsSchema), asyncHandler(async (req, res) => {
  const smtp = await saveSmtpSettings(req.body as z.infer<typeof schemas.adminSmtpSettingsSchema>);
  await audit(req, "admin.smtp.update", { entityType: "smtp" });
  res.json({ smtp });
}));

adminRouter.post("/smtp/test", asyncHandler(async (_req, res) => {
  await testSmtpConnection();
  res.json({ ok: true });
}));

adminRouter.get("/telegram", asyncHandler(async (_req, res) => {
  res.json({ telegram: await getTelegramPlatformSettings() });
}));

adminRouter.patch("/telegram", validate(schemas.adminTelegramSettingsSchema), asyncHandler(async (req, res) => {
  const telegram = await saveTelegramPlatformSettings(req.body as z.infer<typeof schemas.adminTelegramSettingsSchema>);
  await audit(req, "admin.telegram.update", { entityType: "telegram" });
  res.json({ telegram });
}));

adminRouter.get("/google", asyncHandler(async (_req, res) => {
  res.json({ google: await getGooglePlatformConfig() });
}));

adminRouter.patch("/google", validate(schemas.adminGoogleOAuthSettingsSchema), asyncHandler(async (req, res) => {
  const google = await saveGooglePlatformConfig(req.body as z.infer<typeof schemas.adminGoogleOAuthSettingsSchema>);
  if (req.body.confirmReconnect) clearGoogleAccessCache();
  await audit(req, "admin.google.update", { entityType: "google_oauth" });
  res.json({ google });
}));

adminRouter.get("/integration-visibility", asyncHandler(async (_req, res) => {
  res.json({ visibility: await getIntegrationDisplaySettings() });
}));

adminRouter.patch("/integration-visibility", validate(schemas.adminIntegrationVisibilitySchema), asyncHandler(async (req, res) => {
  const visibility = await saveIntegrationDisplaySettings(req.body as z.infer<typeof schemas.adminIntegrationVisibilitySchema>);
  await audit(req, "admin.integration_visibility.update", { entityType: "integration_visibility", metadata: req.body });
  res.json({ visibility });
}));

adminRouter.get("/whatsapp", asyncHandler(async (_req, res) => {
  res.json({ whatsapp: await getWhatsAppPlatformConfig() });
}));

adminRouter.patch("/whatsapp", validate(schemas.adminWhatsAppSettingsSchema), asyncHandler(async (req, res) => {
  const whatsapp = await saveWhatsAppPlatformConfig(req.body as z.infer<typeof schemas.adminWhatsAppSettingsSchema>);
  await audit(req, "admin.whatsapp.update", { entityType: "whatsapp_platform" });
  res.json({ whatsapp });
}));

adminRouter.get("/gif", asyncHandler(async (_req, res) => {
  res.json({ gif: await getGifSettings() });
}));

/** The key is written, never read back: the panel only ever sees `hasKey`. */
adminRouter.patch("/gif", validate(schemas.adminGifSettingsSchema), asyncHandler(async (req, res) => {
  const gif = await saveGifSettings(req.body as z.infer<typeof schemas.adminGifSettingsSchema>);
  await audit(req, "admin.gif.update", { entityType: "gif" });
  res.json({ gif });
}));

adminRouter.get("/spotify", asyncHandler(async (_req, res) => {
  res.json({ spotify: await getSpotifySettings() });
}));

adminRouter.patch("/spotify", validate(schemas.adminSpotifySettingsSchema), asyncHandler(async (req, res) => {
  const spotify = await saveSpotifySettings(req.body as z.infer<typeof schemas.adminSpotifySettingsSchema>);
  if (req.body.confirmReconnect) clearSpotifyAccessCache();
  await audit(req, "admin.spotify.update", { entityType: "spotify" });
  res.json({ spotify });
}));

// ---------- Stats dashboard ----------
adminRouter.get("/stats", asyncHandler(async (req, res) => {
  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const [totalUsers, activeUsers, newUsers, newUsersWeek, tasks, events, activeSessions, recentErrors, recentActivity] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { createdAt: { gte: startDay } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.task.count(),
    prisma.event.count(),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.auditLog.count({ where: { action: { contains: "error" } } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { user: { select: { name: true, email: true, id: true } } } }),
  ]);
  res.json({ stats: { totalUsers, activeUsers, newUsers, newUsersWeek, tasks, events, activeSessions, recentErrors }, recentActivity });
}));

// ---------- User management ----------
adminRouter.get("/users", validate(schemas.adminListSchema, "query"), asyncHandler(async (req, res) => {
  const { q, status, page } = req.query as { q?: string; status?: string; page?: string };
  const pg = paginate(Number(page ?? 1), 20);
  const whereAny: Record<string, unknown> = {};
  if (status) whereAny.status = status;
  if (q) whereAny.OR = [
    { emailLower: { contains: q.toLowerCase() } },
    { name: { contains: q } },
  ];
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where: whereAny, orderBy: { createdAt: "desc" }, skip: pg.skip, take: pg.take, select: { id: true, email: true, name: true, status: true, role: { select: { name: true } }, roleId: true, createdAt: true, lastLoginAt: true, emailVerifiedAt: true, twoFactorEnabled: true } }),
    prisma.user.count({ where: whereAny }),
  ]);
  res.json({ users, total, page: pg.page, hasMore: pg.skip + users.length < total });
}));

adminRouter.post("/users", validate(schemas.adminCreateUserSchema), asyncHandler(async (req, res) => {
  const b = req.body as { name: string; email: string; password: string; role: "USER" | "ADMIN" };
  const exists = await prisma.user.findUnique({ where: { emailLower: b.email } });
  if (exists) throw ApiError.conflict("Ya existe un usuario con ese email.");
  const role = await prisma.role.findUniqueOrThrow({ where: { name: b.role } });
  const passwordHash = await hashPassword(b.password);
  const user = await prisma.user.create({
    data: {
      name: b.name,
      email: b.email,
      emailLower: b.email,
      passwordHash,
      roleId: role.id,
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
    },
    select: { id: true, email: true, name: true },
  });
  await audit(req, "admin.user.create", { entityType: "user", entityId: user.id, metadata: { email: b.email } });
  let emailSent = false;
  try {
    await sendAdminWelcomeEmail({ to: b.email, name: b.name, temporaryPassword: b.password, loginUrl: loginUrl() });
    emailSent = await mailConfigured();
  } catch (err) {
    logger.error({ err, userId: user.id }, "[mail] no se pudo enviar el alta de admin");
  }
  res.status(201).json({ user, emailSent });
}));

adminRouter.patch("/users/:id", validate(schemas.adminUpdateUserSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const b = req.body as { name?: string; role?: "USER" | "ADMIN"; status?: "ACTIVE" | "SUSPENDED" };
  if (b.role === "USER" && req.user!.id === id) throw ApiError.badRequest("No puedes retirarte tu propio rol de administrador.");
  if (b.status === "SUSPENDED" && req.user!.id === id) throw ApiError.badRequest("No puedes suspender tu propia cuenta.");
  const data: Record<string, unknown> = {};
  if (b.name) data.name = b.name;
  if (b.role) { const role = await prisma.role.findUniqueOrThrow({ where: { name: b.role } }); data.roleId = role.id; }
  if (b.status) data.status = b.status;
  const user = await prisma.user.update({ where: { id }, data, select: { id: true, email: true, name: true } });
  if (b.status === "SUSPENDED") await prisma.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
  await audit(req, "admin.user.update", { entityType: "user", entityId: id, metadata: { ...b } });
  res.json({ user });
}));

/** POST /api/admin/users/:id/reset-password — admin sets a temporary password when a user loses theirs. */
adminRouter.post("/users/:id/reset-password", validate(schemas.adminResetPasswordSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const b = req.body as { password: string };
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } });
  if (!user) throw ApiError.notFound("Usuario no encontrado.");
  const passwordHash = await hashPassword(b.password);
  await prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
  // Force re-login everywhere: the old password (and any session opened with it) is no longer trusted.
  await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, "admin.user.reset_password", { entityType: "user", entityId: id });
  let emailSent = false;
  try {
    await sendAdminPasswordResetEmail({ to: user.email, name: user.name, temporaryPassword: b.password, loginUrl: loginUrl() });
    emailSent = await mailConfigured();
  } catch (err) {
    logger.error({ err, userId: id }, "[mail] no se pudo enviar el aviso de restablecimiento");
  }
  res.json({ user, emailSent });
}));

/** DELETE /api/admin/users/:id — hard delete (admin-level, requires confirmation). */
adminRouter.delete("/users/:id", asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.id) throw ApiError.badRequest("No puedes borrarte a ti mismo aquí.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } });
  await purgeUserUploads(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  await audit(req, "admin.user.delete", { entityType: "user", entityId: user.id, metadata: { email: user.email } });
  res.json({ ok: true });
}));
