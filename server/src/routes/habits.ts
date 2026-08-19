import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";

export const habitsRouter = Router();
habitsRouter.use(requireAuth);

// Habits are hard-deleted (no deletedAt column), so ownership check is plain.
async function assertOwnedHabit(userId: string, id: string) {
  const h = await prisma.habit.findFirst({ where: { id, userId } });
  if (!h) throw ApiError.notFound("Hábito no encontrado.");
  return h;
}

// Streak helper: consecutive days ending today (or yesterday) with done logs.
// Log dates are stored at UTC-noon so their UTC calendar key equals the local
// calendar date the user picked, independent of DST/UTC boundaries.
function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function computeStreaks(logs: { date: Date; done: boolean }[]) {
  const byDay = new Map<string, boolean>();
  for (const l of logs) {
    const iso = l.date.toISOString().slice(0, 10);
    byDay.set(iso, l.done);
  }
  const todayKey = localKey(new Date());
  let current = 0;
  let cursor = new Date(todayKey + "T12:00:00Z"); // today local, keyed normally
  if (!byDay.get(localKey(cursor))) cursor = new Date(cursor.getTime() - 86400000);
  while (byDay.get(localKey(cursor)) === true) { current++; cursor = new Date(cursor.getTime() - 86400000); }
  let longest = 0, run = 0;
  for (const iso of [...byDay.keys()].sort()) { if (byDay.get(iso)) { run++; longest = Math.max(longest, run); } else run = 0; }
  return { current, longest };
}

habitsRouter.get("/", asyncHandler(async (req, res) => {
  const habits = await prisma.habit.findMany({
    where: { userId: req.user!.id },
    include: { logs: { orderBy: { date: "desc" }, take: 60 } },
    orderBy: { createdAt: "asc" },
  });
  const data = habits.map((h) => ({ ...h, ...computeStreaks(h.logs) }));
  res.json({ habits: data });
}));

habitsRouter.post("/", validate(schemas.createHabitSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.createHabitSchema>;
  const habit = await prisma.habit.create({ data: { userId: req.user!.id, name: b.name, color: b.color ?? null, icon: b.icon ?? null, scheduleDayBits: b.scheduleDayBits ?? 127 } });
  res.status(201).json({ habit });
}));

habitsRouter.patch("/:id", validate(schemas.updateHabitSchema), asyncHandler(async (req, res) => {
  await assertOwnedHabit(req.user!.id, req.params.id);
  const b = req.body as { name?: string; color?: string | null; icon?: string | null; scheduleDayBits?: number };
  const data: Prisma.HabitUpdateInput = {};
  for (const k of ["name", "color", "icon", "scheduleDayBits"] as const) if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
  const habit = await prisma.habit.update({ where: { id: req.params.id }, data });
  res.json({ habit });
}));

habitsRouter.delete("/:id", asyncHandler(async (req, res) => { await assertOwnedHabit(req.user!.id, req.params.id); await prisma.habit.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

// Log toggle for a date. Stored at UTC-noon so the calendar key matches the
// user's local date string exactly (avoids UTC-boundary date flips).
habitsRouter.post("/:id/log", validate(schemas.habitLogSchema), asyncHandler(async (req, res) => {
  await assertOwnedHabit(req.user!.id, req.params.id);
  const { date, done } = req.body as { date: string; done?: boolean };
  const day = new Date(date + "T12:00:00Z");
  const existing = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: req.params.id, date: day } } });
  if (existing) await prisma.habitLog.update({ where: { id: existing.id }, data: { done: done ?? !existing.done } });
  else await prisma.habitLog.create({ data: { habitId: req.params.id, userId: req.user!.id, date: day, done: done ?? true } });
  res.json({ ok: true });
}));