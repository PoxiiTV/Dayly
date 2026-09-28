import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { sendWebPush } from "./push.js";
import { deliverTelegram } from "./telegram.js";
import { localYmd, zonedDayRange } from "./mascot/time.js";
import { alertMoment, normalizeAlertDays, ymdOf } from "./subscriptions.js";
import { parseNotifySound } from "./notifySound.js";
import { MailboxNotificationError, sendMailboxNotification } from "./mailbox.js";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { ApiError } from "./errors.js";
import { occurrenceStarts, skipAtsOf, type RecurrenceInput } from "./recurrence.js";

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export type FiredAlert = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string;
  taskId?: string;
  occurrenceAt?: string;
};

async function notifyOnce(opts: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string;
  notifyInApp?: boolean;
  notifyTelegram?: boolean;
  notifyEmail?: boolean;
  notifySound?: string;
  dedupeKey?: string;
  taskId?: string;
  occurrenceAt?: string;
}): Promise<FiredAlert | null> {
  let fired: FiredAlert | null = null;
  if (opts.notifyInApp ?? true) {
    const reserved = opts.dedupeKey
      ? await reserveDelivery(opts.userId, "APP", opts.dedupeKey)
      : !(await prisma.notification.findFirst({
        where: { userId: opts.userId, actionUrl: opts.actionUrl },
        select: { id: true },
      }));
    if (reserved) {
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
        await sendWebPush(opts.userId, {
          id: n.id,
          title: opts.title,
          body: opts.body,
          url: opts.actionUrl,
          sound: opts.notifySound === "off" ? "off" : parseNotifySound(opts.notifySound),
          taskId: opts.taskId,
          occurrenceAt: opts.occurrenceAt,
        });
        fired = {
          id: n.id,
          type: opts.type,
          title: opts.title,
          body: opts.body,
          actionUrl: opts.actionUrl,
          taskId: opts.taskId,
          occurrenceAt: opts.occurrenceAt,
        };
      } catch {
        // A failure on one channel must not prevent another one.
      }
    }
  }
  if (opts.notifyTelegram) {
    try { await deliverTelegram(opts.userId, `📅 ${opts.title}\n${opts.body}`, opts.actionUrl); }
    catch (error) { logger.warn({ err: error, userId: opts.userId }, "telegram alert failed"); }
  }
  if (opts.notifyEmail) {
    try { await deliverPersonalEmail(opts.userId, opts.title, opts.body, opts.actionUrl); }
    catch (error) { logger.warn({ err: error, userId: opts.userId }, "personal email alert failed"); }
  }
  return fired;
}

/**
 * Reserve a delivery slot before sending. Unlike `notifyOnce`, which checks for
 * an existing notification with the same `actionUrl` and therefore can only
 * ever fire once per URL (and races with a second worker), this leans on the
 * unique index of `AlertDelivery`: whoever inserts first sends, everyone else
 * is skipped atomically by the database.
 */
async function reserveDelivery(userId: string, channel: string, dedupeKey: string): Promise<boolean> {
  const result = await prisma.alertDelivery.createMany({
    data: { userId, channel, dedupeKey },
    skipDuplicates: true,
  });
  return result.count > 0;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(cents / 100);
}

function chargeWhen(daysBefore: number, chargeYmd: string): string {
  const [y, m, d] = chargeYmd.split("-").map(Number);
  const day = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  if (daysBefore === 0) return `Se cobra hoy, ${day}.`;
  if (daysBefore === 1) return `Se cobra mañana, ${day}.`;
  return `Se cobra en ${daysBefore} días, el ${day}.`;
}

/**
 * Subscription charge reminders. Each rule (days before) of each charge is its
 * own dedupe key, so a yearly subscription still warns every year and three
 * rules do not collapse into one.
 */
