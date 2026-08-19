import type { Recurrence, RecurrenceFrequency } from "@prisma/client";

export type RecurrenceInput = {
  frequency: RecurrenceFrequency | string;
  interval?: number;
  byDay?: string[] | null | unknown;
  byMonthDay?: number | null;
  count?: number | null;
  endDate?: string | Date | null;
};

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function clone(d: Date) {
  return new Date(d.getTime());
}

function addInterval(d: Date, frequency: string, interval: number) {
  const n = clone(d);
  const step = Math.max(1, interval);
  if (frequency === "DAILY" || frequency === "CUSTOM") n.setDate(n.getDate() + step);
  else if (frequency === "WEEKLY") n.setDate(n.getDate() + 7 * step);
  else if (frequency === "MONTHLY") n.setMonth(n.getMonth() + step);
  else if (frequency === "YEARLY") n.setFullYear(n.getFullYear() + step);
  else n.setDate(n.getDate() + step);
  return n;
}

function matchesByDay(d: Date, byDay: string[] | null | undefined) {
  if (!byDay?.length) return true;
  const code = WEEKDAYS[d.getDay()];
  return byDay.includes(code);
}

/** Occurrence starts (inclusive range). Caps at 400 to keep calendars snappy. */
export function occurrenceStarts(
  anchor: Date,
  rule: RecurrenceInput | Recurrence | null | undefined,
  rangeFrom: Date,
  rangeTo: Date,
): Date[] {
  if (!rule) {
    if (anchor >= rangeFrom && anchor <= rangeTo) return [anchor];
    return [];
  }
  const interval = Math.max(1, Number(rule.interval ?? 1));
  const frequency = String(rule.frequency);
  const byDay = (Array.isArray(rule.byDay) ? rule.byDay : []) as string[];
  const end = rule.endDate ? new Date(rule.endDate as Date | string) : null;
  const max = Math.min(400, Number(rule.count ?? 400));
  const out: Date[] = [];
  let cursor = clone(anchor);
  let seen = 0;
  let guard = 0;
  const hardStop = new Date(rangeTo.getTime() + 366 * 86400000);

  while (seen < max && guard < 2500 && cursor <= hardStop) {
    guard += 1;
    if (end && cursor > end) break;
    const okDay = frequency === "WEEKLY" ? matchesByDay(cursor, byDay.length ? byDay : undefined) : true;
    if (okDay) {
      seen += 1;
      if (cursor >= rangeFrom && cursor <= rangeTo) out.push(clone(cursor));
      if (rule.count && seen >= Number(rule.count)) break;
    }
    if (frequency === "WEEKLY" && byDay.length) {
      cursor.setDate(cursor.getDate() + 1);
    } else {
      cursor = addInterval(cursor, frequency, interval);
    }
  }
  return out;
}

export function shiftDateTime(original: Date, newStart: Date, other: Date) {
  return new Date(other.getTime() + (newStart.getTime() - original.getTime()));
}
