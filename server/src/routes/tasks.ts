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
import { skipOccurrence } from "../lib/recurrenceSkip.js";
import { occurrenceStarts, skipAtsOf } from "../lib/recurrence.js";
import { zonedDayRange } from "../lib/mascot/time.js";
import { optionalRangeEnd, taskOverlapsUtcRange, taskOverdueWhere } from "../lib/dateRange.js";
import {
  absUploadPath,
  attachmentFileExists,
  purgeFiles,
  saveOwnedFiles,
  sendAttachmentHeaders,
} from "../lib/uploads.js";
import { acceptAttachmentFiles, postedFiles } from "../middleware/upload.js";
import { splitLongTaskTitle } from "../lib/taskTitle.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const attachmentMeta = {
  select: { id: true, filename: true, mimeType: true, sizeBytes: true },
  orderBy: { createdAt: "asc" as Prisma.SortOrder },
};

const taskInclude = {
  subtasks: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" as Prisma.SortOrder } },
  tags: true,
  project: { select: { id: true, name: true, color: true } },
  goals: { select: { id: true, title: true } },
  timeEntries: { where: { running: true }, select: { id: true, startedAt: true, note: true } },
  recurrence: true,
  attachments: attachmentMeta,
};

// ---------- List ----------
tasksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, projectId, priority, tagId, due, completed, q, includeCompleted } = req.query as Record<string, string | undefined>;
    const userId = req.user!.id;
    const whereAny: Prisma.TaskWhereInput = { userId, deletedAt: null };

    if (status) whereAny.status = status as TaskStatus;
    if (projectId) whereAny.projectId = projectId;
    if (priority) whereAny.priority = priority as never;
    if (tagId) whereAny.tags = { some: { id: tagId } };
    if (includeCompleted !== "true") whereAny.status = { not: "COMPLETED" } as never;
    if (q) whereAny.title = { contains: q };
    if (completed === "today") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      whereAny.completedAt = { gte: start, lt: end };
    }

    if (due === "today") {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      Object.assign(whereAny, taskOverlapsUtcRange(s, new Date(e.getTime() - 1)));
    } else if (due === "overdue") {
      Object.assign(whereAny, taskOverdueWhere(new Date()));
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
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const { start: s, end: e } = zonedDayRange(user.timezone, 0);
    const base: Prisma.TaskWhereInput = { userId, deletedAt: null, status: { not: "COMPLETED" } as never };

    const [overdue, today, upcoming, important, unscheduled, highLoad] = await Promise.all([
      prisma.task.count({ where: { ...base, ...taskOverdueWhere(now) } }),
      prisma.task.findMany({ where: { ...base, ...taskOverlapsUtcRange(s, new Date(e.getTime() - 1)) }, include: taskInclude, orderBy: [{ dueDate: "asc" }] }),
      prisma.task.findMany({ where: { ...base, dueDate: { gte: e } }, include: taskInclude, orderBy: [{ dueDate: "asc" }], take: 12 }),
      prisma.task.findMany({ where: { ...base, priority: { in: ["HIGH", "URGENT"] as never } }, include: taskInclude, orderBy: [{ priority: "desc" }], take: 10 }),
      prisma.task.count({ where: { ...base, dueDate: null } }),
      prisma.task.count({ where: { ...base, ...taskOverlapsUtcRange(s, new Date(e.getTime() - 1)) } }),
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
    const text = splitLongTaskTitle(b.title, b.description);
    const data: Prisma.TaskCreateInput = {
      title: text.title,
      description: text.description,
      hasTime: b.hasTime ?? false,
      priority: b.priority,
      notifyTelegram: b.notifyTelegram ?? false,
      status: b.status,
      color: b.color ?? null,
      cardFill: b.cardFill ?? null,
      estimateMinutes: b.estimateMinutes ?? null,
      notes: b.notes ?? null,
      dueDate: b.dueDate ? new Date(b.dueDate) : null,
      dueEndDate: optionalRangeEnd(b.dueDate ? new Date(b.dueDate) : null, b.dueEndDate ? new Date(b.dueEndDate) : null),
      user: { connect: { id: userId } },
    };
    if (b.projectId) {
      await assertProjectOwned(userId, b.projectId);
      data.project = { connect: { id: b.projectId } };
    }
    const orderScope: Prisma.TaskWhereInput = { userId, deletedAt: null, projectId: b.projectId ?? null };
    const maxOrder = await prisma.task.aggregate({ where: orderScope, _max: { sortOrder: true } });
    data.sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
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

// ---------- Manual board order ----------
const boardOrderSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(191)).min(1).max(2000),
  /** Explicit positions (same length as `ids`) for a reorder inside a filtered view. */
  positions: z.array(z.number().int().min(0).max(1_000_000)).max(2000).optional(),
}).refine((b) => !b.positions || b.positions.length === b.ids.length, { message: "Posiciones no válidas", path: ["positions"] })
  .refine((b) => new Set(b.ids).size === b.ids.length, { message: "Tareas repetidas", path: ["ids"] });

