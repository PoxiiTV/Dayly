import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toPublicUser } from "../services/auth.service.js";
import { audit } from "../middleware/audit.js";
import * as schemas from "../validation/schemas.js";
import { purgeUserUploads } from "../lib/uploads.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** GET /api/users/me/preferences */
usersRouter.get("/me", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { role: true } });
  res.json({ user: toPublicUser(user) });
}));

/** PATCH /api/users/me/preferences — update profile/settings. */
usersRouter.patch("/me/preferences", validate(schemas.updateProfileSchema), asyncHandler(async (req, res) => {
  const data = req.body as Record<string, unknown>;
  const user = await prisma.user.update({ where: { id: req.user!.id }, data, include: { role: true } });
  await audit(req, "user.update_preferences", { entityType: "user", entityId: user.id });
  res.json({ user: toPublicUser(user) });
}));

/** PATCH /api/users/me — profile (name/avatar). */
usersRouter.patch("/me", validate(schemas.updateProfileSchema.pick({ name: true, avatarUrl: true })), asyncHandler(async (req, res) => {
  const data = req.body as { name?: string; avatarUrl?: string | null };
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