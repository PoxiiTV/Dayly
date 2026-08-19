/** Date/time helpers consistent with the app's local-timezone-first model. */

/** Local calendar date key (YYYY-MM-DD) for a date. */
export function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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
  // For <input type="datetime-local">: YYYY-MM-DDTHH:mm in local time.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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