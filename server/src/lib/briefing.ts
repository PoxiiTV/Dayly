import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { sendWebPush } from "./push.js";
import { deliverTelegram } from "./telegram.js";
import { parseNotifySound } from "./notifySound.js";
import { localYmd, zonedDayRange } from "./mascot/time.js";
import { weatherLookup } from "./mascot/weather.js";
import { fmtClock, scheduledToday } from "./mascot/context.js";

export const BRIEFING_HOURS = [5, 6, 7, 8, 9, 10, 11, 12] as const;

function localHour(tz: string, at = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(at)) || 0;
  } catch {
    return at.getHours();
  }
}

const more = (n: number) => (n > 0 ? ` y ${n} más` : "");

/** Compone el resumen matinal de un usuario, en su zona horaria. */
export async function composeBriefing(userId: string, tz: string, city?: string | null): Promise<{ title: string; body: string }> {
  const at = new Date();
  const { start, end } = zonedDayRange(tz, 0);

  const [tasks, events, habits, forecast] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: end } },
      orderBy: { dueDate: "asc" },
      select: { title: true, dueDate: true },
      take: 60,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
      select: { title: true, startAt: true, allDay: true },
      take: 20,
    }),
    prisma.habit.findMany({ where: { userId }, select: { name: true, scheduleDayBits: true } }),
    weatherLookup(city?.trim() ?? "", "today", tz).catch(() => ""),
  ]);

  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < start);
  const todayTasks = tasks.filter((t) => t.dueDate && t.dueDate >= start);
  const habitsToday = habits.filter((h) => scheduledToday(h.scheduleDayBits, tz, at));

  const lines: string[] = [];
  if (overdue.length) lines.push(`⏰ Atrasadas: ${overdue.slice(0, 3).map((t) => t.title).join(", ")}${more(overdue.length - 3)}`);
  if (events.length) lines.push(`📅 Hoy tienes: ${events.map((e) => (e.allDay ? e.title : `${fmtClock(e.startAt, tz)} ${e.title}`)).join(" · ")}`);
  if (todayTasks.length) lines.push(`✅ Tareas de hoy: ${todayTasks.slice(0, 4).map((t) => t.title).join(", ")}${more(todayTasks.length - 4)}`);
  if (habitsToday.length) lines.push(`🔥 Hábitos de hoy: ${habitsToday.slice(0, 4).map((h) => h.name).join(", ")}${more(habitsToday.length - 4)}`);
  if (forecast) lines.push(`🌤️ ${forecast}`);

  return { title: "Buenos días ☀️", body: lines.length ? lines.join("\n") : "Sin pendientes para hoy. Disfruta del día ✨" };
}

/**
 * Envía el resumen: campana + push + Telegram (si el usuario tiene su bot vinculado).
 * `dedupeKey` evita duplicar el Telegram del mismo día; la prueba usa una clave única.
 */
export async function sendBriefing(userId: string, dedupeKey = `briefing-test:${randomUUID()}`): Promise<{ telegram: boolean }> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, weatherCity: true, notifySound: true } });
  const tz = u.timezone || "Europe/Madrid";
  const { title, body } = await composeBriefing(userId, tz, u.weatherCity);

  await prisma.notification.create({ data: { userId, type: "BRIEFING", title, body, actionUrl: "/" } });
  await sendWebPush(userId, { title, body, url: "/", sound: u.notifySound === "off" ? "off" : parseNotifySound(u.notifySound) })
    .catch((err) => logger.warn({ err, userId }, "briefing: push failed"));

  let telegram = false;
  try {
    telegram = await deliverTelegram(userId, `${title}\n${body}`, dedupeKey);
  } catch (err) {
    logger.warn({ err, userId }, "briefing: telegram failed");
  }
  return { telegram };
}

/** Envía a quien le toca en su hora local, una vez al día. */
export async function runBriefingTick(now = new Date()): Promise<void> {
  const users = await prisma.user.findMany({
    where: { briefingEnabled: true, status: "ACTIVE" },
    select: { id: true, timezone: true, briefingHour: true, briefingLastKey: true },
  });
  for (const u of users) {
    const tz = u.timezone || "Europe/Madrid";
    if (localHour(tz, now) !== u.briefingHour) continue;
    const key = localYmd(tz, now);
    if (u.briefingLastKey === key) continue;
    try {
      // Marca antes de enviar: un fallo parcial no repite el resumen cada minuto.
      await prisma.user.update({ where: { id: u.id }, data: { briefingLastKey: key } });
      await sendBriefing(u.id, `briefing:${key}`);
    } catch (err) {
      logger.warn({ err, userId: u.id }, "briefing tick failed");
    }
  }
}

export function startBriefingScheduler() {
  if (process.env.NODE_ENV === "test") return;
  const timer = setInterval(() => { void runBriefingTick().catch((err) => logger.warn({ err }, "briefing scheduler error")); }, 60_000);
  timer.unref();
}
