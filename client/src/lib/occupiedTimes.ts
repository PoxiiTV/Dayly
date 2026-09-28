import { localKey } from "./dates";
import type { EventItem, Reminder, Task } from "./types";

export type OccupiedLookup = {
  times: ReadonlySet<string>;
  titles: ReadonlyMap<string, readonly string[]>;
};

export const EMPTY_OCCUPIED: OccupiedLookup = {
  times: new Set(),
  titles: new Map(),
};

function asDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Quarter-hour slot that contains this instant (`HH:mm`). */
export function quarterSlotOf(d: Date): string {
  const copy = new Date(d);
  copy.setMinutes(Math.floor(copy.getMinutes() / 15) * 15, 0, 0);
  return hhmm(copy);
}

/**
 * Quarter-hour slots occupied on `dayKey` by `[start, end)`.
 * A timed point (no duration) occupies only its starting slot.
 */
export function occupiedSlotsOnDay(
  start: Date | string,
  end: Date | string | null | undefined,
  dayKey: string,
): string[] {
  const s = asDate(start);
  if (Number.isNaN(s.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return [];
  const e = end == null || end === "" ? s : asDate(end);
  if (Number.isNaN(e.getTime())) return [];

  const dayStart = new Date(`${dayKey}T00:00:00`);
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);

  if (!(e.getTime() > s.getTime())) {
    if (localKey(s) !== dayKey) return [];
    return [quarterSlotOf(s)];
  }

  if (!(s < nextDay && e > dayStart)) return [];

  const visStart = s < dayStart ? dayStart : s;
  const visEnd = e > nextDay ? nextDay : e;
  const cursor = new Date(visStart);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(Math.floor(cursor.getMinutes() / 15) * 15);

  const slots: string[] = [];
  while (cursor.getTime() < visEnd.getTime() && cursor.getTime() < nextDay.getTime()) {
    slots.push(hhmm(cursor));
    cursor.setMinutes(cursor.getMinutes() + 15);
  }
  if (slots.length === 0) return [quarterSlotOf(visStart)];
  return slots;
}

function pushTitle(map: Map<string, string[]>, slot: string, title: string) {
  const list = map.get(slot);
  if (list) {
    if (!list.includes(title)) list.push(title);
    return;
  }
  map.set(slot, [title]);
}

export function collectOccupiedTimes(opts: {
  dayKey: string;
  tasks?: Task[];
  events?: EventItem[];
  reminders?: Reminder[];
  excludeIds?: Iterable<string>;
}): OccupiedLookup {
  const { dayKey } = opts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return EMPTY_OCCUPIED;
  const exclude = new Set(opts.excludeIds ?? []);
  const titles = new Map<string, string[]>();

  for (const task of opts.tasks ?? []) {
    if (exclude.has(task.id) || !task.dueDate || !task.hasTime) continue;
    const label = task.title.trim() || "Tarea";
    for (const slot of occupiedSlotsOnDay(task.dueDate, task.dueEndDate, dayKey)) {
      pushTitle(titles, slot, label);
    }
  }
  for (const event of opts.events ?? []) {
    if (exclude.has(event.id) || event.allDay) continue;
    const label = event.title.trim() || "Evento";
    for (const slot of occupiedSlotsOnDay(event.startAt, event.endAt, dayKey)) {
      pushTitle(titles, slot, label);
    }
  }
  for (const reminder of opts.reminders ?? []) {
    if (exclude.has(reminder.id)) continue;
    const label = reminder.title?.trim() || "Recordatorio";
    for (const slot of occupiedSlotsOnDay(reminder.remindAt, reminder.endAt, dayKey)) {
      pushTitle(titles, slot, label);
    }
  }

  return { times: new Set(titles.keys()), titles };
}

export function occupiedHint(titles: readonly string[] | undefined, time: string): string {
  if (!titles?.length) return `Ya hay algo a las ${time}`;
  if (titles.length === 1) return `Ya hay: ${titles[0]}`;
  return `Ya hay ${titles.length} elementos (p. ej. ${titles[0]})`;
}
