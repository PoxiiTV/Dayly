import { prisma } from "../prisma.js";
import { localYmd, zonedDayRange } from "./time.js";

function fmtClock(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return d.toTimeString().slice(0, 5);
  }
}

/** Memoria del usuario en texto plano, lista para inyectar en el prompt. */
export async function memoryBlurb(userId: string): Promise<string> {
  const rows = await prisma.mascotMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 30 });
  if (!rows.length) return "";
  return rows.map((r) => `• ${r.key}: ${r.value}`).join("\n");
}

/**
 * Hechos de la agenda de HOY del usuario (con ids, para poder actuar),
 * formateados para inyectar como contexto en cada conversacion.
 */
export async function buildDayContext(userId: string, tz: string): Promise<string> {
  const at = new Date();
  const today = localYmd(tz, at);
  const { start } = zonedDayRange(tz, 0);
  const end = new Date(start.getTime() + 86400000);

  const [tasks, events, reminders, habits] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { not: "COMPLETED" } },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, dueDate: true, status: true },
      take: 40,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true, startAt: true },
      take: 20,
    }),
    prisma.reminder.findMany({
      where: { userId },
      orderBy: { remindAt: "asc" },
      select: { id: true, title: true, remindAt: true },
      take: 10,
    }),
    prisma.habit.findMany({ where: { userId }, select: { id: true, name: true, scheduleDayBits: true } }),
  ]);

  const jsDay = (at.getDay() + 6) % 7; // Monday=0
  const habitsToday = habits.filter((h) => ((h.scheduleDayBits >> jsDay) & 1) === 1);
  const todayTasks = tasks.filter((t) => t.dueDate && localYmd(tz, t.dueDate) === today);
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate.getTime() < start.getTime());

  const lines: string[] = [];
  lines.push(`--- Contexto de tu agenda (zona ${tz}, hoy ${today}) ---`);
  if (!todayTasks.length && !events.length && !overdue.length && !habitsToday.length) lines.push("Hoy no tienes nada programado.");
  if (overdue.length) lines.push(`Atrasadas: ${overdue.map((t) => `${t.title} (id=${t.id})`).slice(0, 5).join("; ")}`);
  if (todayTasks.length) lines.push(`Tareas de hoy: ${todayTasks.map((t) => `${t.title} (id=${t.id})`).slice(0, 8).join("; ")}`);
  if (events.length) lines.push(`Eventos de hoy: ${events.map((e) => `${fmtClock(e.startAt!, tz)} ${e.title} (id=${e.id})`).join("; ")}`);
  if (reminders.length) lines.push(`Próximos recordatorios: ${reminders.slice(0, 5).map((r) => `${r.title} (id=${r.id})`).join("; ")}`);
  if (habitsToday.length) lines.push(`Hábitos de hoy: ${habitsToday.map((h) => `${h.name} (id=${h.id})`).join("; ")}`);
  return lines.join("\n");
}