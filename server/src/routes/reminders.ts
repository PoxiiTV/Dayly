import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

remindersRouter.get("/", asyncHandler(async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const whereAny: Prisma.ReminderWhereInput = { userId: req.user!.id };
  if (from && to) whereAny.remindAt = { gte: new Date(from), lte: new Date(to) };
  const reminders = await prisma.reminder.findMany({ where: whereAny, orderBy: { remindAt: "asc" }, take: 200 });
  res.json({ reminders });
}));

remindersRouter.post("/", validate(schemas.createReminderSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.createReminderSchema>;
  const reminder = await prisma.reminder.create({
    data: {
      userId: req.user!.id, title: b.title ?? null, remindAt: new Date(b.remindAt),
      scheduleDaily: b.scheduleDaily ?? false, targetType: b.targetType ?? "NONE", targetId: b.targetId ?? null,
    },
  });
  res.status(201).json({ reminder });
}));

remindersRouter.patch("/:id", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.reminder as never, req.params.id);
  const { title, remindAt, scheduleDaily } = req.body as { title?: string | null; remindAt?: string; scheduleDaily?: boolean };
  const reminder = await prisma.reminder.update({ where: { id: req.params.id }, data: { title: title ?? undefined, remindAt: remindAt ? new Date(remindAt) : undefined, scheduleDaily } });
  res.json({ reminder });
}));

remindersRouter.delete("/:id", asyncHandler(async (req, res) => { await assertOwned(req, prisma.reminder as never, req.params.id); await prisma.reminder.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

// Find due reminders (notification window).
remindersRouter.get("/due", asyncHandler(async (req, res) => {
  const reminders = await prisma.reminder.findMany({ where: { userId: req.user!.id, sentAt: null, remindAt: { lte: new Date(new Date().getTime() + 10 * 60 * 1000) } }, orderBy: { remindAt: "asc" }, take: 50 });
  res.json({ reminders });
}));