import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export const statsRouter = Router();
statsRouter.use(requireAuth);

/** Aggregate productivity metrics over a window. */
async function productivity(userId: string, since: Date) {
  const [completed, created, overdue, completedProjectCount, timeSum, habits] = await Promise.all([
    prisma.task.count({ where: { userId, deletedAt: null, status: "COMPLETED", completedAt: { gte: since } } }),
    prisma.task.count({ where: { userId, deletedAt: null, createdAt: { gte: since } } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: { not: "COMPLETED" }, dueDate: { lt: new Date() } } }),
    prisma.project.count({ where: { userId, deletedAt: null, status: "COMPLETED" } }),
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: since } }, _sum: { durationSec: true } }),
    prisma.habitLog.count({ where: { userId, done: true, date: { gte: since } } }),
  ]);
  return {
    completed, created, overdue,
    completionRate: created ? Math.round((completed / Math.max(created, 1)) * 100) : 0,
    completedProjects: completedProjectCount,
    timeSeconds: timeSum._sum.durationSec ?? 0,
    habitCompletions: habits,
  };
}

statsRouter.get("/", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const startDay = new Date(now); startDay.setHours(0, 0, 0, 0);
  const startWeek = new Date(startDay); startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today, week, month, categoryDist, priorityDist, projectDist, recent] = await Promise.all([
    productivity(userId, startDay),
    productivity(userId, startWeek),
    productivity(userId, startMonth),
    prisma.task.groupBy({ by: ["priority"], where: { userId, deletedAt: null, status: { not: "COMPLETED" } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["priority"], where: { userId, deletedAt: null }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { userId, deletedAt: null, status: "COMPLETED" }, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ["projectId"], where: { userId }, _sum: { durationSec: true } }),
  ]);

  res.json({
    today, week, month,
    pendingByPriority: priorityDist,
    categoryDist,
    completedByProject: projectDist.map((p) => ({ projectId: p.projectId, count: p._count._all })),
    timeByProject: recent.map((p) => ({ projectId: p.projectId, seconds: p._sum.durationSec ?? 0 })),
  });
}));