/** Date/time helpers consistent with the app's local-timezone-first model. */

/** Local calendar date key (YYYY-MM-DD) for a date. */
export function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Calendar date key in an IANA timezone. */
export function localKeyInTimeZone(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function toDateTimeLocal(d: Date): string {
  // Local wall time as YYYY-MM-DDTHH:mm (same shape as the old datetime-local value).
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Times every 15 minutes, `HH:mm`, for the custom time picker. */
export const QUARTER_HOUR_TIMES: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

/** Default start when creating a task, event or reminder: next day at 08:00. */
export function suggestedCreateStart(now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** If the user left "Hasta" empty, events still need an end instant (1 hour). */
export function defaultEventEnd(start: Date): Date {
  return new Date(start.getTime() + 3600000);
}

export function formatDateChip(value: string): string {
  if (!value) return "Elegir fecha";
  const d = parseKey(value.slice(0, 10));
  if (Number.isNaN(d.getTime())) return "Elegir fecha";
  const key = localKey(d);
  const pretty = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  if (key === localKey(new Date())) return `Hoy · ${pretty}`;
  if (key === localKey(addDays(new Date(), 1))) return `Mañana · ${pretty}`;
  return pretty;
}

export function fromDateTimeLocal(v: string): Date {
  return new Date(v);
}

export function fmtTime(d: Date | string, fmt24 = true): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, "0");
  if (fmt24) return `${String(h).padStart(2, "0")}:${m}`;
  const ap = h >= 12 ? "p. m." : "a. m.";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function fmtDate(d: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-ES", opts ?? { weekday: "long", day: "numeric", month: "long" });
}

export function relativeDay(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const start = startOfDay(new Date());
  const diff = Math.round((startOfDay(dt).getTime() - start.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff === -1) return "Ayer";
  return fmtDate(dt, { weekday: "short", day: "numeric", month: "short" });
}

/** Weekday label array index-aligned with firstDayOfWeek. */
export function weekdayNames(firstDayOfWeek = 1): string[] {
  const names = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  return [...names.slice(firstDayOfWeek), ...names.slice(0, firstDayOfWeek)];
}

/** Compact weekday initials, Monday-first (L M X J V S D). */
export const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"] as const;

/** Six-week Monday-first grid for a calendar month. */
export function monthGrid(year: number, month: number, firstDayOfWeek = 1): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() - firstDayOfWeek + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - startOffset));
}

export function monthTitle(d: Date): string {
  const s = d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 6) return "Buenas noches";
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function iso(d: Date): string {
  return d.toISOString();
}

/**
 * Whether `[start, end]` overlaps a local calendar day.
 * An instant ending exactly at midnight does not include that next day.
 */
export function spansLocalDay(start: Date | string, end: Date | string | null | undefined, dayKey: string): boolean {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = end == null || end === "" ? s : typeof end === "string" ? new Date(end) : end;
  const dayStart = startOfDay(parseKey(dayKey));
  const dayEnd = addDays(dayStart, 1);
  return s < dayEnd && (e > s ? e > dayStart : s >= dayStart);
}

/** Local YYYY-MM-DD keys covered by `[start, end]`. */
export function localKeysInRange(start: Date | string, end: Date | string | null | undefined): string[] {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = end == null || end === "" ? s : typeof end === "string" ? new Date(end) : end;
  const keys: string[] = [];
  let cur = startOfDay(s);
  const lastInstant = e > s ? e : s;
  const lastDay = startOfDay(lastInstant.getTime() === startOfDay(lastInstant).getTime() && lastInstant > s
    ? new Date(lastInstant.getTime() - 1)
    : lastInstant);
  while (cur.getTime() <= lastDay.getTime() && keys.length < 400) {
    keys.push(localKey(cur));
    cur = addDays(cur, 1);
  }
  if (keys.length === 0) keys.push(localKey(s));
  return keys;
}

/** Deadline used for overdue/upcoming: last instant of a range, or the single due date. */
export function rangeEnd(start: Date | string | null | undefined, end: Date | string | null | undefined): Date | null {
  if (end) return typeof end === "string" ? new Date(end) : end;
  if (start) return typeof start === "string" ? new Date(start) : start;
  return null;
}

type TaskDeadline = {
  dueDate?: string | null;
  dueEndDate?: string | null;
  hasTime?: boolean;
  status?: string;
};

/** Instant used to decide overdue/upcoming. All-day tasks count until 23:59:59 local. */
export function taskDeadlineMs(task: TaskDeadline): number {
  const deadline = rangeEnd(task.dueDate, task.dueEndDate);
  if (!deadline) return Number.POSITIVE_INFINITY;
  const end = new Date(deadline.getTime());
  if (!task.hasTime) end.setHours(23, 59, 59, 999);
  return end.getTime();
}

/** Open tasks whose deadline has already passed. Matches the Tareas → Atrasadas filter. */
export function isTaskOverdue(task: TaskDeadline, now = Date.now()): boolean {
  if (!task.dueDate) return false;
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return false;
  return taskDeadlineMs(task) < now;
}

/** Format seconds as HH:MM:SS or MM:SS. */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baja", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente",
};
