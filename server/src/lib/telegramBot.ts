import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { decryptSecret } from "./crypto.js";
import { sendTelegramMessage, getTelegramUpdates } from "./telegram.js";
import { runMascotReply } from "./mascot/talk.js";

type TUpdate = {
  update_id: number;
  message?: { chat?: { id?: number }; text?: string };
};

// offset por usuario (en memoria: suficiente para un solo proceso).
const offsets = new Map<string, number>();

function botSend(token: string, chatId: number, text: string): Promise<boolean> {
  return sendTelegramMessage(token, String(chatId), text);
}

/** Procesa un usuario: lee sus updates y responde a cada mensaje entrante. */
async function processUser(userId: string, token: string): Promise<void> {
  const offset = offsets.get(userId) ?? 0;
  const updates = (await getTelegramUpdates(token, offset, 15)) as TUpdate[];
  let next = offset;
  for (const u of updates) {
    if (u.update_id >= next) next = u.update_id + 1;
    const text = u.message?.text;
    const chatId = u.message?.chat?.id;
    if (!text || chatId === undefined || chatId <= 0) continue;
    const reply = await runMascotReply(userId, text);
    if (reply) await botSend(token, chatId, reply);
  }
  offsets.set(userId, next);
}

/** Barrido: procesa el bot de cada usuario con token configurado. */
async function pollOnce(): Promise<void> {
  const rows = await prisma.user.findMany({
    where: { telegramBotTokenEnc: { not: null } },
    select: { id: true, telegramBotTokenEnc: true },
  });
  for (const r of rows) {
    let token: string;
    try {
      token = decryptSecret(r.telegramBotTokenEnc!);
    } catch {
      continue; // token no descifrable (otro APP_SECRET); se ignora
    }
    try {
      await processUser(r.id, token);
    } catch (err) {
      logger.warn({ err, userId: r.id }, "telegram bot poll failed");
    }
  }
}

export function startTelegramBotScheduler(): void {
  setInterval(() => { void pollOnce().catch((e) => logger.warn({ err: e }, "telegram poll scheduler error")); }, 8000);
  void pollOnce();
}