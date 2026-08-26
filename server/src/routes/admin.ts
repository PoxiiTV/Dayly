import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../middleware/audit.js";
import { hashPassword, randomToken, hashToken } from "../lib/crypto.js";
import { paginate } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";
import { mailConfigured, sendAdminWelcomeEmail, resetUrl } from "../lib/mail.js";
import { logger } from "../lib/logger.js";
import { purgeUserUploads } from "../lib/uploads.js";

/**
 * /api/admin — completely separate from the user surface. Every handler is
 * protected by requireRole("ADMIN") checked on the backend (never trust UI).
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

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
    const token = randomToken(32);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, id: hashToken(token), expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
    });
    await sendAdminWelcomeEmail({ to: b.email, name: b.name, setPasswordUrl: resetUrl(token) });
    emailSent = mailConfigured();
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

/** DELETE /api/admin/users/:id — hard delete (admin-level, requires confirmation). */
adminRouter.delete("/users/:id", asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.id) throw ApiError.badRequest("No puedes borrarte a ti mismo aquí.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } });
  await purgeUserUploads(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  await audit(req, "admin.user.delete", { entityType: "user", entityId: user.id, metadata: { email: user.email } });
  res.json({ ok: true });
}));