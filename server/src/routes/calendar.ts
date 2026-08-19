import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";
import { occurrenceStarts, type RecurrenceInput } from "../lib/recurrence.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

function expandEvents<T extends { id: string; startAt: Date; endAt: Date; recurrence?: { frequency: string; interval: number; byDay?: unknown; byMonthDay?: number | null; count?: number | null; endDate?: Date | null } | null }>(
  events: T[],
  fromD: Date,
  toD: Date,
) {
  const out: Array<T & { instanceKey: string }> = [];
  for (const e of events) {
    if (!e.recurrence) {
      if (e.endAt >= fromD && e.startAt <= toD) out.push({ ...e, instanceKey: e.id });
      continue;
    }
    const dur = Math.max(0, e.endAt.getTime() - e.startAt.getTime());
    for (const start of occurrenceStarts(e.startAt, e.recurrence as RecurrenceInput, fromD, toD)) {
      out.push({ ...e, startAt: start, endAt: new Date(start.getTime() + dur), instanceKey: `${e.id}:${start.toISOString()}` });
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function expandTasks<T extends { id: string; dueDate: Date | null; recurrence?: { frequency: string; interval: number; byDay?: unknown; byMonthDay?: number | null; count?: number | null; endDate?: Date | null } | null }>(
  tasks: T[],
  fromD: Date,
  toD: Date,
) {
  const out: Array<T & { instanceKey: string }> = [];
  for (const t of tasks) {
    if (!t.dueDate) continue;
    if (!t.recurrence) {
      if (t.dueDate >= fromD && t.dueDate <= toD) out.push({ ...t, instanceKey: t.id });
      continue;
    }
    for (const due of occurrenceStarts(t.dueDate, t.recurrence as RecurrenceInput, fromD, toD)) {
      out.push({ ...t, dueDate: due, instanceKey: `${t.id}:${due.toISOString()}` });
    }
  }
  return out.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
}

/** Combined events + scheduled tasks for a date range (calendar feeds). */
calendarRouter.get("/", validate(schemas.calendarRangeSchema, "query"), asyncHandler(async (req, res) => {
  const { from, to } = req.query as { from: string; to: string };
  const fromD = new Date(from); fromD.setHours(0, 0, 0, 0);
  const toD = new Date(to); toD.setHours(23, 59, 59, 999);
  const userId = req.user!.id;

  const [eventsRaw, tasksRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, endAt: { gte: fromD }, startAt: { lte: toD } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { tags: true, recurrence: true, project: { select: { id: true, name: true, color: true } } },
      orderBy: { startAt: "asc" },
      take: 400,
    }),
    prisma.task.findMany({
      where: {
        userId, deletedAt: null, status: { not: "COMPLETED" },
        OR: [
          { recurrenceId: null, dueDate: { gte: fromD, lte: toD } },
          { recurrenceId: { not: null }, dueDate: { not: null } },
        ],
      },
      include: { tags: true, recurrence: true, project: { select: { id: true, name: true, color: true } } },
      orderBy: { dueDate: "asc" },
      take: 400,
    }),
  ]);

  res.json({ events: expandEvents(eventsRaw, fromD, toD), tasks: expandTasks(tasksRaw, fromD, toD) });
}));

/** Day overview: what to do "now", "next", done, overdue (productivity control center). */
calendarRouter.get("/my-day", asyncHandler(async (req, res) => {
  const { date } = req.query as { date?: string };
  const base = date ? new Date(date) : new Date();
  const start = new Date(base); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const now = new Date();
  const userId = req.user!.id;

  const [eventsRaw, tasksRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, startAt: { gte: start, lt: end } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: true },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { not: "CANCELLED" } },
      include: { recurrence: true },
    }),
  ]);
  const events = expandEvents(eventsRaw, start, new Date(end.getTime() - 1));
  const dayTasks = expandTasks(
    tasksRaw.filter((t) => t.status !== "COMPLETED" || (t.dueDate && t.dueDate >= start && t.dueDate < end)),
    start,
    new Date(end.getTime() - 1),
  );
  const tasksForLists = await prisma.task.findMany({
    where: { userId, deletedAt: null, dueDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    orderBy: { dueDate: "asc" },
  });

  type Item = { id: string; title: string; kind: "event" | "task"; at: Date; end?: Date; color?: string | null };
  const eItems: Item[] = events.map((e) => ({ id: e.id, title: e.title, kind: "event" as const, at: e.startAt, end: e.endAt, color: e.color }));
  const tItems: Item[] = dayTasks.map((t) => ({ id: t.id, title: t.title, kind: "task" as const, at: t.dueDate ?? start, color: t.color }));
  const all = [...eItems, ...tItems];

  const nowItems = all.filter((i) => now >= i.at && (!i.end || now <= i.end) && (i.kind === "task" ? (tasksForLists.find((t) => t.id === i.id)?.status !== "COMPLETED") : true));
  const next = all.filter((i) => i.at > now).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 8);
  const done = tasksForLists.filter((t) => t.status === "COMPLETED");
  const overdue = tasksForLists.filter((t) => t.status !== "COMPLETED" && t.dueDate && t.dueDate < now);

  const total = tasksForLists.length;
  const progress = total ? Math.round((done.length / total) * 100) : 0;

  res.json({
    date: start.toISOString(), now: nowItems, next,
    done, overdue, progress, counts: { total, done: done.length, overdue: overdue.length },
  });
}));

/** Dashboard summary. */
calendarRouter.get("/dashboard", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const now = new Date();

  const [pending, completed, overdue, activeProjects, goals, eventsRaw, tasks, habitsToday, timeToday] = await Promise.all([
    prisma.task.count({ where: { userId, deletedAt: null, status: { not: "COMPLETED" } } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: "COMPLETED", completedAt: { gte: start } } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: { not: "COMPLETED" }, dueDate: { lt: now } } }),
    prisma.project.count({ where: { userId, deletedAt: null, status: { in: ["ACTIVE", "PLANNING"] } } }),
    prisma.goal.count({ where: { userId, deletedAt: null, status: { not: "COMPLETED" } } }),
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, startAt: { gte: start, lt: end } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.task.findMany({ where: { userId, deletedAt: null, dueDate: { gte: start, lt: end }, status: { not: "COMPLETED" } }, orderBy: { dueDate: "asc" }, take: 10 }),
    prisma.habitLog.count({ where: { userId, done: true, date: { gte: start } } }),
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: start } }, _sum: { durationSec: true } }),
  ]);

  const events = expandEvents(eventsRaw, start, new Date(end.getTime() - 1));

  res.json({
    pending, completed, overdue, activeProjects, activeGoals: goals,
    events, todaysTasks: tasks,
    habitCompletionsToday: habitsToday,
    timeTodaySeconds: timeToday._sum.durationSec ?? 0,
    startOfDay: start.toISOString(),
  });
}));