/** Saves the order the user dragged on the board: position = index in `ids`, or `positions`. */
tasksRouter.put(
  "/board-order",
  validate(boardOrderSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { ids, positions } = (req as unknown as { validatedBody: z.infer<typeof boardOrderSchema> }).validatedBody;
    const owned = await prisma.task.count({ where: { id: { in: ids }, userId, deletedAt: null } });
    if (owned !== ids.length) throw ApiError.notFound("Tarea no encontrada.");
    await prisma.$transaction(ids.map((id, index) => prisma.task.update({ where: { id }, data: { boardOrder: positions?.[index] ?? index } })));
    res.json({ ok: true });
  }),
);

/** Back to the automatic order (priority and date). */
tasksRouter.delete(
  "/board-order",
  asyncHandler(async (req, res) => {
    await prisma.task.updateMany({ where: { userId: req.user!.id, boardOrder: { not: null } }, data: { boardOrder: null } });
    res.json({ ok: true });
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
    for (const k of ["title", "description", "hasTime", "priority", "notifyTelegram", "color", "cardFill", "estimateMinutes", "notes", "sortOrder"] as const) {
      if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
    }
    if (b.dueDate !== undefined) data.dueDate = b.dueDate && b.dueDate !== "" ? new Date(b.dueDate) : null;
    if (b.dueEndDate !== undefined) {
      const start = b.dueDate !== undefined
        ? (b.dueDate && b.dueDate !== "" ? new Date(b.dueDate) : null)
        : undefined;
      const end = b.dueEndDate && b.dueEndDate !== "" ? new Date(b.dueEndDate) : null;
      if (start === undefined) {
        const current = await prisma.task.findUnique({ where: { id: req.params.id }, select: { dueDate: true } });
        data.dueEndDate = optionalRangeEnd(current?.dueDate ?? null, end);
      } else {
        data.dueEndDate = optionalRangeEnd(start, end);
      }
    }
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
    const shift = days ?? 1;
    const base = t.dueDate ? new Date(t.dueDate) : new Date();
    base.setDate(base.getDate() + shift);
    const nextEnd = t.dueEndDate ? new Date(t.dueEndDate) : null;
    if (nextEnd) nextEnd.setDate(nextEnd.getDate() + shift);
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { dueDate: base, dueEndDate: nextEnd, status: t.status === "COMPLETED" ? "PENDING" : "POSTPONED", statusChangedAt: new Date() },
      include: taskInclude,
    });
    res.json({ task });
  }),
);

