import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";
import { occurrenceStarts, skipAtsOf, type RecurrenceInput } from "../lib/recurrence.js";
import { addDaysYmd, localYmd, wallToUtc, zonedDayRange } from "../lib/mascot/time.js";
import { taskOverlapsUtcRange, taskOverdueWhere } from "../lib/dateRange.js";

export const calendarFeedRouter = Router();
export const calendarRouter = Router();
calendarRouter.use(requireAuth);

type RecWithSkip = {
  frequency: string;
  interval: number;
  byDay?: unknown;
  byMonthDay?: number | null;
  count?: number | null;
  endDate?: Date | null;
  exceptions?: { skipAt: Date }[];
} | null;

function expandEvents<T extends { id: string; startAt: Date; endAt: Date; recurrence?: RecWithSkip }>(
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
    for (const start of occurrenceStarts(e.startAt, e.recurrence as RecurrenceInput, fromD, toD, skipAtsOf(e.recurrence))) {
      out.push({ ...e, startAt: start, endAt: new Date(start.getTime() + dur), instanceKey: `${e.id}:${start.toISOString()}` });
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function expandTasks<T extends { id: string; dueDate: Date | null; dueEndDate?: Date | null; recurrence?: RecWithSkip }>(
  tasks: T[],
  fromD: Date,
  toD: Date,
) {
  const out: Array<T & { instanceKey: string }> = [];
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const span = t.dueEndDate ? Math.max(0, t.dueEndDate.getTime() - t.dueDate.getTime()) : 0;
    if (!t.recurrence) {
      const end = t.dueEndDate ?? t.dueDate;
      if (end >= fromD && t.dueDate <= toD) out.push({ ...t, instanceKey: t.id });
      continue;
    }
    for (const due of occurrenceStarts(t.dueDate, t.recurrence as RecurrenceInput, fromD, toD, skipAtsOf(t.recurrence))) {
      out.push({
        ...t,
        dueDate: due,
        dueEndDate: span ? new Date(due.getTime() + span) : t.dueEndDate ?? null,
        instanceKey: `${t.id}:${due.toISOString()}`,
      });
    }
  }
  return out.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
}

function dayRangeForDate(date: string | undefined, timezone: string): { start: Date; end: Date } {
  if (!date) return zonedDayRange(timezone, 0);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localYmd(timezone);
  return {
    start: wallToUtc(ymd, "00:00:00", timezone),
    end: wallToUtc(addDaysYmd(ymd, 1), "00:00:00", timezone),
  };
}

/** Combined events + scheduled tasks for a date range (calendar feeds). */
calendarRouter.get("/", validate(schemas.calendarRangeSchema, "query"), asyncHandler(async (req, res) => {
  const { from, to } = req.query as { from: string; to: string };
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  // ISO boundaries already describe the client's local-day interval. Never
  // round them in the server's timezone, which drops early/late appointments.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const fromD = dateOnly.test(from) ? wallToUtc(from, "00:00:00", user.timezone) : new Date(from);
  const toD = dateOnly.test(to) ? new Date(wallToUtc(addDaysYmd(to, 1), "00:00:00", user.timezone).getTime() - 1) : new Date(to);

  const [eventsRaw, tasksRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, endAt: { gte: fromD }, startAt: { lte: toD } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { tags: true, recurrence: { include: { exceptions: { select: { skipAt: true } } } }, project: { select: { id: true, name: true, color: true } } },
      orderBy: { startAt: "asc" },
      take: 400,
    }),
    prisma.task.findMany({
      where: {
        userId, deletedAt: null, status: { not: "COMPLETED" },
        OR: [
          { recurrenceId: null, ...taskOverlapsUtcRange(fromD, toD) },
          { recurrenceId: { not: null }, dueDate: { not: null } },
        ],
      },
      include: { tags: true, recurrence: { include: { exceptions: { select: { skipAt: true } } } }, project: { select: { id: true, name: true, color: true } } },
      orderBy: { dueDate: "asc" },
      take: 400,
    }),
  ]);

  res.json({ events: expandEvents(eventsRaw, fromD, toD), tasks: expandTasks(tasksRaw, fromD, toD) });
}));

