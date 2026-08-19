import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";

export const inboxRouter = Router();
inboxRouter.use(requireAuth);

inboxRouter.get("/", asyncHandler(async (req, res) => {
  const { archived } = req.query as Record<string, string | undefined>;
  const items = await prisma.inboxItem.findMany({ where: { userId: req.user!.id, archived: archived === "true" }, orderBy: { createdAt: "desc" } });
  res.json({ items });
}));

inboxRouter.post("/", validate(schemas.inboxCreateSchema), asyncHandler(async (req, res) => {
  const item = await prisma.inboxItem.create({ data: { userId: req.user!.id, content: (req.body as { content: string }).content.trim() } });
  res.status(201).json({ item });
}));

inboxRouter.post("/:id/convert", validate(schemas.inboxConvertSchema), asyncHandler(async (req, res) => {
  const item = await prisma.inboxItem.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!item) throw ApiError.notFound("Elemento no encontrado.");
  const b = req.body as { type: "TASK" | "EVENT" | "NOTE"; title?: string; dueDate?: string; startAt?: string };
  const title = b.title ?? item.content;

  if (b.type === "TASK") {
    const task = await prisma.task.create({ data: { userId: req.user!.id, title, dueDate: b.dueDate ? new Date(b.dueDate) : null } });
    await prisma.inboxItem.update({ where: { id: item.id }, data: { taskId: task.id, archived: true } });
    return res.status(201).json({ task });
  }
  if (b.type === "EVENT") {
    const startAt = b.startAt ? new Date(b.startAt) : new Date();
    const event = await prisma.event.create({ data: { userId: req.user!.id, title, startAt, endAt: new Date(startAt.getTime() + 3600000) } });
    await prisma.inboxItem.update({ where: { id: item.id }, data: { eventId: event.id, archived: true } });
    return res.status(201).json({ event });
  }
  const note = await prisma.note.create({ data: { userId: req.user!.id, title, content: title } });
  await prisma.inboxItem.update({ where: { id: item.id }, data: { noteId: note.id, archived: true } });
  return res.status(201).json({ note });
}));

inboxRouter.post("/:id/archive", asyncHandler(async (req, res) => {
  await prisma.inboxItem.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { archived: true } });
  res.json({ ok: true });
}));
inboxRouter.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.inboxItem.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.json({ ok: true });
}));