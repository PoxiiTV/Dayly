import type { ChannelMessageKind, MessagingConnection, TelegramBot } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "../logger.js";
import { encryptMessaging, encryptMessagingJson, messagingHash } from "../messagingCrypto.js";
import { prisma } from "../prisma.js";
import { PROVIDER_CAPABILITIES } from "./providers.js";
import { createAttentionNotification, ingestProviderMessage } from "./service.js";

type TelegramUser = { id?: number | string; username?: string; first_name?: string; last_name?: string };
type TelegramChat = { id?: number | string; username?: string; first_name?: string; last_name?: string; title?: string; type?: string };
type TelegramMessage = {
  message_id?: number;
  date?: number;
  edit_date?: number;
  business_connection_id?: string;
  from?: TelegramUser;
  sender_business_bot?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
  audio?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id?: string; mime_type?: string; file_size?: number };
  video?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  sticker?: { file_id?: string; emoji?: string; file_size?: number };
  location?: { latitude?: number; longitude?: number };
  contact?: { phone_number?: string; first_name?: string; last_name?: string };
};

export type TelegramBusinessUpdate = {
  update_id?: number;
  business_connection?: {
    id?: string;
    user?: TelegramUser;
    user_chat_id?: number | string;
    date?: number;
    rights?: { can_reply?: boolean; can_read_messages?: boolean };
    is_enabled?: boolean;
  };
  business_message?: TelegramMessage;
  edited_business_message?: TelegramMessage;
  deleted_business_messages?: { business_connection_id?: string; chat?: TelegramChat; message_ids?: number[] };
};

export async function processTelegramBusinessUpdate(update: TelegramBusinessUpdate, bot: TelegramBot): Promise<boolean> {
  if (update.business_connection) return processTelegramConnection(update, bot);
  if (update.business_message || update.edited_business_message) return processTelegramMessage(update, bot);
  if (update.deleted_business_messages) return processTelegramDeleted(update, bot);
  return false;
}

