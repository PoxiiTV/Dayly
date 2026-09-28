import { prisma } from "./prisma.js";
import { randomToken } from "./crypto.js";
import { serializeIcs, type TransferBundle } from "./transfer.js";
import { occurrenceStarts, skipAtsOf, type RecurrenceInput } from "./recurrence.js";
import { config } from "../config/env.js";

const RANGE_DAYS = 90;

export async function ensureFeedToken(userId: string): Promise<{ token: string; url: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { calendarFeedToken: true } });
  const token = user.calendarFeedToken || (await rotateFeedToken(userId)).token;
  return { token, url: feedUrl(token) };
}

export async function rotateFeedToken(userId: string): Promise<{ token: string; url: string }> {
  const token = randomToken(24);
  await prisma.user.update({ where: { id: userId }, data: { calendarFeedToken: token } });
  return { token, url: feedUrl(token) };
}

export function feedUrl(token: string): string {
  const base = config.publicUrl.replace(/\/$/, "");
  return `${base}/api/calendar/feed/${token}.ics`;
}

export async function buildFeedIcs(token: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { calendarFeedToken: token },
    select: { id: true, name: true },
  });
  if (!user) return null;

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + RANGE_DAYS * 86400000);
  to.setHours(23, 59, 59, 999);

  const [eventsRaw, tasksRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        OR: [
          { recurrenceId: null, endAt: { gte: from }, startAt: { lte: to } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
      take: 400,
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        dueDate: { not: null },
        OR: [
          { recurrenceId: null, dueDate: { gte: from, lte: to } },
          { recurrenceId: { not: null } },
        ],
      },
      include: { recurrence: { include: { exceptions: { select: { skipAt: true } } } } },
      take: 400,
    }),
  ]);

  const events: TransferBundle["events"] = [];
  for (const e of eventsRaw) {
    if (!e.recurrence) {
      events.push({
        title: e.title,
        description: e.description,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt.toISOString(),
        allDay: e.allDay,
        location: e.location,
        status: e.status,
      });
      continue;
    }
    const dur = Math.max(0, e.endAt.getTime() - e.startAt.getTime());
    for (const start of occurrenceStarts(e.startAt, e.recurrence as RecurrenceInput, from, to, skipAtsOf(e.recurrence))) {
      events.push({
        title: e.title,
        description: e.description,
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + dur).toISOString(),
        allDay: e.allDay,
        location: e.location,
        status: e.status,
      });
    }
  }

  const tasks: TransferBundle["tasks"] = [];
  for (const t of tasksRaw) {
    if (!t.dueDate) continue;
    const starts = t.recurrence
      ? occurrenceStarts(t.dueDate, t.recurrence as RecurrenceInput, from, to, skipAtsOf(t.recurrence))
      : (t.dueDate >= from && t.dueDate <= to ? [t.dueDate] : []);
    for (const due of starts) {
      tasks.push({
        title: t.title,
        description: t.description,
        dueDate: due.toISOString(),
        hasTime: t.hasTime,
        priority: t.priority,
        status: t.status,
        notes: t.notes,
      });
    }
  }

  return serializeIcs({
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    events,
    notes: [],
  });
}
