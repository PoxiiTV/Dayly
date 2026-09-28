import { ApiError } from "./errors.js";
import { logger } from "./logger.js";
import { decryptMessagingJson, encryptMessagingJson } from "./messagingCrypto.js";
import { prisma } from "./prisma.js";
import { runMascotTurn, type MascotUserMessage } from "./mascot/chat.js";
import { sendTelegramChatAction, sendTelegramMessage } from "./telegram.js";
import { APP_NAME } from "./brand.js";
import type { TelegramBot } from "@prisma/client";

const HELP = `Soy Kalen. Escríbeme en lenguaje natural y lo apunto en tu agenda.

Ejemplos:
• compra leche
• recuérdame mañana a las 9 la reunión
• qué tengo hoy
• apunta la idea de renovar el sofá

Comandos: /help · /stop para desvincular.`;

const HISTORY_MAX = 8;
// Longer than any assistant turn; a crashed turn frees the chat on its own.
const BUSY_MS = 2 * 60_000;

/** Forgets the conversation memory of one chat (link, relink or /stop). */
export async function clearTelegramCalenHistory(botId: string, chatId: string) {
  await prisma.telegramAssistantSession.deleteMany({ where: { botId, chatId } });
}

/**
 * Claims the chat for one turn across every server instance. Returns the
 * stored history, or null when another turn is still running.
 */
async function claimSession(botId: string, chatId: string): Promise<{ id: string; history: MascotUserMessage[] } | null> {
  const session = await prisma.telegramAssistantSession.upsert({
    where: { botId_chatId: { botId, chatId } },
    create: { botId, chatId },
    update: {},
  });
  const now = new Date();
  const claimed = await prisma.telegramAssistantSession.updateMany({
    where: { id: session.id, OR: [{ busyUntil: null }, { busyUntil: { lt: now } }] },
    data: { busyUntil: new Date(now.getTime() + BUSY_MS) },
  });
  if (claimed.count !== 1) return null;
  return { id: session.id, history: decryptMessagingJson<MascotUserMessage[]>(session.historyEnc, []) };
}

function parseCommand(text: string): { cmd: string; rest: string } | null {
  const match = text.match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { cmd: match[1].toLowerCase(), rest: (match[2] ?? "").trim() };
}

export async function handleTelegramText(bot: TelegramBot, chatId: string, text: string, senderId = chatId): Promise<"handled" | "start"> {
  const command = parseCommand(text);
  if (command?.cmd === "start") return "start";
  if (command?.cmd === "stop") {
    await prisma.telegramLink.updateMany({ where: { botId: bot.id, chatId, revokedAt: null }, data: { revokedAt: new Date() } });
    await clearTelegramCalenHistory(bot.id, chatId);
    await sendTelegramMessage(bot, chatId, "Telegram desvinculado de tu agenda.");
    return "handled";
  }
  if (command?.cmd === "help") {
    await sendTelegramMessage(bot, chatId, HELP);
    return "handled";
  }
  if (command) {
    await sendTelegramMessage(bot, chatId, `No conozco /${command.cmd}.\n\n${HELP}`);
    return "handled";
  }

  const link = await prisma.telegramLink.findFirst({ where: { botId: bot.id, chatId, revokedAt: null }, select: { userId: true, telegramUserId: true } });
  if (!link || (link.telegramUserId && link.telegramUserId !== senderId)) {
    await sendTelegramMessage(bot, chatId, `Este chat no está vinculado. Ábrelo desde Ajustes → Telegram en ${APP_NAME}.`);
    return "handled";
  }

  const session = await claimSession(bot.id, chatId);
  if (!session) {
    await sendTelegramMessage(bot, chatId, "Un segundo, estoy con el mensaje anterior.");
    return "handled";
  }

  let history = session.history;
  try {
    await sendTelegramChatAction(bot, chatId);
    const next: MascotUserMessage[] = [...history, { role: "user" as const, content: text.slice(0, 4000) }].slice(-HISTORY_MAX);
    const out = await runMascotTurn({
      userId: link.userId,
      messages: next,
      channel: "telegram",
      sessionId: `kalendiario:telegram:${bot.id}:${chatId}`,
    });
    history = [...next, { role: "assistant" as const, content: out.reply.slice(0, 4000) }].slice(-HISTORY_MAX);
    await sendTelegramMessage(bot, chatId, out.reply);
  } catch (err) {
    logger.warn({ err }, "telegram calen failed");
    const message = err instanceof ApiError
      ? err.message
      : "No he podido completar eso ahora. Prueba otra vez en un momento.";
    await sendTelegramMessage(bot, chatId, message);
  } finally {
    await prisma.telegramAssistantSession.updateMany({
      where: { id: session.id },
      data: { busyUntil: null, historyEnc: encryptMessagingJson(history) },
    });
  }
  return "handled";
}