/** Day overview: what to do "now", "next", done, overdue (productivity control center). */
calendarRouter.get("/my-day", asyncHandler(async (req, res) => {
  const { date } = req.query as { date?: string };
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const { start, end } = dayRangeForDate(date, user.timezone);
  const now = new Date();

  const [eventsRaw, tasksRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, endAt: { gte: start }, startAt: { lt: end } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { not: "CANCELLED" } },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
    }),
  ]);
  const events = expandEvents(eventsRaw, start, new Date(end.getTime() - 1));
  const dayTasks = expandTasks(
    tasksRaw.filter((t) => t.status !== "COMPLETED" || (t.dueDate && (
      (t.dueEndDate ?? t.dueDate) >= start && t.dueDate < end
    ))),
    start,
    new Date(end.getTime() - 1),
  );
  const tasksForLists = await prisma.task.findMany({
    where: { userId, deletedAt: null, status: { not: "CANCELLED" }, ...taskOverlapsUtcRange(start, new Date(end.getTime() - 1)) },
    orderBy: { dueDate: "asc" },
  });

  type Item = { id: string; title: string; kind: "event" | "task"; at: Date; end?: Date; color?: string | null; hasTime?: boolean };
  const eItems: Item[] = events.map((e) => ({ id: e.id, title: e.title, kind: "event" as const, at: e.startAt, end: e.endAt, color: e.color }));
  const tItems: Item[] = dayTasks.map((t) => ({ id: t.id, title: t.title, kind: "task" as const, at: t.dueDate ?? start, end: t.dueEndDate ?? undefined, color: t.color, hasTime: t.hasTime }));
  const all = [...eItems, ...tItems];
  const timeline = all
    .filter((item) => item.kind === "event" || item.hasTime)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const nowItems = all.filter((i) => now >= i.at && (!i.end || now <= i.end) && (i.kind === "task" ? (tasksForLists.find((t) => t.id === i.id)?.status !== "COMPLETED") : true));
  const next = all.filter((i) => i.at > now && (i.kind !== "task" || tasksForLists.find((t) => t.id === i.id)?.status !== "COMPLETED"))
    .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 8);
  const done = tasksForLists.filter((t) => t.status === "COMPLETED");
  const overdue = tasksForLists.filter((t) => {
    if (t.status === "COMPLETED") return false;
    const deadline = t.dueEndDate ?? t.dueDate;
    return !!deadline && deadline < now;
  });

  const total = tasksForLists.length;
  const progress = total ? Math.round((done.length / total) * 100) : 0;

  res.json({
    date: start.toISOString(), now: nowItems, next, timeline,
    done, overdue, progress, counts: { total, done: done.length, overdue: overdue.length },
  });
}));

/** Dashboard summary. */
calendarRouter.get("/dashboard", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const { start, end } = zonedDayRange(user.timezone, 0);
  const now = new Date();

  const [pending, completed, overdue, activeProjects, goals, eventsRaw, tasks, habitsToday, timeToday, todayTaskTotal, todayTaskDone] = await Promise.all([
    prisma.task.count({ where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: "COMPLETED", completedAt: { gte: start, lt: end } } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, ...taskOverdueWhere(now) } }),
    prisma.project.count({ where: { userId, deletedAt: null, status: { in: ["ACTIVE", "PLANNING"] } } }),
    prisma.goal.count({ where: { userId, deletedAt: null, status: { not: "COMPLETED" } } }),
    prisma.event.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          { recurrenceId: null, endAt: { gte: start }, startAt: { lt: end } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.task.findMany({ where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, ...taskOverlapsUtcRange(start, new Date(end.getTime() - 1)) }, orderBy: { dueDate: "asc" }, take: 10 }),
    prisma.habitLog.count({ where: { userId, done: true, date: { gte: start, lt: end } } }),
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: start, lt: end } }, _sum: { durationSec: true } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: { notIn: ["CANCELLED"] }, ...taskOverlapsUtcRange(start, new Date(end.getTime() - 1)) } }),
    prisma.task.count({ where: { userId, deletedAt: null, status: "COMPLETED", ...taskOverlapsUtcRange(start, new Date(end.getTime() - 1)) } }),
  ]);

  const events = expandEvents(eventsRaw, start, new Date(end.getTime() - 1));

  res.json({
    pending, completed, overdue, activeProjects, activeGoals: goals,
    events, todaysTasks: tasks,
    habitCompletionsToday: habitsToday,
    timeTodaySeconds: timeToday._sum.durationSec ?? 0,
    todayTaskTotal,
    todayTaskDone,
    startOfDay: start.toISOString(),
  });
}));

calendarRouter.get("/feed-url", asyncHandler(async (req, res) => {
  const { ensureFeedToken } = await import("../lib/calendarFeed.js");
  res.json(await ensureFeedToken(req.user!.id));
}));

calendarRouter.post("/feed-url", asyncHandler(async (req, res) => {
  const { rotateFeedToken } = await import("../lib/calendarFeed.js");
  res.json(await rotateFeedToken(req.user!.id));
}));

calendarFeedRouter.get("/feed/:token", asyncHandler(async (req, res) => {
  const { buildFeedIcs } = await import("../lib/calendarFeed.js");
  const token = String(req.params.token).replace(/\.ics$/i, "");
  const ics = await buildFeedIcs(token);
  if (!ics) {
    res.status(404).type("text/plain").send("Calendario no encontrado.");
    return;
  }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", "inline; filename=\"kalendiario.ics\"");
  res.setHeader("Cache-Control", "no-store");
  res.send(ics);
}));
