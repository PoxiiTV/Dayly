import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { TelegramBot } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { decryptSecret, hashToken, randomToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  activateTelegramWebhook,
  activeTelegramBot,
  getUserTelegramStatus,
  inspectTelegramWebhook,
  revokeUserTelegramBot,
  saveUserTelegramBot,
  sendTelegramMessage,
  telegramBotByRoute,
  telegramWebhookSecret,
} from "../lib/telegram.js";
import { clearTelegramCalenHistory, handleTelegramText } from "../lib/telegramCalen.js";
import { APP_NAME } from "../lib/brand.js";
import { platformProviderEnabled } from "../lib/integrationSettings.js";
import { logWebhookProcessingFailure, processTelegramBusinessUpdate, type TelegramBusinessUpdate } from "../lib/messaging/webhooks.js";

export const telegramRouter = Router();
const LINKED_OK = "Telegram vinculado. Ya puedes escribirme: una idea, una tarea o «recuérdame mañana a las 9…». /help para ejemplos.";

// Temporary bridge for the single legacy bot. It remains authenticated with
// its old secret until the selected owner activates the new opaque route.
telegramRouter.post("/webhook", asyncHandler(async (req, res) => {
  const legacy = await prisma.telegramSetting.findUnique({ where: { id: 1 } });
  const received = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
  const expected = legacy?.webhookSecretEnc ? decryptSecret(legacy.webhookSecretEnc) : "";
  const bot = legacy?.botUsername
    ? await prisma.telegramBot.findFirst({ where: { username: legacy.botUsername, status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" } })
    : null;
  if (!bot || !safeEqual(expected, received)) throw ApiError.forbidden("Webhook no autorizado.");
  await processBotWebhook(bot, req.body as TelegramBusinessUpdate);
  res.json({ ok: true });
}));

telegramRouter.post("/webhook/:routingToken", asyncHandler(async (req, res) => {
  const bot = await telegramBotByRoute(req.params.routingToken);
  const received = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
  if (!bot || !safeEqual(telegramWebhookSecret(bot), received)) throw ApiError.forbidden("Webhook no autorizado.");
  await processBotWebhook(bot, req.body as TelegramBusinessUpdate);
  res.json({ ok: true });
}));

async function processBotWebhook(bot: TelegramBot, update: TelegramBusinessUpdate): Promise<void> {
  if (!platformProviderEnabled("TELEGRAM")) return;
  if (update.business_connection || update.business_message || update.edited_business_message || update.deleted_business_messages) {
    try { await processTelegramBusinessUpdate(update, bot); }
    catch (error) {
      logWebhookProcessingFailure("TELEGRAM", error);
      throw ApiError.internal("No se pudo procesar el evento empresarial de Telegram.");
    }
    return;
  }

  const message = (update as { message?: { chat?: { id?: number | string; type?: string }; from?: { id?: number | string; username?: string; is_bot?: boolean }; text?: string } }).message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim() ?? "";
  if (!message || chatId === undefined || !text) return;
  const chat = String(chatId);
  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  // The assistant acts on the user's agenda, so it only listens to the
  // linked person in their private chat. Groups and channels never link.
  const senderId = message.from?.id !== undefined ? String(message.from.id) : "";
  if (message.chat?.type !== "private" || !senderId || senderId !== chat || message.from?.is_bot) {
    if (startMatch && message.chat?.type !== "private") await sendTelegramMessage(bot, chat, "Por seguridad solo me vinculo desde un chat privado conmigo.");
    return;
  }
  if (startMatch) {
    const rawToken = (startMatch[1] ?? "").trim();
    if (!rawToken) {
      const existing = await prisma.telegramLink.findFirst({ where: { botId: bot.id, chatId: chat, revokedAt: null } });
      await sendTelegramMessage(bot, chat, existing ? LINKED_OK : `Para vincular, genera el enlace desde Ajustes → Telegram en ${APP_NAME}.`);
      return;
    }
    const nonce = await prisma.telegramLinkNonce.findFirst({
      where: { userId: bot.userId, botId: bot.id, tokenHash: hashToken(rawToken), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!nonce) {
      await sendTelegramMessage(bot, chat, "Este enlace de vinculación ha caducado o ya se ha usado. Genera uno nuevo desde Ajustes.");
      return;
    }
    const occupied = await prisma.telegramLink.findFirst({ where: { botId: bot.id, chatId: chat, revokedAt: null } });
    if (occupied && occupied.userId !== nonce.userId) {
      await sendTelegramMessage(bot, chat, "Este chat ya está vinculado a otra cuenta.");
      return;
    }
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.telegramLinkNonce.updateMany({ where: { id: nonce.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw ApiError.conflict("El enlace ya se ha utilizado.");
      await tx.telegramLink.updateMany({ where: { userId: nonce.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.telegramLink.upsert({
        where: { botId: bot.id },
        create: { userId: nonce.userId, botId: bot.id, chatId: chat, telegramUserId: message.from?.id !== undefined ? String(message.from.id) : null, username: message.from?.username ?? null },
        update: { userId: nonce.userId, chatId: chat, telegramUserId: message.from?.id !== undefined ? String(message.from.id) : null, username: message.from?.username ?? null, revokedAt: null, linkedAt: new Date() },
      });
    });
    await clearTelegramCalenHistory(bot.id, chat);
    await sendTelegramMessage(bot, chat, LINKED_OK);
    return;
  }

  void handleTelegramText(bot, chat, text, senderId).catch((error) => logger.warn({ err: error, telegramBotId: bot.id }, "telegram webhook handler failed"));
}

telegramRouter.use(requireAuth);

// While the admin keeps Telegram off, users cannot set up new bots or links;
// reading status, unlinking and removing a bot stay available.
function requireTelegramEnabled() {
  if (!platformProviderEnabled("TELEGRAM")) throw ApiError.conflict("Telegram no está disponible todavía.");
}

telegramRouter.get("/status", asyncHandler(async (req, res) => {
  const [status, user] = await Promise.all([
    getUserTelegramStatus(req.user!.id),
    prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { notifyTelegramReminders: true } }),
  ]);
  res.json({ ...status, platformEnabled: platformProviderEnabled("TELEGRAM"), notifyTelegramReminders: user.notifyTelegramReminders });
}));

telegramRouter.put("/bot", validate(z.object({ token: z.string().trim().min(20).max(500), replaceExisting: z.boolean().default(false) })), asyncHandler(async (req, res) => {
  requireTelegramEnabled();
  res.json({ bot: await saveUserTelegramBot(req.user!.id, req.body.token, req.body.replaceExisting) });
}));

telegramRouter.delete("/bot", asyncHandler(async (req, res) => {
  await revokeUserTelegramBot(req.user!.id);
  res.json({ ok: true });
}));

telegramRouter.get("/webhook", asyncHandler(async (req, res) => {
  res.json({ webhook: await inspectTelegramWebhook(req.user!.id) });
}));

telegramRouter.post("/bot/webhook", validate(z.object({ replaceExisting: z.boolean().default(false) })), asyncHandler(async (req, res) => {
  requireTelegramEnabled();
  res.json(await activateTelegramWebhook(req.user!.id, req.body.replaceExisting));
}));

telegramRouter.post("/link", asyncHandler(async (req, res) => {
  requireTelegramEnabled();
  const bot = await activeTelegramBot(req.user!.id);
  if (!bot || bot.status !== "ACTIVE") throw ApiError.badRequest("Guarda el bot y activa primero su webhook.");
  if (!bot.username) throw ApiError.badRequest("El bot de Telegram no tiene nombre de usuario.");
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.telegramLinkNonce.create({ data: { userId: req.user!.id, botId: bot.id, tokenHash: hashToken(token), expiresAt } });
  res.json({ deepLink: `https://t.me/${bot.username}?start=${encodeURIComponent(token)}`, botUsername: bot.username, expiresAt: expiresAt.toISOString() });
}));

telegramRouter.post("/unlink", asyncHandler(async (req, res) => {
  const links = await prisma.telegramLink.findMany({ where: { userId: req.user!.id, revokedAt: null }, select: { botId: true, chatId: true } });
  await prisma.telegramLink.updateMany({ where: { userId: req.user!.id, revokedAt: null }, data: { revokedAt: new Date() } });
  for (const link of links) if (link.botId) await clearTelegramCalenHistory(link.botId, link.chatId);
  res.json({ ok: true });
}));

function safeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