/** Move only the current timed task start by the fixed quick-snooze interval. */
tasksRouter.post(
  "/:id/snooze",
  validate(schemas.snoozeTaskSchema),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const { minutes, occurrenceAt } = req.body as { minutes: 10; occurrenceAt?: string };
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
    });
    if (!task.dueDate || !task.hasTime) throw ApiError.badRequest("Solo se pueden posponer tareas con hora de inicio.");

    const occurrence = occurrenceAt ? new Date(occurrenceAt) : task.dueDate;
    if (Number.isNaN(occurrence.getTime())) throw ApiError.badRequest("La ocurrencia no es válida.");
    if (!task.recurrence && Math.abs(occurrence.getTime() - task.dueDate.getTime()) > 1000) {
      throw ApiError.badRequest("La ocurrencia ya no coincide con la tarea.");
    }
    if (task.recurrence) {
      const match = occurrenceStarts(
        task.dueDate,
        task.recurrence,
        new Date(occurrence.getTime() - 1000),
        new Date(occurrence.getTime() + 1000),
        skipAtsOf(task.recurrence),
      ).some((at) => Math.abs(at.getTime() - occurrence.getTime()) < 1000);
      if (!match) throw ApiError.badRequest("La ocurrencia ya no existe.");
      await prisma.taskAlertSnooze.upsert({
        where: { taskId_occurrenceAt: { taskId: task.id, occurrenceAt: occurrence } },
        create: { userId: req.user!.id, taskId: task.id, occurrenceAt: occurrence, snoozedUntil: new Date(occurrence.getTime() + minutes * 60_000) },
        update: { snoozedUntil: new Date(occurrence.getTime() + minutes * 60_000) },
      });
    } else {
      const shift = minutes * 60_000;
      const dueDate = new Date(task.dueDate.getTime() + shift);
      const dueEndDate = task.dueEndDate ? new Date(task.dueEndDate.getTime() + shift) : null;
      await prisma.task.update({ where: { id: task.id }, data: { dueDate, dueEndDate } });
    }

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
    res.json({ task: updated });
  }),
);

tasksRouter.post(
  "/:id/skip-occurrence",
  asyncHandler(async (req, res) => {
    const at = (req.body as { at?: string }).at;
    if (!at) throw ApiError.badRequest("Falta la fecha de la repetición.");
    await skipOccurrence(req.user!.id, "task", req.params.id, at);
    res.json({ ok: true });
  }),
);
tasksRouter.patch(
  "/:id/move",
  validate(schemas.moveTaskSchema),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const { dueDate, hasTime } = req.body as { dueDate: string | null; hasTime?: boolean };
    const current = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id }, select: { dueDate: true, dueEndDate: true, hasTime: true } });
    const nextDue = dueDate && dueDate !== "" ? new Date(dueDate) : null;
    let nextEnd: Date | null = null;
    if (nextDue && current.dueDate && current.dueEndDate) {
      nextEnd = new Date(nextDue.getTime() + (current.dueEndDate.getTime() - current.dueDate.getTime()));
    }
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { dueDate: nextDue, dueEndDate: nextEnd, hasTime: hasTime ?? current.hasTime },
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
    const endAt = t.dueEndDate && t.dueEndDate.getTime() > startAt.getTime()
      ? t.dueEndDate
      : new Date(startAt.getTime() + 60 * 60 * 1000);
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

// ---------- Attachments (files on disk; DB stores metadata only) ----------
tasksRouter.post(
  "/:id/attachments",
  acceptAttachmentFiles,
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.task as never, req.params.id);
    const attachments = await saveOwnedFiles({
      userId: req.user!.id,
      kind: "task",
      parentId: req.params.id,
      files: postedFiles(req),
    });
    res.status(201).json({ attachments });
  }),
);

tasksRouter.get(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.taskAttachment.findFirst({
      where: { id: req.params.attId, taskId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    const full = absUploadPath(att.storageKey);
    if (!attachmentFileExists(att.storageKey)) throw ApiError.notFound("Archivo no encontrado.");
    sendAttachmentHeaders(res, att);
    res.sendFile(full);
  }),
);

tasksRouter.delete(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.taskAttachment.findFirst({
      where: { id: req.params.attId, taskId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    await prisma.taskAttachment.delete({ where: { id: att.id } });
    await purgeFiles([att.storageKey]);
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
    const files = await prisma.taskAttachment.findMany({ where: { taskId: req.params.id }, select: { storageKey: true } });
    await prisma.task.delete({ where: { id: req.params.id } });
    await purgeFiles(files.map((f) => f.storageKey));
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
