/** Minutes from midnight. Night windows may wrap (20:00 → 06:00). */

export const DEFAULT_DARK_START_MIN = 20 * 60;
export const DEFAULT_DARK_END_MIN = 6 * 60;

export function clampMinuteOfDay(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1439, Math.max(0, Math.round(value)));
}

export function isDarkDuringSchedule(nowMin: number, startMin: number, endMin: number): boolean {
  const now = clampMinuteOfDay(nowMin, 0);
  const start = clampMinuteOfDay(startMin, DEFAULT_DARK_START_MIN);
  const end = clampMinuteOfDay(endMin, DEFAULT_DARK_END_MIN);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

export function minutesInTimeZone(timeZone: string, at = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return at.getHours() * 60 + at.getMinutes();
    return hour * 60 + minute;
  } catch {
    return at.getHours() * 60 + at.getMinutes();
  }
}

export function msUntilScheduleBoundary(startMin: number, endMin: number, timeZone: string, at = new Date()): number {
  const now = minutesInTimeZone(timeZone, at);
  const targets = [clampMinuteOfDay(startMin, DEFAULT_DARK_START_MIN), clampMinuteOfDay(endMin, DEFAULT_DARK_END_MIN)];
  let soonest = 1440;
  for (const target of targets) {
    let delta = target - now;
    if (delta <= 0) delta += 1440;
    if (delta < soonest) soonest = delta;
  }
  return soonest * 60 * 1000 + 400;
}

export function timeInputFromMinutes(total: number): string {
  const t = clampMinuteOfDay(total, 0);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesFromTimeInput(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}
