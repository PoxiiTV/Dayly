import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

const goalInclude = { tags: true, project: { select: { id: true, name: true, color: true } }, tasks: { select: { id: true, title: true, status: true }, where: { deletedAt: null } } };

function computeProgress(g: { tasks: { status: string }[]; manualProgress: number; status: string }) {
  if (g.manualProgress >= 0) return g.manualProgress;
  if (g.status === "COMPLETED") return 100;
  const total = g.tasks.length;
  if (!total) return 0;
  return Math.round((g.tasks.filter((t) => t.status === "COMPLETED").length / total) * 100);
}

goalsRouter.get("/", asyncHandler(async (req, res) => {
  const goals = await prisma.goal.findMany({ where: { userId: req.user!.id, deletedAt: null }, include: goalInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] });
  res.json({ goals: goals.map((g) => ({ ...g, progress: computeProgress(g) })) });
}));

goalsRouter.post("/", validate(schemas.createGoalSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.createGoalSchema>;
  const data: Prisma.GoalCreateInput = {
    title: b.title, description: b.description ?? null, dueDate: b.dueDate ? new Date(b.dueDate) : null,
    manualProgress: b.manualProgress ?? -1, status: b.status, user: { connect: { id: req.user!.id } },
  };
  if (b.projectId) { const p = await prisma.project.findFirst({ where: { id: b.projectId, userId: req.user!.id } }); if (!p) throw ApiError.badRequest("Proyecto no válido."); data.project = { connect: { id: p.id } }; }
  if (b.tagIds?.length) data.tags = { connect: b.tagIds.map((id) => ({ id })) };
  if (b.taskIds?.length) data.tasks = { connect: b.taskIds.map((id) => ({ id })) };
  const goal = await prisma.goal.create({ data, include: goalInclude });
  res.status(201).json({ goal: { ...goal, progress: computeProgress(goal) } });
}));

goalsRouter.patch("/:id", validate(schemas.updateGoalSchema), asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.goal as never, req.params.id);
  const b = req.body as unknown as z.infer<typeof schemas.updateGoalSchema>;
  const data: Prisma.GoalUpdateInput = {};
  for (const k of ["title", "description", "manualProgress", "status"] as const) if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
  if (b.dueDate !== undefined) data.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (b.projectId !== undefined) data.project = b.projectId ? { connect: { id: b.projectId } } : { disconnect: true };
  if (b.tagIds !== undefined) data.tags = { set: b.tagIds.map((id) => ({ id })) };
  if (b.taskIds !== undefined) data.tasks = { set: b.taskIds.map((id) => ({ id })) };
  const goal = await prisma.goal.update({ where: { id: req.params.id }, data, include: goalInclude });
  res.json({ goal: { ...goal, progress: computeProgress(goal) } });
}));

goalsRouter.delete("/:id", asyncHandler(async (req, res) => { await assertOwned(req, prisma.goal as never, req.params.id); await prisma.goal.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } }); res.json({ ok: true }); }));
goalsRouter.post("/:id/restore", asyncHandler(async (req, res) => { await assertOwned(req, prisma.goal as never, req.params.id); await prisma.goal.update({ where: { id: req.params.id }, data: { deletedAt: null } }); res.json({ ok: true }); }));
goalsRouter.delete("/:id/permanent", asyncHandler(async (req, res) => { await assertOwned(req, prisma.goal as never, req.params.id); await prisma.goal.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));