import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";

export const searchRouter = Router();
searchRouter.use(requireAuth);

const searchAny = (userId: string, q: string, type?: string) => async () => {
  const like = { contains: q };
  const results: Record<string, unknown> = {};
  const limit = 8;

  if (!type || type === "task" || type === "all")
    results.tasks = await prisma.task.findMany({ where: { userId, deletedAt: null, title: like }, select: { id: true, title: true, status: true, priority: true, dueDate: true, color: true }, take: limit });
  if (!type || type === "event" || type === "all")
    results.events = await prisma.event.findMany({ where: { userId, deletedAt: null, title: like }, select: { id: true, title: true, startAt: true, endAt: true, color: true }, take: limit });
  if (!type || type === "note" || type === "all")
    results.notes = await prisma.note.findMany({ where: { userId, deletedAt: null, OR: [{ title: like }, { content: { contains: q } }] }, select: { id: true, title: true, color: true, pinned: true }, take: limit });
  if (!type || type === "project" || type === "all")
    results.projects = await prisma.project.findMany({ where: { userId, deletedAt: null, name: like }, select: { id: true, name: true, color: true }, take: limit });
  if (!type || type === "goal" || type === "all")
    results.goals = await prisma.goal.findMany({ where: { userId, deletedAt: null, title: like }, select: { id: true, title: true }, take: limit });
  if (!type || type === "habit" || type === "all")
    results.habits = await prisma.habit.findMany({ where: { userId, name: like }, select: { id: true, name: true, color: true }, take: limit });
  return results;
};

searchRouter.get("/", validate(schemas.searchSchema, "query"), asyncHandler(async (req, res) => {
  const { q, type } = req.query as { q: string; type?: string };
  const results = await searchAny(req.user!.id, q, type)();
  res.json(results);
}));