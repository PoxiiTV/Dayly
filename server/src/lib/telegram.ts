import { Prisma, type TelegramBot } from "@prisma/client";
import { config } from "../config/env.js";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "./crypto.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { platformProviderEnabled } from "./integrationSettings.js";

type TelegramResolved = { id: string; token: string; username: string | null; webhookSecret: string; routingToken: string };
type TelegramMe = { id: number; username?: string; first_name?: string; can_connect_to_business?: boolean };
type WebhookInfo = { url?: string; pending_update_count?: number; last_error_message?: string };

export class TelegramRequestError extends Error {
  constructor(message: string, public readonly ambiguous: boolean, public readonly status?: number) {
    super(message);
    this.name = "TelegramRequestError";
  }
}

function resolveBot(row: TelegramBot): TelegramResolved {
  return {
    id: row.id,
    token: decryptSecret(row.tokenEnc),
    username: row.username,
    webhookSecret: decryptSecret(row.webhookSecretEnc),
    routingToken: decryptSecret(row.routingTokenEnc),
  };
}

export async function activeTelegramBot(userId: string): Promise<TelegramBot | null> {
  return prisma.telegramBot.findFirst({ where: { userId, status: { in: ["ACTIVE", "PENDING", "ERROR"] } }, orderBy: { createdAt: "desc" } });
}

export async function telegramBotByRoute(routeToken: string): Promise<TelegramBot | null> {
  if (!routeToken) return null;
  return prisma.telegramBot.findFirst({ where: { routingTokenHash: hashToken(routeToken), status: { not: "REVOKED" } } });
}

async function callTelegramToken<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TelegramRequestError("No se pudo confirmar la respuesta de Telegram.", true);
  }
  const payload = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new TelegramRequestError(payload.description || "Telegram rechazó la operación.", response.status >= 500, response.status);
  }
  return payload.result;
}

export async function callTelegram<T>(bot: TelegramBot, method: string, body: Record<string, unknown>): Promise<T> {
  return callTelegramToken<T>(resolveBot(bot).token, method, body);
}

export async function sendTelegramMessage(bot: TelegramBot, chatId: string, text: string): Promise<void> {
  const trimmed = text.trim() || "…";
  for (let i = 0; i < trimmed.length; i += 4000) {
    await callTelegram(bot, "sendMessage", { chat_id: chatId, text: trimmed.slice(i, i + 4000), disable_web_page_preview: true });
  }
}

export async function sendTelegramBusinessMessage(bot: TelegramBot, businessConnectionId: string, chatId: string, text: string) {
  return callTelegram<{ message_id: number; date: number }>(bot, "sendMessage", {
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    text: text.trim(),
    disable_web_page_preview: true,
  });
}

