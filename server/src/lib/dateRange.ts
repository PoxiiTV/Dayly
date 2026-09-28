import { Prisma } from "@prisma/client";

/** Task whose [dueDate, dueEndDate ?? dueDate] overlaps [from, to]. */
export function taskOverlapsUtcRange(from: Date, to: Date): Prisma.TaskWhereInput {
  return {
    AND: [
      { dueDate: { not: null, lte: to } },
      {
        OR: [
          { dueEndDate: null, dueDate: { gte: from } },
          { dueEndDate: { gte: from } },
        ],
      },
    ],
  };
}

/** Deadline (last day of a span, otherwise dueDate) is already in the past. */
export function taskOverdueWhere(now: Date): Prisma.TaskWhereInput {
  return {
    OR: [
      { dueEndDate: null, dueDate: { lt: now } },
      { dueEndDate: { lt: now } },
    ],
  };
}

/** Reminder whose [remindAt, endAt ?? remindAt] overlaps [from, to]. */
export function reminderOverlapsUtcRange(from: Date, to: Date): Prisma.ReminderWhereInput {
  return {
    AND: [
      { remindAt: { lte: to } },
      {
        OR: [
          { endAt: null, remindAt: { gte: from } },
          { endAt: { gte: from } },
        ],
      },
    ],
  };
}

export function optionalRangeEnd(start: Date | null, end: Date | null): Date | null {
  if (!start || !end) return null;
  return end.getTime() > start.getTime() ? end : null;
}
