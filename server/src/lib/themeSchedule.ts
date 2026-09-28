/** Keep in sync with client/src/lib/themeSchedule.ts */

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
