import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { sendWebPush } from "./push.js";
import { sendTelegramMessage } from "./telegram.js";
import { decryptSecret } from "./crypto.js";
import { localYmd, zonedDayRange } from "./mascot/time.js";
import { weatherLookup } from "./mascot/weather.js";

export type BriefSettings = {
  enabled: boolean;
  hour: number;
  telegramChatId: string | null;
  telegramBotTokenEnc: string | null;
};

function localHour(tz: string, at = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(at);
    return Number(s) || 0;
  } catch {
    return at.getHours();
  }
}

function fmtClock(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return d.toTimeString().slice(0, 5);
  }
}

/** Compone el texto del resumen matinal para un usuario, en su zona horaria. */
export async function composeBriefing(userId: string, tz: string, city?: string | null): Promise<{ title: string; body: string }> {
  const at = new Date();
  const today = localYmd(tz, at);
  const { start } = zonedDayRange(tz, 0);

  const [tasks, events, habits, forecast] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { not: "COMPLETED" } },
      orderBy: { dueDate: "asc" },
      take: 60,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, startAt: { gte: start, lt: new Date(start.getTime() + 86400000) } },
      orderBy: { startAt: "asc" },
      take: 20,
    }),
    prisma.habit.findMany({ where: { userId } }),
    weatherLookup(city?.trim() ?? "", "today", tz).catch(() => ""),
  ]);

  const overdue = tasks.filter((t) => t.dueDate && t.dueDate.getTime() < start.getTime());
  const todayTasks = tasks.filter((t) => t.dueDate && localYmd(tz, t.dueDate) === today);

  const jsDay = (at.getDay() + 6) % 7; // Monday=0
  const habitsToday = habits.filter((h) => ((h.scheduleDayBits >> jsDay) & 1) === 1);

  const lines: string[] = [];
  if (overdue.length)
    lines.push(`⏰ Te quedan atrasadas: ${overdue.slice(0, 3).map((t) => t.title).join(", ")}${overdue.length > 3 ? ` y ${overdue.length - 3} más` : ""}`);
  if (events.length)
    lines.push(`📅 Hoy tienes: ${events.map((e) => (e.startAt ? `${fmtClock(e.startAt, tz)} ${e.title}` : e.title)).join(" · ")}`);
  if (todayTasks.length)
    lines.push(`✅ Tareas de hoy: ${todayTasks.slice(0, 4).map((t) => t.title).join(", ")}${todayTasks.length > 4 ? ` (+${todayTasks.length - 4})` : ""}`);
  if (habitsToday.length)
    lines.push(`🔥 Hábitos de hoy: ${habitsToday.slice(0, 4).map((h) => h.name).join(", ")}`);
  if (forecast) lines.push(`🌤️ ${forecast}`);

  const body = lines.length ? lines.join("\n") : "Sin pendientes para hoy. Disfruta del día ✨";
  return { title: "Buenos días ☀️", body };
}

export async function getBriefSettings(userId: string): Promise<{ enabled: boolean; hour: number; telegramChatId: string | null; telegramBotConfigured: boolean } | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { briefingEnabled: true, briefingHour: true, telegramChatId: true, telegramBotTokenEnc: true },
  });
  if (!u) return null;
  return {
    enabled: u.briefingEnabled,
    hour: u.briefingHour,
    telegramChatId: u.telegramChatId,
    telegramBotConfigured: Boolean(u.telegramBotTokenEnc),
  };
}

/** Envía el resumen ahora (para /test o el tick). No marca el día. */
export async function sendBriefing(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, city: true, telegramChatId: true, telegramBotTokenEnc: true },
  });
  const tz = u?.timezone || "Europe/Madrid";
  const { title, body } = await composeBriefing(userId, tz, u?.city);

  await prisma.notification.create({ data: { userId, type: "BRIEFING", title, body, actionUrl: "/" } });

  try {
    await sendWebPush(userId, { title, body, url: "/" });
  } catch {
    /* sin suscripciones push no es error */
  }

  if (u?.telegramChatId && u.telegramBotTokenEnc) {
    try {
      const token = decryptSecret(u.telegramBotTokenEnc);
      await sendTelegramMessage(token, u.telegramChatId, `${title}\n${body}`);
    } catch (err) {
      logger.warn({ userId, err: err instanceof Error ? err.message : err }, "briefing: no se pudo enviar por Telegram (token no descifrable o envio fallido)");
    }
  }
}

/** Tick del reloj: envía a quienes les toca en su hora local (una vez al día). */
export async function runBriefingTick(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { briefingEnabled: true },
    select: { id: true, timezone: true, briefingHour: true, briefingLastKey: true },
  });
  for (const u of users) {
    const tz = u.timezone || "Europe/Madrid";
    const now = new Date();
    if (localHour(tz, now) !== u.briefingHour) continue;
    const key = localYmd(tz, now);
    if (u.briefingLastKey === key) continue;
    try {
      await sendBriefing(u.id);
      await prisma.user.update({ where: { id: u.id }, data: { briefingLastKey: key } });
    } catch (err) {
      logger.warn({ err, userId: u.id }, "briefing tick failed");
    }
  }
}

/** Inicia el reloj cada minuto en el proceso del servidor. */
export function startBriefingScheduler(): NodeJS.Timeout {
  return setInterval(() => { void runBriefingTick().catch((e) => logger.warn({ err: e }, "briefing scheduler error")); }, 60_000);
}