async function processTelegramConnection(update: TelegramBusinessUpdate, bot: TelegramBot): Promise<boolean> {
  const business = update.business_connection!;
  const accountId = business.id?.trim();
  const ownerId = business.user?.id;
  if (!accountId || ownerId === undefined) return false;
  const link = await prisma.telegramLink.findFirst({ where: { botId: bot.id, telegramUserId: String(ownerId), revokedAt: null } });
  if (!link) return false;
  const label = telegramOwnerLabel(business.user);
  const accountHash = messagingHash("TELEGRAM:account", `${bot.id}:${accountId}`);
  const ownerHash = messagingHash("TELEGRAM:owner", String(ownerId));
  const status = business.is_enabled === false ? "REVOKED" : "ACTIVE";
  const existing = await connectionByExternalId("TELEGRAM", accountId, bot.id);
  if (existing && existing.userId !== link.userId) return false;
  const receiptKey = `bot:${bot.id}:update:${update.update_id ?? JSON.stringify(update)}`;
  // A disconnect made in the app sticks: rights or profile updates for the
  // same business connection must not reactivate it. Only a connection
  // established again in Telegram (a newer date) does.
  const establishedAt = business.date !== undefined ? new Date(business.date * 1000) : null;
  if (existing?.disconnectedByUserAt && status === "ACTIVE" && (!establishedAt || establishedAt.getTime() <= existing.disconnectedByUserAt.getTime())) {
    const receipt = await persistReceipt(existing, "TELEGRAM", receiptKey, update);
    if (receipt) await markReceiptProcessed(receipt.id);
    return true;
  }
  let connection: MessagingConnection;
  if (existing) {
    connection = await prisma.$transaction(async (tx) => {
      if (status === "ACTIVE") {
        const previous = await tx.messagingConnection.findMany({ where: { userId: link.userId, provider: "TELEGRAM", telegramBotId: bot.id, id: { not: existing.id }, status: { not: "REVOKED" } }, select: { id: true } });
        const previousIds = previous.map(({ id }) => id);
        if (previousIds.length) {
          await tx.scheduledReply.updateMany({ where: { userId: link.userId, conversation: { connectionId: { in: previousIds } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } }, data: { status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" } });
          await tx.messagingConnection.updateMany({ where: { id: { in: previousIds } }, data: { status: "REVOKED", revokedAt: new Date() } });
        }
      }
      return tx.messagingConnection.update({
        where: { id: existing.id },
        data: {
        status,
        ownerExternalIdEnc: encryptMessaging(String(ownerId)),
        ownerExternalIdHash: ownerHash,
        labelEnc: encryptMessaging(label),
        providerDataEnc: encryptMessagingJson({ userChatId: business.user_chat_id !== undefined ? String(business.user_chat_id) : null }),
        capabilities: { ...PROVIDER_CAPABILITIES.TELEGRAM, sendText: Boolean(business.rights?.can_reply) },
        lastError: null,
        connectedAt: status === "ACTIVE" ? new Date((business.date ?? Math.floor(Date.now() / 1000)) * 1000) : undefined,
        revokedAt: status === "REVOKED" ? new Date() : null,
        disconnectedByUserAt: status === "ACTIVE" ? null : undefined,
        lastWebhookAt: new Date(),
        },
      });
    });
  } else {
    connection = await prisma.$transaction(async (tx) => {
      const previous = status === "ACTIVE" ? await tx.messagingConnection.findMany({
        where: { userId: link.userId, provider: "TELEGRAM", telegramBotId: bot.id, status: { not: "REVOKED" } },
        select: { id: true },
      }) : [];
      const previousIds = previous.map(({ id }) => id);
      if (previousIds.length) {
        await tx.scheduledReply.updateMany({
          where: { userId: link.userId, conversation: { connectionId: { in: previousIds } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
          data: { status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" },
        });
        await tx.messagingConnection.updateMany({ where: { id: { in: previousIds } }, data: { status: "REVOKED", revokedAt: new Date() } });
      }
      return tx.messagingConnection.create({ data: {
      userId: link.userId,
      provider: "TELEGRAM",
      telegramBotId: bot.id,
      status,
      externalAccountIdEnc: encryptMessaging(accountId),
      externalAccountIdHash: accountHash,
      ownerExternalIdEnc: encryptMessaging(String(ownerId)),
      ownerExternalIdHash: ownerHash,
      labelEnc: encryptMessaging(label),
      providerDataEnc: encryptMessagingJson({ userChatId: business.user_chat_id !== undefined ? String(business.user_chat_id) : null }),
      capabilities: { ...PROVIDER_CAPABILITIES.TELEGRAM, sendText: Boolean(business.rights?.can_reply) },
      lastError: null,
      connectedAt: new Date((business.date ?? Math.floor(Date.now() / 1000)) * 1000),
      revokedAt: status === "REVOKED" ? new Date() : null,
      lastWebhookAt: new Date(),
      } });
    });
  }
  const receipt = await persistReceipt(connection, "TELEGRAM", receiptKey, update);
  if (!receipt) return true;
  if (status === "REVOKED") {
    await prisma.scheduledReply.updateMany({
      where: { userId: link.userId, conversation: { connectionId: connection.id }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED"] } },
      data: { status: "CANCELED", lastErrorCode: "CONNECTION_REVOKED", lastErrorEnc: encryptMessaging("La conexión de Telegram fue revocada.") },
    });
  }
  await markReceiptProcessed(receipt.id);
  return true;
}

async function processTelegramMessage(update: TelegramBusinessUpdate, bot: TelegramBot): Promise<boolean> {
  const message = update.business_message ?? update.edited_business_message!;
  const accountId = message.business_connection_id?.trim();
  if (!accountId || message.message_id === undefined || message.chat?.id === undefined) return false;
  const connection = await connectionByExternalId("TELEGRAM", accountId, bot.id);
  if (!connection || connection.status !== "ACTIVE") return false;
  const receipt = await persistReceipt(connection, "TELEGRAM", `bot:${bot.id}:update:${update.update_id ?? `${accountId}:${message.chat.id}:${message.message_id}:${message.edit_date ?? message.date}`}`, update);
  if (!receipt) return true;
  try {
    const senderId = message.from?.id !== undefined ? String(message.from.id) : "";
    const isOwner = Boolean(senderId && connection.ownerExternalIdHash === messagingHash("TELEGRAM:owner", senderId));
    const parsed = telegramContent(message);
    await ingestProviderMessage({
      connection,
      externalChatId: String(message.chat.id),
      displayName: telegramChatLabel(message.chat),
      providerMessageId: String(message.message_id),
      direction: isOwner || message.sender_business_bot ? "OUTBOUND" : "INBOUND",
      origin: message.sender_business_bot ? "API" : isOwner ? "OWNER_DEVICE" : "CUSTOMER",
      kind: parsed.kind,
      body: parsed.body,
      attachment: parsed.attachment,
      mediaHandle: parsed.mediaHandle,
      providerSentAt: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000),
      edited: Boolean(update.edited_business_message),
      replyToProviderMessageId: message.reply_to_message?.message_id !== undefined ? String(message.reply_to_message.message_id) : null,
    });
    await markReceiptProcessed(receipt.id);
  } catch (error) {
    await markReceiptFailed(receipt.id, "PROCESSING_FAILED");
    throw error;
  }
  return true;
}

async function processTelegramDeleted(update: TelegramBusinessUpdate, bot: TelegramBot): Promise<boolean> {
  const deleted = update.deleted_business_messages!;
  const accountId = deleted.business_connection_id?.trim();
  if (!accountId || deleted.chat?.id === undefined || !deleted.message_ids?.length) return false;
  const connection = await connectionByExternalId("TELEGRAM", accountId, bot.id);
  if (!connection) return false;
  const receipt = await persistReceipt(connection, "TELEGRAM", `bot:${bot.id}:update:${update.update_id ?? JSON.stringify(update)}`, update);
  if (!receipt) return true;
  const conversation = await prisma.conversation.findUnique({
    where: { connectionId_externalChatIdHash: { connectionId: connection.id, externalChatIdHash: messagingHash("TELEGRAM:chat", String(deleted.chat.id)) } },
  });
  if (conversation) {
    const hashes = deleted.message_ids.map((id) => messagingHash("TELEGRAM:message", String(id)));
    const messages = await prisma.channelMessage.findMany({ where: { conversationId: conversation.id, providerMessageIdHash: { in: hashes } }, select: { id: true } });
    await prisma.channelMessage.updateMany({ where: { id: { in: messages.map((m) => m.id) } }, data: { providerDeletedAt: new Date() } });
    if (messages.length) {
      const paused = await prisma.scheduledReply.updateMany({
        where: { userId: connection.userId, quotedMessageId: { in: messages.map((m) => m.id) }, status: "SCHEDULED", pauseOnActivity: true },
        data: { status: "PAUSED", lastErrorCode: "QUOTED_MESSAGE_DELETED", lastErrorEnc: encryptMessaging("El mensaje citado se eliminó después de confirmar.") },
      });
      if (paused.count) await createAttentionNotification(connection.userId, conversation.id, "Envío pausado", "El mensaje citado fue eliminado. Revisa el borrador.");
    }
  }
  await markReceiptProcessed(receipt.id);
  return true;
}

export type WhatsAppWebhook = {
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WhatsAppValue }> }>;
};

type WhatsAppValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WhatsAppMessage[];
  message_echoes?: WhatsAppMessage[];
  smb_message_echoes?: WhatsAppMessage[];
  statuses?: Array<{ id?: string; recipient_id?: string; timestamp?: string; status?: string; errors?: Array<{ code?: number }> }>;
  history?: Array<{
    errors?: Array<{ code?: number }>;
    threads?: Array<{ id?: string; messages?: Array<WhatsAppMessage & { history_context?: { status?: string } }> }>;
  }>;
  state_sync?: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>;
};
type WhatsAppMessage = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  document?: WhatsAppMedia & { filename?: string };
  sticker?: WhatsAppMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  context?: { id?: string };
};
type WhatsAppMedia = { id?: string; mime_type?: string; sha256?: string; caption?: string; file_size?: number };

export async function processWhatsAppWebhook(payload: WhatsAppWebhook, eventKey: string): Promise<boolean> {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
  const byPhone = new Map<string, typeof changes>();
  for (const change of changes) {
    const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
    if (!phoneNumberId) continue;
    const group = byPhone.get(phoneNumberId) ?? [];
    group.push(change);
    byPhone.set(phoneNumberId, group);
  }
  let handled = false;
  for (const [phoneNumberId, phoneChanges] of byPhone) {
    const connection = await connectionByExternalId("WHATSAPP", phoneNumberId);
    if (!connection || connection.status !== "ACTIVE") continue;
    handled = true;
    const receiptPayload: WhatsAppWebhook = { entry: [{ changes: phoneChanges }] };
    const receipt = await persistReceipt(connection, "WHATSAPP", `${eventKey}:${phoneNumberId}`, receiptPayload);
    if (!receipt) continue;
    try {
      for (const change of phoneChanges) {
      const value = change.value ?? {};
      const names = new Map((value.contacts ?? []).filter((c) => c.wa_id).map((c) => [c.wa_id!, c.profile?.name || c.wa_id!]));
      for (const message of value.messages ?? []) await ingestWhatsAppMessage(connection, message, "INBOUND", names.get(message.from || ""));
      for (const message of [...(value.message_echoes ?? []), ...(value.smb_message_echoes ?? [])]) {
        await ingestWhatsAppMessage(connection, message, "OUTBOUND", names.get(message.to || message.from || ""), "OWNER_DEVICE");
      }
      for (const status of value.statuses ?? []) await applyWhatsAppStatus(connection, status);
      for (const chunk of value.history ?? []) await ingestWhatsAppHistory(connection, chunk);
      for (const item of value.state_sync ?? []) await applyWhatsAppContact(connection, item);
      }
      await markReceiptProcessed(receipt.id);
    } catch (error) {
      await markReceiptFailed(receipt.id, "PROCESSING_FAILED");
      throw error;
    }
  }
  return handled;
}

async function ingestWhatsAppMessage(
  connection: MessagingConnection,
  message: WhatsAppMessage,
  direction: "INBOUND" | "OUTBOUND",
  displayName?: string,
  origin: "CUSTOMER" | "OWNER_DEVICE" | "API" = "CUSTOMER",
) {
  const id = message.id?.trim();
  const chatId = direction === "INBOUND" ? message.from : message.to || message.from;
  if (!id || !chatId) return;
  const parsed = whatsappContent(message);
  await ingestProviderMessage({
    connection,
    externalChatId: chatId,
    displayName: displayName || chatId,
    providerMessageId: id,
    direction,
    origin,
    kind: parsed.kind,
    body: parsed.body,
    attachment: parsed.attachment,
    mediaHandle: parsed.mediaHandle,
    providerSentAt: new Date(Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000),
    replyToProviderMessageId: message.context?.id,
  });
}

async function applyWhatsAppStatus(connection: MessagingConnection, status: NonNullable<WhatsAppValue["statuses"]>[number]) {
  if (!status.id || !status.recipient_id) return;
  const conversation = await prisma.conversation.findUnique({
    where: { connectionId_externalChatIdHash: { connectionId: connection.id, externalChatIdHash: messagingHash("WHATSAPP:chat", status.recipient_id) } },
  });
  if (!conversation) return;
  const delivery = ({ sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const)[status.status as "sent" | "delivered" | "read" | "failed"] ?? "UNKNOWN";
  const where = { conversationId: conversation.id, providerMessageIdHash: messagingHash("WHATSAPP:message", status.id) };
  if (delivery !== "FAILED") {
    // Statuses can arrive out of order; never downgrade a failure or a read.
    const order = { UNKNOWN: 0, PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;
    const lower = (Object.keys(order) as Array<keyof typeof order>).filter((key) => order[key] < order[delivery]);
    await prisma.channelMessage.updateMany({ where: { ...where, deliveryStatus: { in: lower } }, data: { deliveryStatus: delivery } });
    return;
  }
  const failed = await prisma.channelMessage.updateMany({ where: { ...where, deliveryStatus: { not: "FAILED" } }, data: { deliveryStatus: "FAILED" } });
  if (failed.count) {
    await createAttentionNotification(connection.userId, conversation.id, "WhatsApp no entregó el mensaje", whatsappFailureText(status.errors?.[0]?.code));
  }
}

function whatsappFailureText(code?: number): string {
  if (code === 131047) return "Pasaron más de 24 horas desde el último mensaje del contacto. Usa una plantilla aprobada.";
  if (code === 131026) return "El destinatario no puede recibir el mensaje (número sin WhatsApp o versión antigua).";
  if (code === 131049 || code === 131048) return "Meta limitó el envío para proteger la calidad de la cuenta. Inténtalo más tarde.";
  return "El mensaje salió pero WhatsApp informó de que no se pudo entregar.";
}

async function ingestWhatsAppHistory(connection: MessagingConnection, chunk: NonNullable<WhatsAppValue["history"]>[number]) {
  for (const thread of chunk.threads ?? []) {
    const chatId = thread.id?.trim();
    if (!chatId) continue;
    for (const message of thread.messages ?? []) {
      const id = message.id?.trim();
      if (!id) continue;
      const inbound = message.from === chatId;
      const parsed = whatsappContent(message);
      await ingestProviderMessage({
        connection,
        externalChatId: chatId,
        displayName: null,
        providerMessageId: id,
        direction: inbound ? "INBOUND" : "OUTBOUND",
        origin: inbound ? "CUSTOMER" : "OWNER_DEVICE",
        kind: parsed.kind,
        body: parsed.body,
        attachment: parsed.attachment,
        mediaHandle: parsed.mediaHandle,
        providerSentAt: new Date(Number(message.timestamp || 0) * 1000 || Date.now()),
        replyToProviderMessageId: message.context?.id,
        historical: true,
      });
    }
  }
}

async function applyWhatsAppContact(connection: MessagingConnection, item: NonNullable<WhatsAppValue["state_sync"]>[number]) {
  if (item.type !== "contact" || item.action === "remove") return;
  const phone = item.contact?.phone_number?.replace(/\D/g, "");
  const name = (item.contact?.full_name || item.contact?.first_name || "").trim();
  if (!phone || !name) return;
  await prisma.conversation.updateMany({
    where: { connectionId: connection.id, externalChatIdHash: messagingHash("WHATSAPP:chat", phone) },
    data: { displayNameEnc: encryptMessaging(name.slice(0, 300)) },
  });
}

async function connectionByExternalId(provider: "TELEGRAM" | "WHATSAPP", id: string, telegramBotId?: string) {
  const scopedId = provider === "TELEGRAM" ? `${telegramBotId ?? ""}:${id}` : id;
  return prisma.messagingConnection.findFirst({
    where: { provider, externalAccountIdHash: messagingHash(`${provider}:account`, scopedId), ...(provider === "TELEGRAM" ? { telegramBotId } : {}) },
  });
}

async function persistReceipt(connection: MessagingConnection, provider: "TELEGRAM" | "WHATSAPP", key: string, payload: unknown) {
  const eventKeyHash = messagingHash(`${provider}:webhook`, key);
  const existing = await prisma.webhookReceipt.findUnique({ where: { eventKeyHash } });
  if (existing) {
    if (existing.status === "PROCESSED") return null;
    return reclaimReceipt(existing.id, payload);
  }
  try {
    return await prisma.webhookReceipt.create({
      data: {
        userId: connection.userId,
        connectionId: connection.id,
        provider,
        eventKeyHash,
        payloadEnc: encryptMessagingJson(payload),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.webhookReceipt.findUnique({ where: { eventKeyHash } });
      if (!raced || raced.status === "PROCESSED") return null;
      return reclaimReceipt(raced.id, payload);
    }
    throw error;
  }
}

async function reclaimReceipt(id: string, payload: unknown) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 2 * 60_000);
  const claimed = await prisma.webhookReceipt.updateMany({
    where: {
      id,
      OR: [
        { status: "FAILED" },
        { status: "RECEIVED", receivedAt: { lte: staleBefore } },
      ],
    },
    data: { status: "RECEIVED", errorCode: null, processedAt: null, receivedAt: now, payloadEnc: encryptMessagingJson(payload) },
  });
  if (claimed.count !== 1) return null;
  return prisma.webhookReceipt.findUniqueOrThrow({ where: { id } });
}

async function markReceiptProcessed(id: string) {
  await prisma.webhookReceipt.update({ where: { id }, data: { status: "PROCESSED", processedAt: new Date(), errorCode: null } });
}

async function markReceiptFailed(id: string, errorCode: string) {
  await prisma.webhookReceipt.update({ where: { id }, data: { status: "FAILED", processedAt: new Date(), errorCode } });
}

function telegramContent(message: TelegramMessage) {
  if (message.text) return { kind: "TEXT" as const, body: message.text };
  const caption = message.caption ?? null;
  if (message.photo?.length) {
    const item = message.photo[message.photo.length - 1]!;
    return mediaContent("IMAGE", item.file_id, caption, { mimeType: "image/jpeg", sizeBytes: item.file_size });
  }
  if (message.audio) return mediaContent("AUDIO", message.audio.file_id, caption, message.audio);
  if (message.voice) return mediaContent("AUDIO", message.voice.file_id, caption, { ...message.voice, filename: "nota-de-voz.ogg" });
  if (message.video) return mediaContent("VIDEO", message.video.file_id, caption, message.video);
  if (message.document) return mediaContent("DOCUMENT", message.document.file_id, caption, message.document);
  if (message.sticker) return mediaContent("STICKER", message.sticker.file_id, message.sticker.emoji ?? null, { ...message.sticker, mimeType: "image/webp", filename: "sticker.webp" });
  if (message.location) return { kind: "LOCATION" as const, body: "Ubicación compartida", attachment: message.location, mediaHandle: null };
  if (message.contact) return { kind: "CONTACT" as const, body: "Contacto compartido", attachment: { firstName: message.contact.first_name, lastName: message.contact.last_name }, mediaHandle: null };
  return { kind: "UNKNOWN" as const, body: "Contenido no compatible", attachment: null, mediaHandle: null };
}

function whatsappContent(message: WhatsAppMessage) {
  if (message.type === "text" && message.text?.body) return { kind: "TEXT" as const, body: message.text.body, attachment: null, mediaHandle: null };
  const type = message.type ?? "unknown";
  const media = message.image ?? message.audio ?? message.video ?? message.document ?? message.sticker;
  if (media) {
    const kinds: Record<string, ChannelMessageKind> = { image: "IMAGE", audio: "AUDIO", video: "VIDEO", document: "DOCUMENT", sticker: "STICKER" };
    return mediaContent(kinds[type] ?? "UNKNOWN", media.id, media.caption ?? null, { mimeType: media.mime_type, sizeBytes: media.file_size, filename: message.document?.filename });
  }
  if (message.location) return { kind: "LOCATION" as const, body: message.location.name || "Ubicación compartida", attachment: message.location, mediaHandle: null };
  if (message.contacts?.length) return { kind: "CONTACT" as const, body: "Contacto compartido", attachment: { count: message.contacts.length }, mediaHandle: null };
  return { kind: "UNKNOWN" as const, body: `Contenido ${type}`, attachment: null, mediaHandle: null };
}

function mediaContent(kind: ChannelMessageKind, handle: string | undefined, body: string | null, raw: Record<string, unknown>) {
  return {
    kind,
    body: body || `Archivo ${kind.toLocaleLowerCase("es")}`,
    attachment: {
      mimeType: typeof raw.mime_type === "string" ? raw.mime_type : typeof raw.mimeType === "string" ? raw.mimeType : undefined,
      filename: typeof raw.file_name === "string" ? raw.file_name : typeof raw.filename === "string" ? raw.filename : undefined,
      sizeBytes: typeof raw.file_size === "number" ? raw.file_size : typeof raw.sizeBytes === "number" ? raw.sizeBytes : undefined,
    },
    mediaHandle: handle ?? null,
  };
}

function telegramOwnerLabel(user?: TelegramUser) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return user?.username ? `Telegram · @${user.username}` : name ? `Telegram · ${name}` : "Telegram Business";
}

function telegramChatLabel(chat?: TelegramChat) {
  const name = chat?.title || [chat?.first_name, chat?.last_name].filter(Boolean).join(" ").trim();
  return name || (chat?.username ? `@${chat.username}` : "Contacto de Telegram");
}

export function logWebhookProcessingFailure(provider: string, error: unknown) {
  logger.warn({ err: error, provider }, "Business messaging webhook processing failed");
}
