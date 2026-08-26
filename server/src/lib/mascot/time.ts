/** Calendar YMD in a timezone (en-CA → YYYY-MM-DD). */
export function localYmd(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Convert a wall-clock time in `tz` to a UTC Date. */
export function wallToUtc(ymd: string, hms: string, tz: string): Date {
  const [y, mo, da] = ymd.split("-").map(Number);
  const [hh, mm, ss] = hms.split(":").map(Number);
  const desired = Date.UTC(y, mo - 1, da, hh, mm ?? 0, ss ?? 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  let t = desired;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(t)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    t += desired - asUtc;
  }
  return new Date(t);
}

export function zonedDayRange(tz: string, offsetDays: number): { start: Date; end: Date } {
  const ymd = addDaysYmd(localYmd(tz), offsetDays);
  return { start: wallToUtc(ymd, "00:00:00", tz), end: wallToUtc(addDaysYmd(ymd, 1), "00:00:00", tz) };
}

export function offsetLabel(tz: string, at = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? tz;
}

export function formatLocal(d: Date, tz: string): string {
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function describeNow(tz: string, at = new Date()): { zone: string; offset: string; wall: string; ymd: string } {
  const wall = new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return { zone: tz, offset: offsetLabel(tz, at), wall, ymd: localYmd(tz, at) };
}

function extractClock(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2})[:h](\d{2})\b/i) ?? raw.match(/\ba\s*las?\s*(\d{1,2})\b/i);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] !== undefined && (m[0].includes(":") || /h/i.test(m[0])) ? Number(m[2] ?? 0) : 0;
  if (hh > 23 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}:00`;
}

/** ISO, date-only, or “hoy/mañana” (+ optional clock) in the user's timezone. */
export function parseFlexibleInstant(raw: string, tz: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const clock = extractClock(s) ?? "09:00:00";
  const lower = s.toLowerCase();
  if (/(mañana|manana|tomorrow)/i.test(lower)) {
    return wallToUtc(addDaysYmd(localYmd(tz), 1), clock, tz);
  }
  if (/\bhoy\b|\btoday\b/i.test(lower)) {
    return wallToUtc(localYmd(tz), clock, tz);
  }
  const dayOnly = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dayOnly) return wallToUtc(dayOnly[1], "09:00:00", tz);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}
