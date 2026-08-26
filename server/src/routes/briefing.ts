import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../config/env.js";
import { getBriefSettings, sendBriefing } from "../lib/briefing.js";

export const briefingRouter = Router();
briefingRouter.use(requireAuth);

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  telegramChatId: z.string().trim().min(4).max(80).nullish(),
  clearTelegram: z.boolean().optional(),
});

briefingRouter.get("/settings", asyncHandler(async (req, res) => {
  const s = await getBriefSettings(req.user!.id);
  res.json({
    settings: { enabled: s?.enabled ?? false, hour: s?.hour ?? 8, telegramChatId: s?.telegramChatId ?? null },
    botConfigured: Boolean(config.telegramBotToken),
  });
}));

briefingRouter.patch("/settings", validate(patchSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof patchSchema>;
  const data: Record<string, unknown> = {};
  if (b.enabled !== undefined) data.briefingEnabled = b.enabled;
  if (b.hour !== undefined) data.briefingHour = b.hour;
  if (b.clearTelegram) data.telegramChatId = null;
  else if (typeof b.telegramChatId === "string") data.telegramChatId = b.telegramChatId.trim() || null;
  else if (b.telegramChatId === null) data.telegramChatId = null;
  const u = await prisma.user.update({ where: { id: req.user!.id }, data });
  res.json({ settings: { enabled: u.briefingEnabled, hour: u.briefingHour, telegramChatId: u.telegramChatId } });
}));

briefingRouter.post("/test", asyncHandler(async (req, res) => {
  await sendBriefing(req.user!.id);
  res.json({ ok: true });
}));