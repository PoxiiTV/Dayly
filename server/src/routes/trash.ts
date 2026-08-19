/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/** Paper bin: list soft-deleted items grouped by type, restore/delete-forever. */
export const trashRouter = Router();
trashRouter.use(requireAuth);

const softDeletedWhere = (userId: string) => ({ userId, deletedAt: { not: null } });

trashRouter.get("/", asyncHandler(async (req, res) => {
  const [tasks, events, notes, projects, goals] = await Promise.all([
    prisma.task.findMany({ where: softDeletedWhere(req.user!.id), select: { id: true, title: true, deletedAt: true } }),
    prisma.event.findMany({ where: softDeletedWhere(req.user!.id), select: { id: true, title: true, deletedAt: true } }),
    prisma.note.findMany({ where: softDeletedWhere(req.user!.id), select: { id: true, title: true, deletedAt: true } }),
    prisma.project.findMany({ where: softDeletedWhere(req.user!.id), select: { id: true, name: true, deletedAt: true } }),
    prisma.goal.findMany({ where: softDeletedWhere(req.user!.id), select: { id: true, title: true, deletedAt: true } }),
  ]);
  res.json({ tasks, events, notes, projects, goals });
}));

/** Restore a soft-deleted resource. type in task|event|note|project|goal */
trashRouter.post("/restore", asyncHandler(async (req, res) => {
  const { type, id } = req.body as { type: string; id: string };
  const m = mapModel(type);
  if (!m) throw ApiError.badRequest("Tipo no válido.");
  const r = await m.updateMany({ where: { id, userId: req.user!.id, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (r.count === 0) throw ApiError.notFound("Elemento no encontrado en la papelera.");
  res.json({ ok: true });
}));

/** Permanently delete. type in task|event|note|project|goal */
trashRouter.delete("/permanent", asyncHandler(async (req, res) => {
  const { type, id } = req.body as { type: string; id: string };
  const m = mapModel(type);
  if (!m) throw ApiError.badRequest("Tipo no válido.");
  const r = await m.deleteMany({ where: { id, userId: req.user!.id } });
  if (r.count === 0) throw ApiError.notFound("Elemento no encontrado.");
  res.json({ ok: true });
}));

/** Empty the whole trash (permanent) for a resource type or all. */
trashRouter.delete("/", asyncHandler(async (req, res) => {
  const { type } = req.query as { type?: string };
  const targets = type ? [mapModel(type)].filter(Boolean) : (["task", "event", "note", "project", "goal"] as const).map(mapModel).filter(Boolean);
  for (const m of targets) await m!.deleteMany({ where: softDeletedWhere(req.user!.id) });
  res.json({ ok: true });
}));

function mapModel(type: string): any {
  switch (type) {
    case "task": return prisma.task;
    case "event": return prisma.event;
    case "note": return prisma.note;
    case "project": return prisma.project;
    case "goal": return prisma.goal;
    default: return null;
  }
}