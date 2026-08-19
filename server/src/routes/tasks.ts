import { Router } from "express";
import { Prisma, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import { auditMiddleware } from "../middleware/audit.js";
import * as schemas from "../validation/schemas.js";
import { applyRecurrence } from "../lib/recurrenceApply.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const taskInclude = {
  subtasks: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" as Prisma.SortOrder } },
  tags: true,
  project: { select: { id: true, name: true, color: true } },
  goals: { select: { id: true, title: true } },
  timeEntries: { where: { running: true }, select: { id: true, startedAt: true, note: true } },
  recurrence: true,
};

// ---------- List ----------
tasksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, projectId, priority, tagId, due, q, includeCompleted } = req.query as Record<string, string | undefined>;
    const userId = req.user!.id;
    const whereAny: Prisma.TaskWhereInput = { userId, deletedAt: null };

    if (status) whereAny.status = status as TaskStatus;
    if (projectId) whereAny.projectId = projectId;
    if (priority) whereAny.priority = priority as never;
    if (tagId) whereAny.tags = { some: { id: tagId } };
    if (includeCompleted !== "true") whereAny.status = { not: "COMPLETED" } as never;
    if (q) whereAny.title = { contains: q };

    if (due === "today") {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      whereAny.dueDate = { gte: s, lt: e };
    } else if (due === "overdue") {
      whereAny.dueDate = { lt: new Date() };
      whereAny.status = { not: "COMPLETED" } as never;
    } else if (due === "nominal") {
      whereAny.dueDate = null;
    } else if (due === "upcoming") {
      whereAny.dueDate = { gte: new Date() };
    }

    const tasks = await prisma.task.findMany({
      where: whereAny,
      include: taskInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });
    res.json({ tasks });
  }),
);

// ---------- Smart vectors ----------
tasksRouter.get(
  "/smart",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const now = new Date();
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    const base: Prisma.TaskWhereInput = { userId, deletedAt: null, status: { not: "COMPLETED" } as never };

    const [overdue, today, upcoming, important, unscheduled, highLoad] = await Promise.all([
      prisma.task.count({ where: { ...base, dueDate: { lt: now } } }),
      prisma.task.findMany({ where: { ...base, dueDate: { gte: s, lt: e } }, include: taskInclude, orderBy: [{ dueDate: "asc" }] }),
      prisma.task.findMany({ where: { ...base, dueDate: { gte: e } }, include: taskInclude, orderBy: [{ dueDate: "asc" }], take: 12 }),
      prisma.task.findMany({ where: { ...base, priority: { in: ["HIGH", "URGENT"] as never } }, include: taskInclude, orderBy: [{ priority: "desc" }], take: 10 }),
      prisma.task.count({ where: { ...base, dueDate: null } }),
      prisma.task.count({ where: { ...base, dueDate: { gte: s, lt: e } } }),
    ]);
    res.json({ count: { overdue, unscheduled, today: highLoad }, today, upcoming, important });
  }),
);

// ---------- Create ----------
tasksRouter.post(
  "/",
  validate(schemas.createTaskSchema),
  auditMiddleware("task.create", (req) => ({ entityType: "task" })),
  asyncHandler(async (req, res) => {
    const b = req.body as unknown as z.infer<typeof schemas.createTaskSchema>;
    const userId = req.user!.id;
    const data: Prisma.TaskCreateInput = {
      title: b.title,
      description: b.description ?? null,
      hasTime: b.hasTime ?? false,
      priority: b.priority,
      status: b.status,
      color: b.color ?? null,
      estimateMinutes: b.estimateMinutes ?? null,
      notes: b.notes ?? null,
      dueDate: b.dueDate ? new Date(b.dueDate) : null,
      user: { connect: { id: userId } },
    };
    if (b.projectId) {
      await assertProjectOwned(userId, b.projectId);
      data.project = { connect: { id: b.projectId } };
    }
    if (b.tagIds?.length) data.tags = { connect: b.tagIds.map((id) => ({ id })) };
    if (b.goalIds?.length) data.goals = { connect: b.goalIds.map((id) => ({ id })) };
    if (b.subtasks?.length) {
      data.subtasks = { create: b.subtasks.map((srt, i) => ({ title: srt.title, userId, sortOrder: i })) };
    }
    if (b.recurrence) {
      const recId = await applyRecurrence(userId, b.recurrence, null);
      if (recId) data.recurrence = { connect: { id: recId } };
    }
    const task = await prisma.task.create({ data, include: taskInclude });
    if (b.reminder) {
      await prisma.reminder.create({
        data: {
          userId, title: b.reminder.title ?? b.title, remindAt: new Date(b.reminder.remindAt),
          scheduleDaily: b.reminder.scheduleDaily ?? false, targetType: "TASK", targetId: task.id,
        },
      });
    }
    res.status(201).json({ task });
  }),
);

// ---------- Get one ----------
tasksRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.user!.id, deletedAt: null }, include: taskInclude });
    if (!task) throw ApiError.notFound("Tarea no encontrada.");
    res.json({ task });
  }),
);

