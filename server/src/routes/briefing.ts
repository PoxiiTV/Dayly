import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { briefingTestLimiter } from "../middleware/rateLimit.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { BRIEFING_HOURS, sendBriefing } from "../lib/briefing.js";
import { getUserTelegramStatus } from "../lib/telegram.js";

export const briefingRouter = Router();
briefingRouter.use(requireAuth);

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().refine((h) => (BRIEFING_HOURS as readonly number[]).includes(h), "Hora no válida").optional(),
}).strict();

async function settingsOf(userId: string) {
  const [u, telegram] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { briefingEnabled: true, briefingHour: true } }),
    getUserTelegramStatus(userId),
  ]);
  return {
    enabled: u.briefingEnabled,
    hour: u.briefingHour,
    telegramReady: telegram.linked && telegram.bot?.status === "ACTIVE",
  };
}

briefingRouter.get("/settings", asyncHandler(async (req, res) => {
  res.json({ settings: await settingsOf(req.user!.id) });
}));

briefingRouter.patch("/settings", validate(patchSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof patchSchema>;
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { ...(b.enabled !== undefined && { briefingEnabled: b.enabled }), ...(b.hour !== undefined && { briefingHour: b.hour }) },
  });
  res.json({ settings: await settingsOf(req.user!.id) });
}));

briefingRouter.post("/test", briefingTestLimiter, asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await sendBriefing(req.user!.id)) });
}));
