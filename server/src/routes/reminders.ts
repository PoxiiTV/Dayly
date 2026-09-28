import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";
import { reminderOverlapsUtcRange, optionalRangeEnd } from "../lib/dateRange.js";
import {
  absUploadPath,
  attachmentFileExists,
  purgeFiles,
  saveOwnedFiles,
  sendAttachmentHeaders,
} from "../lib/uploads.js";
import { acceptAttachmentFiles, postedFiles } from "../middleware/upload.js";

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const attachmentMeta = {
  select: { id: true, filename: true, mimeType: true, sizeBytes: true },
  orderBy: { createdAt: "asc" as Prisma.SortOrder },
};

remindersRouter.get("/", asyncHandler(async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const whereAny: Prisma.ReminderWhereInput = { userId: req.user!.id };
  if (from && to) Object.assign(whereAny, reminderOverlapsUtcRange(new Date(from), new Date(to)));
  const reminders = await prisma.reminder.findMany({
    where: whereAny,
    include: { attachments: attachmentMeta },
    orderBy: { remindAt: "asc" },
    take: 200,
  });
  res.json({ reminders });
}));

remindersRouter.post("/", validate(schemas.createReminderSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.createReminderSchema>;
  const reminder = await prisma.reminder.create({
    data: {
      userId: req.user!.id, title: b.title ?? null, remindAt: new Date(b.remindAt),
      endAt: optionalRangeEnd(new Date(b.remindAt), b.endAt ? new Date(b.endAt) : null),
      scheduleDaily: b.scheduleDaily ?? false, notifyTelegram: b.notifyTelegram ?? false,
      targetType: b.targetType ?? "NONE", targetId: b.targetId ?? null,
    },
    include: { attachments: attachmentMeta },
  });
  res.status(201).json({ reminder });
}));

remindersRouter.patch("/:id", validate(schemas.updateReminderSchema), asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.reminder as never, req.params.id, {}, { softDelete: false });
  const b = req.body as unknown as z.infer<typeof schemas.updateReminderSchema>;
  const current = await prisma.reminder.findUniqueOrThrow({ where: { id: req.params.id }, select: { remindAt: true } });
  const nextRemind = b.remindAt ? new Date(b.remindAt) : current.remindAt;
  const reminder = await prisma.reminder.update({
    where: { id: req.params.id },
    data: {
      title: b.title === undefined ? undefined : (b.title?.trim() || null),
      remindAt: b.remindAt ? nextRemind : undefined,
      endAt: b.endAt !== undefined
        ? optionalRangeEnd(nextRemind, b.endAt ? new Date(b.endAt) : null)
        : undefined,
      scheduleDaily: b.scheduleDaily,
      notifyTelegram: b.notifyTelegram,
      sentAt: b.remindAt && nextRemind.getTime() > Date.now() ? null : undefined,
    },
    include: { attachments: attachmentMeta },
  });
  res.json({ reminder });
}));

remindersRouter.post(
  "/:id/attachments",
  acceptAttachmentFiles,
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.reminder as never, req.params.id, {}, { softDelete: false });
    const attachments = await saveOwnedFiles({
      userId: req.user!.id,
      kind: "reminder",
      parentId: req.params.id,
      files: postedFiles(req),
    });
    res.status(201).json({ attachments });
  }),
);

remindersRouter.get(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.reminderAttachment.findFirst({
      where: { id: req.params.attId, reminderId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    const full = absUploadPath(att.storageKey);
    if (!attachmentFileExists(att.storageKey)) throw ApiError.notFound("Archivo no encontrado.");
    sendAttachmentHeaders(res, att);
    res.sendFile(full);
  }),
);

remindersRouter.delete(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.reminderAttachment.findFirst({
      where: { id: req.params.attId, reminderId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    await prisma.reminderAttachment.delete({ where: { id: att.id } });
    await purgeFiles([att.storageKey]);
    res.json({ ok: true });
  }),
);

remindersRouter.delete("/:id", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.reminder as never, req.params.id, {}, { softDelete: false });
  const files = await prisma.reminderAttachment.findMany({ where: { reminderId: req.params.id }, select: { storageKey: true } });
  await prisma.reminder.delete({ where: { id: req.params.id } });
  await purgeFiles(files.map((f) => f.storageKey));
  res.json({ ok: true });
}));

// Find due reminders (notification window).
remindersRouter.get("/due", asyncHandler(async (req, res) => {
  const reminders = await prisma.reminder.findMany({ where: { userId: req.user!.id, sentAt: null, remindAt: { lte: new Date(new Date().getTime() + 10 * 60 * 1000) } }, orderBy: { remindAt: "asc" }, take: 50 });
  res.json({ reminders });
}));