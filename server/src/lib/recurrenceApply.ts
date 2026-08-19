import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { RecurrenceInput } from "./recurrence.js";

export async function applyRecurrence(
  userId: string,
  next: RecurrenceInput | null | undefined,
  existingId: string | null | undefined,
): Promise<string | null | undefined> {
  if (next === undefined) return existingId ?? undefined;
  if (next === null) {
    if (existingId) {
      await prisma.recurrence.delete({ where: { id: existingId } }).catch(() => undefined);
    }
    return null;
  }
  const data: Prisma.RecurrenceUncheckedCreateInput = {
    userId,
    frequency: next.frequency as Prisma.RecurrenceUncheckedCreateInput["frequency"],
    interval: next.interval ?? 1,
    byDay: next.byDay ?? undefined,
    byMonthDay: next.byMonthDay ?? undefined,
    count: next.count ?? undefined,
    endDate: next.endDate ? new Date(next.endDate) : undefined,
  };
  if (existingId) {
    await prisma.recurrence.update({
      where: { id: existingId },
      data: {
        frequency: data.frequency,
        interval: data.interval,
        byDay: data.byDay,
        byMonthDay: data.byMonthDay,
        count: data.count,
        endDate: data.endDate,
      },
    });
    return existingId;
  }
  const created = await prisma.recurrence.create({ data });
  return created.id;
}
