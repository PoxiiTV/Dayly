import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";

export const timeRouter = Router();
timeRouter.use(requireAuth);

// Active timer for the user.
timeRouter.get("/running", asyncHandler(async (req, res) => {
  const entries = await prisma.timeEntry.findMany({ where: { userId: req.user!.id, running: true }, include: { task: { select: { id: true, title: true } } } });
  res.json({ entries });
}));

// Daily / weekly / by-project stats.
timeRouter.get("/stats", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const [today, week, byProject, byTask] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: startOfToday } }, _sum: { durationSec: true } }),
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: startOfWeek } }, _sum: { durationSec: true } }),
    prisma.timeEntry.groupBy({ by: ["projectId"], where: { userId, projectId: { not: null } }, _sum: { durationSec: true } }),
    prisma.timeEntry.groupBy({ by: ["taskId"], where: { userId, taskId: { not: null } }, _sum: { durationSec: true } }),
  ]);

  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: byProject.map((x) => x.projectId as string) }, userId } }),
    prisma.task.findMany({ where: { id: { in: byTask.map((x) => x.taskId as string) }, userId } }),
  ]);

  res.json({
    todaySeconds: today._sum.durationSec ?? 0,
    weekSeconds: week._sum.durationSec ?? 0,
    byProject: byProject.map((x) => ({ id: x.projectId, seconds: x._sum.durationSec ?? 0, name: projects.find((p) => p.id === x.projectId)?.name })),
    byTask: byTask.map((x) => ({ id: x.taskId, seconds: x._sum.durationSec ?? 0, name: tasks.find((t) => t.id === x.taskId)?.title })),
  });
}));

// Start a timer.
timeRouter.post("/start", validate(schemas.startTimeSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.startTimeSchema>;
  // Stop any running first to avoid overlaps.
  await prisma.timeEntry.updateMany({ where: { userId: req.user!.id, running: true }, data: { running: false, endedAt: new Date() } });
  if (b.taskId) { const t = await prisma.task.findFirst({ where: { id: b.taskId, userId: req.user!.id } }); if (!t) throw ApiError.badRequest("Tarea no válida."); }
  const entry = await prisma.timeEntry.create({ data: { userId: req.user!.id, taskId: b.taskId ?? null, projectId: b.projectId ?? null, startedAt: new Date(), running: true, source: b.source ?? "MANUAL", note: b.note ?? null } });
  res.status(201).json({ entry });
}));

// Stop a timer (by id or the running one).
timeRouter.post("/:id?/stop", asyncHandler(async (req, res) => {
  const id = req.params.id;
  const entry = id
    ? await prisma.timeEntry.findFirst({ where: { id, userId: req.user!.id, running: true } })
    : await prisma.timeEntry.findFirst({ where: { userId: req.user!.id, running: true }, orderBy: { startedAt: "desc" } });
  if (!entry) throw ApiError.notFound("No hay temporizador en curso.");
  const endedAt = new Date();
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - entry.startedAt.getTime()) / 1000));
  const updated = await prisma.timeEntry.update({ where: { id: entry.id }, data: { running: false, endedAt, durationSec } });
  if (entry.taskId) {
    await prisma.task.update({ where: { id: entry.taskId }, data: { timeSpentMinutes: { increment: Math.ceil(durationSec / 60) } } });
  }
  res.json({ entry: updated });
}));

// Manual entry.
timeRouter.post("/manual", validate(schemas.startTimeSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.startTimeSchema>;
  const minutes = Number(req.body?.minutes ?? 0);
  if (!b.taskId || minutes <= 0) throw ApiError.badRequest("Indica una tarea y los minutos.");
  const t = await prisma.task.findFirst({ where: { id: b.taskId, userId: req.user!.id } });
  if (!t) throw ApiError.badRequest("Tarea no válida.");
  const entry = await prisma.timeEntry.create({ data: { userId: req.user!.id, taskId: t.id, startedAt: new Date(Date.now() - minutes * 60000), endedAt: new Date(), durationSec: minutes * 60, running: false, source: "MANUAL" } });
  await prisma.task.update({ where: { id: t.id }, data: { timeSpentMinutes: { increment: minutes } } });
  res.status(201).json({ entry });
}));

timeRouter.get("/", asyncHandler(async (req, res) => {
  const entries = await prisma.timeEntry.findMany({ where: { userId: req.user!.id }, orderBy: { startedAt: "desc" }, take: 100, include: { task: { select: { id: true, title: true } } } });
  res.json({ entries });
}));