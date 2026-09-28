import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";

export async function skipOccurrence(userId: string, kind: "event" | "task", id: string, atIso: string) {
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) throw ApiError.badRequest("Fecha no válida.");
  const recId = kind === "event"
    ? (await prisma.event.findFirst({ where: { id, userId, deletedAt: null }, select: { recurrenceId: true } }))?.recurrenceId
    : (await prisma.task.findFirst({ where: { id, userId, deletedAt: null }, select: { recurrenceId: true } }))?.recurrenceId;
  if (!recId) throw ApiError.badRequest("Esta repetición no existe.");
  await prisma.recurrenceException.upsert({
    where: { recurrenceId_skipAt: { recurrenceId: recId, skipAt: at } },
    create: { userId, recurrenceId: recId, skipAt: at },
    update: {},
  });
}

export const recurrenceInclude = { include: { exceptions: { select: { skipAt: true } } } } as const;