export async function getTelegramFile(bot: TelegramBot, fileId: string) {
  const resolved = resolveBot(bot);
  const file = await callTelegram<{ file_path?: string; file_size?: number }>(bot, "getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramRequestError("Telegram ya no conserva este archivo.", false, 404);
  return { ...file, url: `https://api.telegram.org/file/bot${resolved.token}/${file.file_path}` };
}

export async function sendTelegramChatAction(bot: TelegramBot, chatId: string): Promise<void> {
  try { await callTelegram(bot, "sendChatAction", { chat_id: chatId, action: "typing" }); } catch { /* opcional */ }
}

export async function deliverTelegram(userId: string, text: string, dedupeKey: string): Promise<boolean> {
  if (!platformProviderEnabled("TELEGRAM")) return false;
  const bot = await activeTelegramBot(userId);
  if (!bot || bot.status !== "ACTIVE") return false;
  const link = await prisma.telegramLink.findFirst({ where: { userId, botId: bot.id, revokedAt: null }, select: { chatId: true } });
  if (!link) return false;
  try {
    await prisma.alertDelivery.create({ data: { userId, channel: "TELEGRAM", dedupeKey } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
  try {
    await sendTelegramMessage(bot, link.chatId, text);
    return true;
  } catch (error) {
    await prisma.alertDelivery.deleteMany({ where: { userId, channel: "TELEGRAM", dedupeKey } });
    throw error;
  }
}

export async function saveUserTelegramBot(userId: string, tokenInput: string, replaceExisting = false) {
  const token = tokenInput.trim();
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(token)) throw ApiError.badRequest("El token del bot no tiene un formato válido.");
  let me: TelegramMe;
  try { me = await callTelegramToken<TelegramMe>(token, "getMe", {}); }
  catch (error) {
    if (error instanceof TelegramRequestError) throw ApiError.badRequest(error.message);
    throw error;
  }
  const telegramBotId = String(me.id);
  const claimed = await prisma.telegramBot.findUnique({ where: { telegramBotId } });
  if (claimed && claimed.userId !== userId) throw ApiError.conflict("Ese bot ya pertenece a otra cuenta.", { reason: "BOT_CLAIMED" });

  const current = await activeTelegramBot(userId);
  if (current?.telegramBotId === telegramBotId) {
    const updated = await prisma.telegramBot.update({
      where: { id: current.id },
      data: { tokenEnc: encryptSecret(token), username: me.username ?? null, firstName: me.first_name?.slice(0, 120) ?? null, businessCapable: Boolean(me.can_connect_to_business), lastError: null },
    });
    return publicTelegramBot(updated);
  }
  if (current && !replaceExisting) {
    throw ApiError.conflict("Ya tienes otro bot conectado. Confirma que quieres sustituirlo y revocar sus vínculos.", {
      reason: "REPLACE_REQUIRED",
      currentUsername: current.username,
      nextUsername: me.username ?? null,
    });
  }

  const routingToken = randomToken(24);
  const webhookSecret = randomToken(24);
  let created: TelegramBot;
  try {
    created = await prisma.$transaction(async (tx) => {
      const previous = await tx.telegramBot.findMany({ where: { userId, status: { not: "REVOKED" } }, select: { id: true } });
      const previousIds = previous.map(({ id }) => id);
      await tx.telegramLink.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      const connections = await tx.messagingConnection.findMany({ where: { userId, provider: "TELEGRAM", status: { not: "REVOKED" } }, select: { id: true } });
      const connectionIds = connections.map(({ id }) => id);
      if (connectionIds.length) {
        await tx.scheduledReply.updateMany({
          where: { userId, conversation: { connectionId: { in: connectionIds } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
          data: { status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" },
        });
        await tx.messagingConnection.updateMany({ where: { id: { in: connectionIds } }, data: { status: "REVOKED", revokedAt: new Date(), credentialEnc: null } });
      }
      if (previousIds.length) {
        await tx.telegramBot.updateMany({ where: { id: { in: previousIds } }, data: { status: "REVOKED", tokenEnc: "" } });
      }
      const data = {
        userId,
        telegramBotId,
        tokenEnc: encryptSecret(token),
        username: me.username ?? null,
        firstName: me.first_name?.slice(0, 120) ?? null,
        businessCapable: Boolean(me.can_connect_to_business),
        routingTokenHash: hashToken(routingToken),
        routingTokenEnc: encryptSecret(routingToken),
        webhookSecretEnc: encryptSecret(webhookSecret),
        status: "PENDING",
        webhookVerifiedAt: null,
        lastError: null,
      } as const;
      return claimed
        ? tx.telegramBot.update({ where: { id: claimed.id }, data })
        : tx.telegramBot.create({ data });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw ApiError.conflict("El bot se está conectando en otra cuenta u operación. Vuelve a intentarlo.");
    }
    throw error;
  }
  return publicTelegramBot(created);
}

export async function inspectTelegramWebhook(userId: string) {
  const bot = await activeTelegramBot(userId);
  if (!bot) throw ApiError.notFound("Configura primero tu bot de Telegram.");
  return publicWebhookInfo(bot, await callTelegram<WebhookInfo>(bot, "getWebhookInfo", {}));
}

export async function activateTelegramWebhook(userId: string, replaceExisting = false) {
  const bot = await activeTelegramBot(userId);
  if (!bot) throw ApiError.notFound("Configura primero tu bot de Telegram.");
  const resolved = resolveBot(bot);
  const expectedUrl = `${config.publicUrl.replace(/\/$/, "")}/api/telegram/webhook/${encodeURIComponent(resolved.routingToken)}`;
  const existing = await callTelegram<WebhookInfo>(bot, "getWebhookInfo", {});
  if (existing.url && existing.url !== expectedUrl && !replaceExisting) {
    throw ApiError.conflict("El bot ya tiene un webhook distinto. Confirma que quieres sustituirlo.", { existingHost: safeWebhookHost(existing.url) });
  }
  await callTelegram(bot, "setWebhook", {
    url: expectedUrl,
    secret_token: resolved.webhookSecret,
    allowed_updates: ["message", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"],
  });
  const verified = await callTelegram<WebhookInfo>(bot, "getWebhookInfo", {});
  if (verified.url !== expectedUrl) throw ApiError.badRequest("Telegram no confirmó el nuevo webhook.");
  const updated = await prisma.telegramBot.update({
    where: { id: bot.id },
    data: { status: "ACTIVE", webhookVerifiedAt: new Date(), lastError: verified.last_error_message?.slice(0, 300) ?? null },
  });
  if (updated.username) {
    await prisma.telegramSetting.updateMany({
      where: { id: 1, botUsername: updated.username },
      data: { botTokenEnc: null, webhookSecretEnc: null },
    });
  }
  return { bot: publicTelegramBot(updated), webhook: publicWebhookInfo(updated, verified) };
}

export async function revokeUserTelegramBot(userId: string) {
  const bot = await activeTelegramBot(userId);
  if (!bot) return false;
  try { await callTelegram(bot, "deleteWebhook", { drop_pending_updates: false }); } catch { /* la revocación local prevalece */ }
  await prisma.$transaction([
    prisma.telegramLink.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.telegramBot.update({ where: { id: bot.id }, data: { status: "REVOKED", tokenEnc: "" } }),
    prisma.messagingConnection.updateMany({ where: { userId, provider: "TELEGRAM", status: { not: "REVOKED" } }, data: { status: "REVOKED", revokedAt: new Date(), credentialEnc: null } }),
    prisma.scheduledReply.updateMany({
      where: { userId, conversation: { connection: { provider: "TELEGRAM" } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
      data: { status: "CANCELED", lastErrorCode: "CONNECTION_REVOKED" },
    }),
  ]);
  return true;
}

export async function getUserTelegramStatus(userId: string) {
  const bot = await activeTelegramBot(userId);
  const link = bot ? await prisma.telegramLink.findFirst({ where: { userId, botId: bot.id, revokedAt: null } }) : null;
  return {
    configured: Boolean(bot),
    bot: bot ? publicTelegramBot(bot) : null,
    linked: Boolean(link),
    username: link?.username ?? null,
    linkedAt: link?.linkedAt.toISOString() ?? null,
  };
}

export function telegramWebhookSecret(bot: TelegramBot): string {
  return resolveBot(bot).webhookSecret;
}

export function publicTelegramBot(bot: TelegramBot) {
  return {
    id: bot.id,
    username: bot.username,
    firstName: bot.firstName,
    status: bot.status,
    businessCapable: bot.businessCapable,
    webhookVerifiedAt: bot.webhookVerifiedAt?.toISOString() ?? null,
    lastError: bot.lastError,
  };
}

function publicWebhookInfo(bot: TelegramBot, info: WebhookInfo) {
  const expected = `${config.publicUrl.replace(/\/$/, "")}/api/telegram/webhook/${encodeURIComponent(resolveBot(bot).routingToken)}`;
  return {
    configured: Boolean(info.url),
    owned: info.url === expected,
    host: info.url ? safeWebhookHost(info.url) : null,
    pendingUpdates: info.pending_update_count ?? 0,
    lastError: info.last_error_message ?? null,
  };
}

function safeWebhookHost(value: string): string | null {
  try { return new URL(value).host; } catch { return null; }
}