async function tickSubscriptions(userId: string, user: { timezone: string; notifyTelegramReminders: boolean; notifyEmail: boolean; defaultMailboxId: string | null }, now: Date, sound: string): Promise<FiredAlert[]> {
  const fired: FiredAlert[] = [];
  // Rules cap at 60 days before, so nothing further out can be due yet.
  const horizon = new Date(now.getTime() + 61 * 24 * 60 * 60 * 1000);
  const subs = await prisma.subscription.findMany({
    where: { userId, status: "ACTIVE", nextChargeAt: { lte: horizon } },
    select: {
      id: true, name: true, amountCents: true, currency: true, nextChargeAt: true,
      alertHour: true, alertDaysBefore: true, notifyInApp: true, notifyTelegram: true, notifyEmail: true,
    },
    orderBy: { nextChargeAt: "asc" },
    take: 60,
  });

  for (const sub of subs) {
    const chargeYmd = ymdOf(sub.nextChargeAt);
    const title = `${sub.name} — ${formatMoney(sub.amountCents, sub.currency)}`;
    for (const daysBefore of normalizeAlertDays(sub.alertDaysBefore)) {
      if (alertMoment(chargeYmd, daysBefore, sub.alertHour, user.timezone).getTime() > now.getTime()) continue;
      const body = chargeWhen(daysBefore, chargeYmd);
      const actionUrl = `/subscriptions?s=${sub.id}&c=${chargeYmd}`;
      const dedupeKey = `sub:${sub.id}:${chargeYmd}:${daysBefore}`;

      if (sub.notifyInApp && await reserveDelivery(userId, "APP", dedupeKey)) {
        try {
          const n = await prisma.notification.create({
            data: { userId, type: "REMINDER", title, body, actionUrl },
          });
          await sendWebPush(userId, { title, body, url: actionUrl, sound: sound === "off" ? "off" : parseNotifySound(sound) });
          fired.push({ id: n.id, type: "REMINDER", title, body, actionUrl });
        } catch (error) {
          logger.warn({ err: error, userId }, "subscription app alert failed");
        }
      }
      if (sub.notifyTelegram && user.notifyTelegramReminders && await reserveDelivery(userId, "TELEGRAM", dedupeKey)) {
        try { await deliverTelegram(userId, `💳 ${title}\n${body}`, actionUrl); }
        catch (error) { logger.warn({ err: error, userId }, "subscription telegram alert failed"); }
      }
      if (sub.notifyEmail && user.notifyEmail && user.defaultMailboxId) {
        // deliverPersonalEmail keeps its own EMAIL dedupe row keyed by the URL,
        // plus the mailbox failure handling; no need to duplicate either.
        try { await deliverPersonalEmail(userId, title, body, actionUrl); }
        catch (error) { logger.warn({ err: error, userId }, "subscription email alert failed"); }
      }
    }
  }
  return fired;
}

export async function tickAlerts(userId: string): Promise<{ fired: FiredAlert[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyReminders: true, notifyTelegramReminders: true, notifyEvents: true, notifyTasks: true, notifyEmail: true, defaultMailboxId: true, timezone: true, notifySound: true, notifySoundEnabled: true },
  });
  if (!user) return { fired: [] };

  const sound = user.notifySoundEnabled === false ? "off" : user.notifySound;
  const now = new Date();
  const fired: FiredAlert[] = [];

  if (user.notifyReminders || user.notifyTelegramReminders || user.notifyEmail) {
    const due = await prisma.reminder.findMany({
      where: { userId, sentAt: null, remindAt: { lte: now } },
      orderBy: { remindAt: "asc" },
      take: 40,
    });
    for (const r of due) {
      const telegram = user.notifyTelegramReminders && Boolean(r.notifyTelegram);
      const email = user.notifyEmail && Boolean(user.defaultMailboxId);
      if (!user.notifyReminders && !telegram && !email) continue;
      const title = r.title?.trim() || "Recordatorio";
      const stamp = r.remindAt.toISOString();
      const n = await notifyOnce({
        userId,
        type: "REMINDER",
        title,
        body: "Es el momento que programaste.",
        actionUrl: `/reminders?r=${r.id}&at=${encodeURIComponent(stamp)}`,
        notifyInApp: user.notifyReminders,
        notifyTelegram: telegram,
        notifyEmail: email,
        notifySound: sound,
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

  if (user.notifyEvents || user.notifyEmail) {
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
        notifySound: sound,
        notifyInApp: user.notifyEvents,
        notifyEmail: user.notifyEmail && Boolean(user.defaultMailboxId),
      });
      if (n) fired.push(n);
    }
  }

  if (user.notifyTasks || user.notifyTelegramReminders || user.notifyEmail) {
    const { start, end } = zonedDayRange(user.timezone, 0);
    const dayKey = localYmd(user.timezone);
    const tasks = await prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        dueDate: { not: null, lte: end },
      },
      include: {
        recurrence: { include: { exceptions: { select: { skipAt: true } } } },
        alertSnoozes: { where: { occurrenceAt: { gte: start, lt: end } } },
      },
      orderBy: { dueDate: "desc" },
      take: 200,
    });
    for (const t of tasks) {
      // Expand only today's occurrences. This avoids replaying every missed
      // occurrence of a long-running series after a server restart.
      const occurrences = occurrenceStarts(
        t.dueDate!,
        t.recurrence as RecurrenceInput | null,
        start,
        new Date(end.getTime() - 1),
        skipAtsOf(t.recurrence),
      );
      for (const occurrence of occurrences) {
        // Automatic task alerts are intentionally limited to tasks with an
        // explicit start time. Untimed tasks remain visible in the agenda and
        // can still use an explicit Reminder.
        if (!t.hasTime) continue;
        const occurrenceAt = occurrence.toISOString();
        const snooze = t.alertSnoozes.find((x) => Math.abs(x.occurrenceAt.getTime() - occurrence.getTime()) < 1000);
        const dueAt = snooze?.snoozedUntil ?? occurrence;
        if (dueAt.getTime() > now.getTime()) continue;

        const actionUrl = `/tasks?t=${encodeURIComponent(t.id)}&d=${dayKey}&at=${encodeURIComponent(occurrenceAt)}`;
        const dedupeKey = `task:${t.id}:start:${occurrenceAt}:${dueAt.toISOString()}`;
        const telegramDue = user.notifyTelegramReminders && t.notifyTelegram;
        if (!user.notifyTasks && !telegramDue && !user.notifyEmail) continue;
        const n = await notifyOnce({
          userId,
          type: "TASK",
          title: t.title,
          body: "Empieza ahora.",
          actionUrl,
          notifyInApp: user.notifyTasks,
          notifyTelegram: telegramDue,
          notifyEmail: user.notifyEmail && Boolean(user.defaultMailboxId),
          notifySound: sound,
          dedupeKey,
          taskId: t.id,
          occurrenceAt,
        });
        if (n) fired.push(n);
      }
    }
  }

  // Habit reminders: fire once per scheduled day at the configured minute of
  // day. `lastReminderKey` dedupes across ticks; skipping the log check means
  // the nudge still arrives when the user has NOT done the habit yet.
  const habits = await prisma.habit.findMany({ where: { userId, reminderMinuteOfDay: { not: null } } });
  for (const h of habits) {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (minutesNow < (h.reminderMinuteOfDay ?? 0)) continue;
    const key = dayKeyOf(now);
    if (h.lastReminderKey === key) continue;
    const jsDay = (now.getDay() + 6) % 7; // Monday = 0 .. Sunday = 6
    if (((h.scheduleDayBits >> jsDay) & 1) !== 1) continue;
    await prisma.habit.update({ where: { id: h.id }, data: { lastReminderKey: key } });
    const n = await notifyOnce({
      userId,
      type: "REMINDER",
      title: h.name,
      body: "Tu hábito de hoy te está esperando.",
      actionUrl: `/habits?h=${h.id}`,
      notifySound: sound,
      notifyEmail: user.notifyEmail && Boolean(user.defaultMailboxId),
    });
    if (n) fired.push(n);
  }

  fired.push(...await tickSubscriptions(userId, {
    timezone: user.timezone,
    notifyTelegramReminders: user.notifyTelegramReminders,
    notifyEmail: user.notifyEmail,
    defaultMailboxId: user.defaultMailboxId,
  }, now, sound));

  return { fired };
}