// ---------- Update ----------
tasksRouter.patch(
  "/:id",
  validate(schemas.updateTaskSchema),
  auditMiddleware("task.update", (req) => ({ entityType: "task", entityId: req.params.id })),
  asyncHandler(async (req, res) => {
    const b = req.body as unknown as z.infer<typeof schemas.updateTaskSchema>;
    await assertOwned(req, prisma.task as never, req.params.id);
    const userId = req.user!.id;
    const data: Prisma.TaskUpdateInput = {};
    for (const k of ["title", "description", "hasTime", "priority", "color", "estimateMinutes", "notes"] as const) {
      if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
    }
    if (b.dueDate !== undefined) data.dueDate = b.dueDate && b.dueDate !== "" ? new Date(b.dueDate) : null;
    if (b.status !== undefined) {
      data.status = b.status;
      if (b.status === "COMPLETED") { data.completedAt = new Date(); data.statusChangedAt = new Date(); }
      else if (b.status === "PENDING") { data.completedAt = null; data.statusChangedAt = new Date(); }
    }
    if (b.projectId !== undefined) {
      data.project = b.projectId ? { connect: { id: b.projectId } } : { disconnect: true };
      if (b.projectId) await assertProjectOwned(userId, b.projectId);
    }
    if (b.tagIds !== undefined) {
      await assertTagsOwned(userId, b.tagIds);
      data.tags = { set: b.tagIds.map((id) => ({ id })) };
    }
    if (b.goalIds !== undefined) data.goals = { set: b.goalIds.map((id) => ({ id })) };
    if (b.recurrence !== undefined) {
      const current = await prisma.task.findUnique({ where: { id: req.params.id }, select: { recurrenceId: true } });
      const recId = await applyRecurrence(userId, b.recurrence ?? null, current?.recurrenceId);
      data.recurrence = recId ? { connect: { id: recId } } : { disconnect: true };
    }

    const task = await prisma.task.update({ where: { id: req.params.id }, data, include: taskInclude });
    res.json({ task });
  }),
);

// ---------- Status quick actions ----------
tasksRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { status: "COMPLETED", completedAt: new Date(), statusChangedAt: new Date() },
      include: taskInclude,
    });
    res.json({ task });
  }),
);

tasksRouter.post(
  "/:id/postpone",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const { days } = req.body as { days?: number };
    const t = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id } });
    const base = t.dueDate ? new Date(t.dueDate) : new Date();
    base.setDate(base.getDate() + (days ?? 1));
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { dueDate: base, status: t.status === "COMPLETED" ? "PENDING" : "POSTPONED", statusChangedAt: new Date() },
      include: taskInclude,
    });
    res.json({ task });
  }),
);

// drag&drop / due-date change
tasksRouter.patch(
  "/:id/move",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const { dueDate } = req.body as { dueDate?: string | null };
    if (dueDate === undefined) throw ApiError.badRequest("Falta la fecha.");
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { dueDate: dueDate && dueDate !== "" ? new Date(dueDate) : null, hasTime: !!req.body?.hasTime },
      include: taskInclude,
    });
    res.json({ task });
  }),
);

// ---------- Convert task -> event ----------
tasksRouter.post(
  "/:id/to-event",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id } });
    const startAt = t.dueDate ?? new Date();
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const event = await prisma.event.create({
      data: {
        userId: req.user!.id,
        title: t.title,
        description: t.description,
        startAt,
        endAt,
        color: t.color,
        projectId: t.projectId,
      },
    });
    res.status(201).json({ event });
  }),
);

// ---------- Subtasks ----------
tasksRouter.post(
  "/:id/subtasks",
  validate(z.object({ title: z.string().trim().min(1).max(300) })),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const count = await prisma.subtask.count({ where: { taskId: req.params.id } });
    const sub = await prisma.subtask.create({
      data: { taskId: req.params.id, userId: req.user!.id, title: (req.body as { title: string }).title, sortOrder: count },
    });
    res.status(201).json({ subtask: sub });
  }),
);

tasksRouter.patch(
  "/subtasks/:subtaskId",
  asyncHandler(async (req, res) => {
    const sub = await prisma.subtask.findFirst({ where: { id: req.params.subtaskId, userId: req.user!.id, deletedAt: null } });
    if (!sub) throw ApiError.notFound("Subtarea no encontrada.");
    const { done, title } = req.body as { done?: boolean; title?: string };
    const updated = await prisma.subtask.update({
      where: { id: sub.id },
      data: { done: done ?? sub.done, title: title ?? sub.title },
    });
    res.json({ subtask: updated });
  }),
);

tasksRouter.delete(
  "/subtasks/:subtaskId",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.subtask as never, req.params.subtaskId);
    await prisma.subtask.update({ where: { id: req.params.subtaskId }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ---------- Trash (soft-delete / restore) ----------
tasksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    await prisma.task.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    await prisma.task.update({ where: { id: req.params.id }, data: { deletedAt: null } });
    res.json({ ok: true });
  }),
);

tasksRouter.delete(
  "/:id/permanent",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

// ---------- helpers ----------
async function assertProjectOwned(userId: string, projectId: string) {
  const p = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!p) throw ApiError.badRequest("Proyecto no válido.");
}
async function assertTagsOwned(userId: string, tagIds: string[]) {
  const count = await prisma.tag.count({ where: { id: { in: tagIds }, userId } });
  if (count !== tagIds.length) throw ApiError.badRequest("Una de las etiquetas no es válida.");
}