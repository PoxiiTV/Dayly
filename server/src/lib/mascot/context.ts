import { prisma } from "../prisma.js";
import { localYmd, zonedDayRange } from "./time.js";

export function fmtClock(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return d.toTimeString().slice(0, 5);
  }
}

/** Monday = bit 0 … Sunday = bit 6, evaluated on the user's local weekday. */
export function scheduledToday(dayBits: number, tz: string, at = new Date()): boolean {
  const ymd = localYmd(tz, at);
  const mondayFirst = (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7;
  return ((dayBits >> mondayFirst) & 1) === 1;
}

/** Memoria del usuario en texto plano, lista para inyectar en el prompt. */
export async function memoryBlurb(userId: string): Promise<string> {
  const rows = await prisma.mascotMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 30 });
  return rows.map((r) => `• ${r.key}: ${r.value}`).join("\n");
}

/** Agenda de HOY del usuario (con ids, para poder actuar), inyectada en cada conversación. */
export async function buildDayContext(userId: string, tz: string): Promise<string> {
  const at = new Date();
  const today = localYmd(tz, at);
  const { start, end } = zonedDayRange(tz, 0);

  const [tasks, events, reminders, habits] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: end } },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, dueDate: true },
      take: 40,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true, startAt: true },
      take: 20,
    }),
    prisma.reminder.findMany({
      where: { userId, remindAt: { gte: at } },
      orderBy: { remindAt: "asc" },
      select: { id: true, title: true },
      take: 5,
    }),
    prisma.habit.findMany({ where: { userId }, select: { id: true, name: true, scheduleDayBits: true } }),
  ]);

  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < start);
  const todayTasks = tasks.filter((t) => t.dueDate && t.dueDate >= start);
  const habitsToday = habits.filter((h) => scheduledToday(h.scheduleDayBits, tz, at));

  const lines = [`--- Contexto de tu agenda (zona ${tz}, hoy ${today}) ---`];
  if (!todayTasks.length && !events.length && !overdue.length && !habitsToday.length) lines.push("Hoy no tienes nada programado.");
  if (overdue.length) lines.push(`Atrasadas: ${overdue.slice(0, 5).map((t) => `${t.title} (id=${t.id})`).join("; ")}`);
  if (todayTasks.length) lines.push(`Tareas de hoy: ${todayTasks.slice(0, 8).map((t) => `${t.title} (id=${t.id})`).join("; ")}`);
  if (events.length) lines.push(`Eventos de hoy: ${events.map((e) => `${fmtClock(e.startAt, tz)} ${e.title} (id=${e.id})`).join("; ")}`);
  if (reminders.length) lines.push(`Próximos recordatorios: ${reminders.map((r) => `${r.title || "Recordatorio"} (id=${r.id})`).join("; ")}`);
  if (habitsToday.length) lines.push(`Hábitos de hoy: ${habitsToday.map((h) => `${h.name} (id=${h.id})`).join("; ")}`);
  return lines.join("\n");
}
