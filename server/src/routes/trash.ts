import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { purgeOwnedAttachments } from "../lib/uploads.js";
import { parseTrashType, TRASH_TYPES, type TrashType } from "../lib/attachment-policy.js";

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

trashRouter.post("/restore", asyncHandler(async (req, res) => {
  const type = parseTrashType((req.body as { type?: string }).type);
  const id = (req.body as { id?: string }).id;
  if (!type || !id) throw ApiError.badRequest("Tipo no válido.");
  const count = await restoreTrashed(type, req.user!.id, id);
  if (count === 0) throw ApiError.notFound("Elemento no encontrado en la papelera.");
  res.json({ ok: true });
}));

trashRouter.delete("/permanent", asyncHandler(async (req, res) => {
  const type = parseTrashType((req.body as { type?: string }).type);
  const id = (req.body as { id?: string }).id;
  if (!type || !id) throw ApiError.badRequest("Tipo no válido.");
  const userId = req.user!.id;
  if (type === "note" || type === "task") {
    await purgeOwnedAttachments({ userId, kind: type, parentIds: [id] });
  }
  const count = await hardDelete(type, userId, id);
  if (count === 0) throw ApiError.notFound("Elemento no encontrado.");
  res.json({ ok: true });
}));

trashRouter.delete("/", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const requested = parseTrashType(req.query.type as string | undefined);
  const types: TrashType[] = requested ? [requested] : [...TRASH_TYPES];
  if (types.includes("task") || types.includes("note")) {
    await purgeOwnedAttachments({
      userId,
      kind: types.includes("task") && types.includes("note") ? undefined : types.includes("task") ? "task" : "note",
      onlySoftDeleted: true,
    });
  }
  for (const type of types) {
    await emptyType(type, userId);
  }
  res.json({ ok: true });
}));

async function restoreTrashed(type: TrashType, userId: string, id: string): Promise<number> {
  const where = { id, userId, deletedAt: { not: null } };
  const data = { deletedAt: null };
  switch (type) {
    case "task": return (await prisma.task.updateMany({ where, data })).count;
    case "event": return (await prisma.event.updateMany({ where, data })).count;
    case "note": return (await prisma.note.updateMany({ where, data })).count;
    case "project": return (await prisma.project.updateMany({ where, data })).count;
    case "goal": return (await prisma.goal.updateMany({ where, data })).count;
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

async function hardDelete(type: TrashType, userId: string, id: string): Promise<number> {
  const where = { id, userId };
  switch (type) {
    case "task": return (await prisma.task.deleteMany({ where })).count;
    case "event": return (await prisma.event.deleteMany({ where })).count;
    case "note": return (await prisma.note.deleteMany({ where })).count;
    case "project": return (await prisma.project.deleteMany({ where })).count;
    case "goal": return (await prisma.goal.deleteMany({ where })).count;
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

async function emptyType(type: TrashType, userId: string): Promise<void> {
  const where = softDeletedWhere(userId);
  switch (type) {
    case "task": await prisma.task.deleteMany({ where }); return;
    case "event": await prisma.event.deleteMany({ where }); return;
    case "note": await prisma.note.deleteMany({ where }); return;
    case "project": await prisma.project.deleteMany({ where }); return;
    case "goal": await prisma.goal.deleteMany({ where }); return;
    default: {
      const _never: never = type;
      return _never;
    }
  }
}