async function deliverPersonalEmail(userId: string, title: string, body: string, dedupeKey: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, notifyEmail: true, defaultMailbox: true },
  });
  if (!user?.notifyEmail || !user.defaultMailbox) return false;
  try {
    await prisma.alertDelivery.create({ data: { userId, channel: "EMAIL", dedupeKey } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
  let safeRetries = 0;
  try {
    const target = new URL(dedupeKey, config.clientOrigin.split(",")[0]).toString();
    while (true) {
      try {
        await sendMailboxNotification(user.defaultMailbox, user.email, `[Kalendiario] ${title}`, `${body}\n\n${target}`);
        break;
      } catch (error) {
        if (safeRetries < 1 && error instanceof MailboxNotificationError && error.safeToRetry) {
          safeRetries += 1;
          continue;
        }
        throw error;
      }
    }
    await prisma.mailbox.updateMany({ where: { id: user.defaultMailbox.id }, data: { lastError: null, lastCheckedAt: new Date() } });
    return true;
  } catch (error) {
    // Keep the attempt as the dedupe record: SMTP timeouts are ambiguous and
    // retrying the same message could deliver duplicates.
    const message = error instanceof ApiError ? error.message : "No se pudo enviar el aviso con el buzón predeterminado.";
    await prisma.mailbox.updateMany({ where: { id: user.defaultMailbox.id }, data: { lastError: message.slice(0, 300), lastCheckedAt: new Date() } });
    if (safeRetries > 0 || user.defaultMailbox.lastError) {
      await prisma.user.updateMany({ where: { id: userId, defaultMailboxId: user.defaultMailbox.id }, data: { notifyEmail: false } });
      const actionUrl = `/inbox?mailbox=${encodeURIComponent(user.defaultMailbox.id)}&alerts=disabled`;
      const existing = await prisma.notification.findFirst({ where: { userId, actionUrl }, select: { id: true } });
      if (!existing) {
        await prisma.notification.create({
          data: {
            userId,
            type: "SYSTEM",
            title: "Avisos por correo pausados",
            body: "El buzón predeterminado ha fallado varias veces. Pruébalo o vuelve a conectarlo antes de reactivar los avisos.",
            actionUrl,
          },
        });
      }
    }
    throw error;
  }
}
