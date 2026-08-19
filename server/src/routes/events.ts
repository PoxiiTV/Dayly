import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import { auditMiddleware } from "../middleware/audit.js";
import * as schemas from "../validation/schemas.js";
import { applyRecurrence } from "../lib/recurrenceApply.js";

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const eventInclude = {
  tags: true,
  project: { select: { id: true, name: true, color: true } },
  recurrence: true,
  reminders: { select: { id: true, remindAt: true, title: true } },
};

// ---------- List / range ----------
eventsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, projectId } = req.query as Record<string, string | undefined>;
    const userId = req.user!.id;
    const anyWhere: Prisma.EventWhereInput = { userId, deletedAt: null };
    if (from && to) {
      anyWhere.OR = [
        { recurrenceId: null, startAt: { lte: new Date(to) }, endAt: { gte: new Date(from) } },
        { recurrenceId: { not: null } },
      ];
    } else {
      anyWhere.endAt = { gte: new Date(from ?? "1970-01-01") };
    }
    if (projectId) anyWhere.projectId = projectId;

    const eventsRaw = await prisma.event.findMany({
      where: anyWhere,
      include: eventInclude,
      orderBy: [{ startAt: "asc" }],
      take: 400,
    });
    if (from && to) {
      const { occurrenceStarts } = await import("../lib/recurrence.js");
      const fromD = new Date(from);
      const toD = new Date(to);
      const expanded = [];
      for (const e of eventsRaw) {
        if (!e.recurrence) { expanded.push({ ...e, instanceKey: e.id }); continue; }
        const dur = e.endAt.getTime() - e.startAt.getTime();
        for (const start of occurrenceStarts(e.startAt, e.recurrence, fromD, toD)) {
          expanded.push({ ...e, startAt: start, endAt: new Date(start.getTime() + dur), instanceKey: `${e.id}:${start.toISOString()}` });
        }
      }
      res.json({ events: expanded });
      return;
    }
    res.json({ events: eventsRaw });
  }),
);

// ---------- Create ----------
eventsRouter.post(
  "/",
  validate(schemas.createEventSchema),
  auditMiddleware("event.create", () => ({ entityType: "event" })),
  asyncHandler(async (req, res) => {
    const b = req.body as unknown as z.infer<typeof schemas.createEventSchema>;
    const userId = req.user!.id;
    if (new Date(b.endAt) <= new Date(b.startAt)) throw ApiError.badRequest("La hora final debe ser posterior a la inicial.");
    const data: Prisma.EventCreateInput = {
      title: b.title,
      description: b.description ?? null,
      startAt: new Date(b.startAt),
      endAt: new Date(b.endAt),
      allDay: b.allDay ?? false,
      location: b.location ?? null,
      category: b.category ?? null,
      color: b.color ?? null,
      priority: b.priority,
      url: b.url ?? null,
      status: b.status,
      user: { connect: { id: userId } },
    };
    if (b.projectId) {
      const p = await prisma.project.findFirst({ where: { id: b.projectId, userId } });
      if (!p) throw ApiError.badRequest("Proyecto no válido.");
      data.project = { connect: { id: p.id } };
    }
    if (b.tagIds?.length) {
      const c = await prisma.tag.count({ where: { id: { in: b.tagIds }, userId } });
      if (c !== b.tagIds.length) throw ApiError.badRequest("Etiqueta no válida.");
      data.tags = { connect: b.tagIds.map((id) => ({ id })) };
    }
    if (b.recurrence) {
      const recId = await applyRecurrence(userId, b.recurrence, null);
      if (recId) data.recurrence = { connect: { id: recId } };
    }

    const event = await prisma.event.create({ data, include: eventInclude });

    if (b.reminderMin != null) {
      const remindAt = new Date(event.startAt.getTime() - b.reminderMin * 60 * 1000);
      await prisma.reminder.create({
        data: { userId, title: event.title, remindAt, targetType: "EVENT", targetId: event.id },
      });
    }
    res.status(201).json({ event });
  }),
);

// ---------- Update ----------
eventsRouter.patch(
  "/:id",
  validate(schemas.updateEventSchema),
  auditMiddleware("event.update", (req) => ({ entityType: "event", entityId: req.params.id })),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    const b = req.body as unknown as z.infer<typeof schemas.updateEventSchema>;
    const userId = req.user!.id;
    const data: Prisma.EventUpdateInput = {};
    for (const k of ["title", "description", "allDay", "location", "category", "color", "priority", "url", "status"] as const) {
      if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
    }
    if (b.startAt !== undefined) data.startAt = new Date(b.startAt);
    if (b.endAt !== undefined) data.endAt = new Date(b.endAt);
    if (b.projectId !== undefined) {
      if (b.projectId) {
        const p = await prisma.project.findFirst({ where: { id: b.projectId, userId } });
        if (!p) throw ApiError.badRequest("Proyecto no válido.");
        data.project = { connect: { id: p.id } };
      } else data.project = { disconnect: true };
    }
    if (b.tagIds !== undefined) data.tags = { set: b.tagIds.map((id) => ({ id })) };
    if (b.recurrence !== undefined) {
      const current = await prisma.event.findUnique({ where: { id: req.params.id }, select: { recurrenceId: true } });
      const recId = await applyRecurrence(userId, b.recurrence ?? null, current?.recurrenceId);
      data.recurrence = recId ? { connect: { id: recId } } : { disconnect: true };
    }

    const event = await prisma.event.update({ where: { id: req.params.id }, data, include: eventInclude });
    res.json({ event });
  }),
);

// ---------- Drag & drop / resize: move times ----------
eventsRouter.patch(
  "/:id/move",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    const { startAt, endAt } = req.body as { startAt: string; endAt: string };
    if (!startAt || !endAt) throw ApiError.badRequest("Fecha no válida.");
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: { startAt: new Date(startAt), endAt: new Date(endAt), allDay: false },
      include: eventInclude,
    });
    res.json({ event });
  }),
);

// ---------- Delete / trash ----------
eventsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    await prisma.event.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

eventsRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    await prisma.event.update({ where: { id: req.params.id }, data: { deletedAt: null } });
    res.json({ ok: true });
  }),
);

eventsRouter.delete(
  "/:id/permanent",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    await prisma.event.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

// ---------- Convert event -> task ----------
eventsRouter.post(
  "/:id/to-task",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.event as never, req.params.id);
    const e = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id } });
    const task = await prisma.task.create({
      data: { userId: req.user!.id, title: e.title, description: e.description, dueDate: e.startAt, hasTime: true, color: e.color, projectId: e.projectId },
    });
    res.status(201).json({ task });
  }),
);