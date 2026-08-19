import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";
import { validate } from "../middleware/validate.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", asyncHandler(async (req, res) => {
  const { unread } = req.query as Record<string, string | undefined>;
  const whereAny: Prisma.NotificationWhereInput = { userId: req.user!.id, ...(unread === "true" ? { read: false } : {}) };
  const notifications = await prisma.notification.findMany({ where: whereAny, orderBy: { createdAt: "desc" }, take: 100 });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, read: false } });
  res.json({ notifications, unreadCount });
}));

notificationsRouter.post("/read", validate(schemas.readNotificationsSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (ids?.length) await prisma.notification.updateMany({ where: { id: { in: ids }, userId: req.user!.id }, data: { read: true } });
  else await prisma.notification.updateMany({ where: { userId: req.user!.id }, data: { read: true } });
  res.json({ ok: true });
}));

notificationsRouter.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.json({ ok: true });
}));

// Housekeeping: clear read notifications older than 30 days.
notificationsRouter.delete("/", asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const r = await prisma.notification.deleteMany({ where: { userId: req.user!.id, read: true, createdAt: { lt: cutoff } } });
  res.json({ ok: true, deleted: r.count });
}));