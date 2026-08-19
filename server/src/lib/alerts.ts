import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { sendWebPush } from "./push.js";

export type FiredAlert = { id: string; type: NotificationType; title: string; body: string; actionUrl: string };

async function notifyOnce(opts: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string;
}): Promise<FiredAlert | null> {
  const dup = await prisma.notification.findFirst({
    where: { userId: opts.userId, actionUrl: opts.actionUrl },
    select: { id: true },
  });
  if (dup) return null;
  try {
    const n = await prisma.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        actionUrl: opts.actionUrl,
      },
    });
    await sendWebPush(opts.userId, { title: opts.title, body: opts.body, url: opts.actionUrl });
    return { id: n.id, type: opts.type, title: opts.title, body: opts.body, actionUrl: opts.actionUrl };
  } catch {
    return null;
  }
}

export async function tickAlerts(userId: string): Promise<{ fired: FiredAlert[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyReminders: true, notifyEvents: true, notifyTasks: true },
  });
  if (!user) return { fired: [] };

  const now = new Date();
  const fired: FiredAlert[] = [];

  if (user.notifyReminders) {
    const due = await prisma.reminder.findMany({
      where: { userId, sentAt: null, remindAt: { lte: now } },
      orderBy: { remindAt: "asc" },
      take: 40,
    });
    for (const r of due) {
      const title = r.title?.trim() || "Recordatorio";
      const stamp = r.remindAt.toISOString();
      const n = await notifyOnce({
        userId,
        type: "REMINDER",
        title,
        body: "Es el momento que programaste.",
        actionUrl: `/reminders?r=${r.id}&at=${encodeURIComponent(stamp)}`,
      });
      if (n) fired.push(n);
      if (r.scheduleDaily) {
        const next = new Date(r.remindAt);
        next.setDate(next.getDate() + 1);
        await prisma.reminder.update({ where: { id: r.id }, data: { remindAt: next, sentAt: null } });
      } else {
        await prisma.reminder.update({ where: { id: r.id }, data: { sentAt: now } });
      }
    }
  }

  if (user.notifyEvents) {
    const soon = new Date(now.getTime() + 15 * 60 * 1000);
    const events = await prisma.event.findMany({
      where: { userId, deletedAt: null, startAt: { gte: now, lte: soon } },
      take: 30,
    });
    for (const e of events) {
      const n = await notifyOnce({
        userId,
        type: "EVENT",
        title: e.title,
        body: "Empieza en menos de 15 minutos.",
        actionUrl: `/calendar?e=${e.id}`,
      });
      if (n) fired.push(n);
    }
  }

  if (user.notifyTasks) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const dayKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    const tasks = await prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { not: "COMPLETED" },
        dueDate: { gte: start, lt: end },
      },
      take: 40,
    });
    for (const t of tasks) {
      const n = await notifyOnce({
        userId,
        type: "TASK",
        title: t.title,
        body: "Vence hoy.",
        actionUrl: `/tasks?t=${t.id}&d=${dayKey}`,
      });
      if (n) fired.push(n);
    }
  }

  return { fired };
}
