import type {
  ChannelMessageKind,
  ChannelMessageOrigin,
  Conversation,
  MessagingConnection,
  MessagingProvider,
  ScheduledReply,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ApiError } from "../errors.js";
import {
  decryptMessaging,
  decryptMessagingJson,
  encryptMessaging,
  encryptMessagingJson,
  messagingHash,
} from "../messagingCrypto.js";
import { prisma } from "../prisma.js";
import { connectionCanReply, PROVIDER_CAPABILITIES, type ProviderTemplate } from "./providers.js";
import { listWhatsAppTemplates, renderWhatsAppTemplate } from "./whatsapp.js";

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONFIRMATION_REVIEW_MS = 30 * 60 * 1000;
export const MAX_MESSAGE_LENGTH = 4000;

export type IngestedMessage = {
  connection: MessagingConnection;
  externalChatId: string;
  displayName?: string | null;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  origin: ChannelMessageOrigin;
  kind: ChannelMessageKind;
  body?: string | null;
  attachment?: Record<string, unknown> | null;
  mediaHandle?: string | null;
  providerSentAt: Date;
  edited?: boolean;
  replyToProviderMessageId?: string | null;
  /** Imported chat history: never unread and never pauses a pending reply. */
  historical?: boolean;
};

export const MAX_TEMPLATE_PARAMETER_LENGTH = 1024;

export function normalizeMessageBody(value: string): string {
  const text = value.trim();
  if (!text) throw ApiError.validation("Escribe un mensaje.");
  if (text.length > MAX_MESSAGE_LENGTH) throw ApiError.validation(`El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.`);
  return text;
}

export function replyWindowEndsAt(conversation: Pick<Conversation, "lastInboundAt">): Date | null {
  return conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + REPLY_WINDOW_MS) : null;
}

export function assertReplyWindow(conversation: Pick<Conversation, "lastInboundAt">, at = new Date()): Date {
  const endsAt = replyWindowEndsAt(conversation);
  if (!endsAt || endsAt.getTime() <= at.getTime()) {
    throw ApiError.conflict("La ventana de respuesta de 24 horas está cerrada. Conserva el texto y crea un recordatorio.", { code: "OUTSIDE_REPLY_WINDOW" });
  }
  return endsAt;
}

export async function ownedConversation(userId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { connection: true },
  });
  if (!conversation) throw ApiError.notFound("La conversación no existe.");
  return conversation;
}

export async function listPublicConnections(userId: string) {
  const rows = await prisma.messagingConnection.findMany({ where: { userId }, orderBy: [{ provider: "asc" }, { createdAt: "desc" }] });
  return rows.map(publicConnection);
}

export function publicConnection(connection: MessagingConnection) {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    label: connection.labelEnc ? decryptMessaging(connection.labelEnc) : providerLabel(connection.provider),
    lastError: connection.lastError,
    capabilities: { ...PROVIDER_CAPABILITIES[connection.provider], ...(connection.capabilities as object) },
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    revokedAt: connection.revokedAt?.toISOString() ?? null,
    lastWebhookAt: connection.lastWebhookAt?.toISOString() ?? null,
  };
}

export async function ingestProviderMessage(input: IngestedMessage) {
  const chatHash = messagingHash(`${input.connection.provider}:chat`, input.externalChatId);
  let conversation = await prisma.conversation.findUnique({
    where: { connectionId_externalChatIdHash: { connectionId: input.connection.id, externalChatIdHash: chatHash } },
  });
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          userId: input.connection.userId,
          connectionId: input.connection.id,
          externalChatIdEnc: encryptMessaging(input.externalChatId),
          externalChatIdHash: chatHash,
          displayNameEnc: input.displayName ? encryptMessaging(input.displayName.slice(0, 300)) : null,
        },
      });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      conversation = await prisma.conversation.findUniqueOrThrow({
        where: { connectionId_externalChatIdHash: { connectionId: input.connection.id, externalChatIdHash: chatHash } },
      });
    }
  }

  const messageHash = messagingHash(`${input.connection.provider}:message`, input.providerMessageId);
  const existing = await prisma.channelMessage.findUnique({
    where: { conversationId_providerMessageIdHash: { conversationId: conversation.id, providerMessageIdHash: messageHash } },
  });
  if (existing && input.historical) return { conversation, message: existing, created: false };
  if (existing) {
    if (input.edited) {
      const updated = await prisma.channelMessage.update({
        where: { id: existing.id },
        data: {
          bodyEnc: input.body === undefined ? undefined : input.body ? encryptMessaging(input.body.slice(0, MAX_MESSAGE_LENGTH)) : null,
          attachmentEnc: input.attachment === undefined ? undefined : input.attachment ? encryptMessagingJson(input.attachment) : null,
          editedAt: new Date(),
        },
      });
      await pauseForQuotedEdit(updated.id, conversation.id, input.connection.userId);
      return { conversation, message: updated, created: false };
    }
    // A webhook can crash after persisting the message but before pausing a
    // confirmed reply. Replaying the receipt must still apply that safety
    // transition; the activity snapshot keeps older duplicates harmless.
    await pauseForActivity(conversation.id, input.connection.userId, input.providerSentAt);
    return { conversation, message: existing, created: false };
  }

  let replyToMessageId: string | null = null;
  if (input.replyToProviderMessageId) {
    const replyHash = messagingHash(`${input.connection.provider}:message`, input.replyToProviderMessageId);
    replyToMessageId = (await prisma.channelMessage.findUnique({
      where: { conversationId_providerMessageIdHash: { conversationId: conversation.id, providerMessageIdHash: replyHash } },
      select: { id: true },
    }))?.id ?? null;
  }

  let message;
  try {
    message = await prisma.channelMessage.create({
      data: {
        userId: input.connection.userId,
        conversationId: conversation.id,
        providerMessageIdEnc: encryptMessaging(input.providerMessageId),
        providerMessageIdHash: messageHash,
        direction: input.direction,
        origin: input.origin,
        kind: input.kind,
        bodyEnc: input.body ? encryptMessaging(input.body.slice(0, MAX_MESSAGE_LENGTH)) : null,
        attachmentEnc: input.attachment ? encryptMessagingJson(input.attachment) : null,
        mediaHandleEnc: input.mediaHandle ? encryptMessaging(input.mediaHandle) : null,
        deliveryStatus: input.direction === "INBOUND" ? "RECEIVED" : "SENT",
        providerSentAt: input.providerSentAt,
        replyToMessageId,
      },
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    message = await prisma.channelMessage.findUniqueOrThrow({
      where: { conversationId_providerMessageIdHash: { conversationId: conversation.id, providerMessageIdHash: messageHash } },
    });
    return { conversation, message, created: false };
  }

  const nextActivity = maxDate(conversation.lastActivityAt, input.providerSentAt);
  const nextMessage = maxDate(conversation.lastMessageAt, input.providerSentAt);
  const nextInbound = input.direction === "INBOUND" ? maxDate(conversation.lastInboundAt, input.providerSentAt) : conversation.lastInboundAt;
  const nextOutbound = input.direction === "OUTBOUND" ? maxDate(conversation.lastOutboundAt, input.providerSentAt) : conversation.lastOutboundAt;
  conversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      displayNameEnc: input.displayName ? encryptMessaging(input.displayName.slice(0, 300)) : undefined,
      lastMessageAt: nextMessage,
      lastActivityAt: nextActivity,
      lastInboundAt: nextInbound,
      lastOutboundAt: nextOutbound,
      unreadCount: input.direction === "INBOUND" && !input.historical ? { increment: 1 } : undefined,
    },
  });
  await prisma.messagingConnection.update({ where: { id: input.connection.id }, data: { lastWebhookAt: new Date() } });
  if (!input.historical) await pauseForActivity(conversation.id, input.connection.userId, input.providerSentAt);
  return { conversation, message, created: true };
}

export async function prepareScheduledReply(input: {
  userId: string;
  conversationId: string;
  body: string;
  sendAt: Date;
  timezone: string;
  quotedMessageId?: string | null;
  pauseOnActivity?: boolean;
}) {
  const conversation = await ownedConversation(input.userId, input.conversationId);
  if (!connectionCanReply(conversation.connection)) throw ApiError.conflict("La conexión del canal no permite responder.");
  if (input.quotedMessageId) await ownedMessageInConversation(input.userId, input.conversationId, input.quotedMessageId);
  const body = normalizeMessageBody(input.body);
  if (Number.isNaN(input.sendAt.getTime()) || input.sendAt.getTime() < Date.now() - 30_000) throw ApiError.validation("Elige una fecha futura.");
  const windowEnd = replyWindowEndsAt(conversation);
  const outsideWindow = !windowEnd || input.sendAt.getTime() >= windowEnd.getTime();
  return prisma.scheduledReply.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId,
      quotedMessageId: input.quotedMessageId ?? null,
      bodyEnc: encryptMessaging(body),
      sendAt: input.sendAt,
      timezone: input.timezone,
      pauseOnActivity: input.pauseOnActivity ?? true,
      status: "AWAITING_CONFIRMATION",
      confirmationExpiresAt: new Date(Date.now() + CONFIRMATION_REVIEW_MS),
      lastErrorCode: outsideWindow ? "OUTSIDE_REPLY_WINDOW" : null,
      lastErrorEnc: outsideWindow ? encryptMessaging("La fecha queda fuera de la ventana conocida de respuesta.") : null,
    },
  });
}

export async function updatePreparedReply(input: {
  userId: string;
  id: string;
  body?: string;
  sendAt?: Date;
  pauseOnActivity?: boolean;
  quotedMessageId?: string | null;
}) {
  const current = await prisma.scheduledReply.findFirst({ where: { id: input.id, userId: input.userId }, include: { conversation: true } });
  if (!current) throw ApiError.notFound("El borrador no existe.");
  if (["PROCESSING", "SENT", "CANCELED"].includes(current.status)) throw ApiError.conflict("Este envío ya no se puede editar.");
  if (current.templateEnc) throw ApiError.conflict("Una plantilla no se edita. Cancélala y envía otra.");
  if (input.quotedMessageId) await ownedMessageInConversation(input.userId, current.conversationId, input.quotedMessageId);
  const sendAt = input.sendAt ?? current.sendAt;
  if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() - 30_000) throw ApiError.validation("Elige una fecha futura.");
  const windowEnd = replyWindowEndsAt(current.conversation);
  const outsideWindow = !windowEnd || sendAt.getTime() >= windowEnd.getTime();
  return prisma.scheduledReply.update({
    where: { id: current.id },
    data: {
      bodyEnc: input.body === undefined ? undefined : encryptMessaging(normalizeMessageBody(input.body)),
      sendAt: input.sendAt,
      pauseOnActivity: input.pauseOnActivity,
      quotedMessageId: input.quotedMessageId === undefined ? undefined : input.quotedMessageId,
      status: "AWAITING_CONFIRMATION",
      draftVersion: { increment: 1 },
      confirmedVersion: null,
      authorizedAt: null,
      activitySnapshotAt: null,
      idempotencyKeyHash: null,
      confirmationExpiresAt: new Date(Date.now() + CONFIRMATION_REVIEW_MS),
      lastErrorCode: outsideWindow ? "OUTSIDE_REPLY_WINDOW" : null,
      lastErrorEnc: outsideWindow ? encryptMessaging("La fecha queda fuera de la ventana conocida de respuesta.") : null,
    },
  });
}

export async function confirmScheduledReply(userId: string, id: string, expectedVersion: number, idempotencyKey: string) {
  const keyHash = messagingHash("schedule-confirmation", `${userId}:${id}:${idempotencyKey}`);
  const repeated = await prisma.scheduledReply.findFirst({ where: { userId, idempotencyKeyHash: keyHash } });
  if (repeated) return repeated;
  const draft = await prisma.scheduledReply.findFirst({ where: { id, userId }, include: { conversation: { include: { connection: true } } } });
  if (!draft) throw ApiError.notFound("El borrador no existe.");
  if (draft.status !== "AWAITING_CONFIRMATION" || draft.draftVersion !== expectedVersion) {
    throw ApiError.conflict("El borrador cambió. Revísalo antes de confirmar.", { currentVersion: draft.draftVersion });
  }
  if (draft.confirmationExpiresAt && draft.confirmationExpiresAt.getTime() < Date.now()) {
    await prisma.scheduledReply.update({ where: { id: draft.id }, data: { confirmationExpiresAt: new Date(Date.now() + CONFIRMATION_REVIEW_MS) } });
    throw ApiError.conflict("La vista previa había caducado. El texto se conserva; revísalo y confirma de nuevo.");
  }
  if (!connectionCanReply(draft.conversation.connection)) throw ApiError.conflict("La conexión del canal no permite responder.");
  const windowEnd = assertReplyWindow(draft.conversation, draft.sendAt);
  if (draft.sendAt.getTime() > windowEnd.getTime()) throw ApiError.conflict("La fecha queda fuera de la ventana de respuesta.");
  const updated = await prisma.scheduledReply.updateMany({
    where: { id: draft.id, userId, status: "AWAITING_CONFIRMATION", draftVersion: expectedVersion },
    data: {
      status: "SCHEDULED",
      confirmedVersion: expectedVersion,
      authorizedAt: new Date(),
      activitySnapshotAt: draft.conversation.lastActivityAt,
      idempotencyKeyHash: keyHash,
      lastErrorCode: null,
      lastErrorEnc: null,
    },
  });
  if (updated.count !== 1) {
    const concurrent = await prisma.scheduledReply.findFirst({ where: { userId, id, idempotencyKeyHash: keyHash } });
    if (concurrent) return concurrent;
    throw ApiError.conflict("El borrador cambió mientras lo confirmabas.");
  }
  return prisma.scheduledReply.findUniqueOrThrow({ where: { id: draft.id } });
}

export async function queueImmediateReply(input: { userId: string; conversationId: string; body: string; idempotencyKey: string }) {
  const keyHash = messagingHash("immediate-send", `${input.userId}:${input.conversationId}:${input.idempotencyKey}`);
  const repeated = await prisma.scheduledReply.findFirst({ where: { userId: input.userId, idempotencyKeyHash: keyHash } });
  if (repeated) return repeated;
  const conversation = await ownedConversation(input.userId, input.conversationId);
  if (!connectionCanReply(conversation.connection)) throw ApiError.conflict("La conexión del canal no permite responder.");
  assertReplyWindow(conversation);
  try {
    return await prisma.scheduledReply.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        bodyEnc: encryptMessaging(normalizeMessageBody(input.body)),
        sendAt: new Date(),
        timezone: "UTC",
        status: "SCHEDULED",
        draftVersion: 1,
        confirmedVersion: 1,
        pauseOnActivity: false,
        activitySnapshotAt: conversation.lastActivityAt,
        authorizedAt: new Date(),
        idempotencyKeyHash: keyHash,
      },
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const concurrent = await prisma.scheduledReply.findFirst({ where: { userId: input.userId, conversationId: input.conversationId, idempotencyKeyHash: keyHash } });
    if (concurrent) return concurrent;
    throw error;
  }
}

/**
 * Queues an approved WhatsApp template. It is the only kind of message Meta
 * accepts once the 24-hour customer service window has closed.
 */
export async function queueTemplateReply(input: {
  userId: string;
  conversationId: string;
  name: string;
  language: string;
  parameters: string[];
  idempotencyKey: string;
}) {
  const keyHash = messagingHash("template-send", `${input.userId}:${input.conversationId}:${input.idempotencyKey}`);
  const repeated = await prisma.scheduledReply.findFirst({ where: { userId: input.userId, idempotencyKeyHash: keyHash } });
  if (repeated) return repeated;
  const conversation = await ownedConversation(input.userId, input.conversationId);
  if (conversation.connection.provider !== "WHATSAPP") throw ApiError.validation("Las plantillas solo existen en WhatsApp.");
  if (!connectionCanReply(conversation.connection)) throw ApiError.conflict("La conexión del canal no permite responder.");
  const template = (await listWhatsAppTemplates(conversation.connection))
    .find((item) => item.name === input.name && item.language === input.language);
  if (!template) throw ApiError.validation("La plantilla no existe, no está aprobada o no es compatible.");
  const parameters = input.parameters.map((value) => value.trim());
  if (parameters.length !== template.parameterCount) throw ApiError.validation(`La plantilla necesita ${template.parameterCount} valores.`);
  if (parameters.some((value) => !value || value.length > MAX_TEMPLATE_PARAMETER_LENGTH || /[\n\t]|\s{5,}/.test(value))) {
    throw ApiError.validation("Cada valor debe tener texto, sin saltos de línea ni tabuladores.");
  }
  const payload: ProviderTemplate = { name: template.name, language: template.language, parameters };
  try {
    return await prisma.scheduledReply.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        bodyEnc: encryptMessaging(renderWhatsAppTemplate(template, parameters).slice(0, MAX_MESSAGE_LENGTH)),
        templateEnc: encryptMessagingJson(payload),
        sendAt: new Date(),
        timezone: "UTC",
        status: "SCHEDULED",
        draftVersion: 1,
        confirmedVersion: 1,
        pauseOnActivity: false,
        activitySnapshotAt: conversation.lastActivityAt,
        authorizedAt: new Date(),
        idempotencyKeyHash: keyHash,
      },
    });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const concurrent = await prisma.scheduledReply.findFirst({ where: { userId: input.userId, conversationId: input.conversationId, idempotencyKeyHash: keyHash } });
    if (concurrent) return concurrent;
    throw error;
  }
}

export async function cancelScheduledReply(userId: string, id: string) {
  const result = await prisma.scheduledReply.updateMany({
    where: { id, userId, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION", "FAILED"] } },
    data: { status: "CANCELED", leaseUntil: null, claimTokenHash: null },
  });
  if (!result.count) throw ApiError.conflict("El envío ya no se puede cancelar.");
  return prisma.scheduledReply.findUniqueOrThrow({ where: { id } });
}

export function publicScheduledReply(reply: ScheduledReply, context?: {
  provider?: MessagingProvider;
  recipient?: string;
  accountLabel?: string;
  lastInboundAt?: Date | null;
  canReply?: boolean;
}) {
  const windowEnd = context?.lastInboundAt ? new Date(context.lastInboundAt.getTime() + REPLY_WINDOW_MS) : null;
  return {
    id: reply.id,
    conversationId: reply.conversationId,
    quotedMessageId: reply.quotedMessageId,
    body: decryptMessaging(reply.bodyEnc),
    sendAt: reply.sendAt.toISOString(),
    timezone: reply.timezone,
    status: reply.status,
    draftVersion: reply.draftVersion,
    confirmedVersion: reply.confirmedVersion,
    pauseOnActivity: reply.pauseOnActivity,
    isTemplate: Boolean(reply.templateEnc),
    provider: context?.provider,
    recipient: context?.recipient,
    accountLabel: context?.accountLabel,
    replyWindowEndsAt: windowEnd?.toISOString() ?? null,
    canConfirm: reply.status === "AWAITING_CONFIRMATION" && Boolean(context?.canReply && windowEnd && reply.sendAt.getTime() < windowEnd.getTime()),
    errorCode: reply.lastErrorCode,
    error: reply.lastErrorEnc ? decryptMessaging(reply.lastErrorEnc) : null,
    createdAt: reply.createdAt.toISOString(),
    updatedAt: reply.updatedAt.toISOString(),
  };
}

export async function publicScheduledReplyById(userId: string, id: string) {
  const row = await prisma.scheduledReply.findFirst({
    where: { id, userId },
    include: { conversation: { include: { connection: true } } },
  });
  if (!row) throw ApiError.notFound("El envío programado no existe.");
  return publicScheduledReply(row, {
    provider: row.conversation.connection.provider,
    recipient: row.conversation.displayNameEnc ? decryptMessaging(row.conversation.displayNameEnc) : "Contacto",
    accountLabel: row.conversation.connection.labelEnc ? decryptMessaging(row.conversation.connection.labelEnc) : providerLabel(row.conversation.connection.provider),
    lastInboundAt: row.conversation.lastInboundAt,
    canReply: connectionCanReply(row.conversation.connection),
  });
}

export async function ownedMessageInConversation(userId: string, conversationId: string, messageId: string) {
  const message = await prisma.channelMessage.findFirst({ where: { id: messageId, userId, conversationId } });
  if (!message) throw ApiError.notFound("El mensaje no existe.");
  return message;
}

async function pauseForActivity(conversationId: string, userId: string, at: Date) {
  const result = await prisma.scheduledReply.updateMany({
    where: {
      conversationId,
      userId,
      status: "SCHEDULED",
      pauseOnActivity: true,
      OR: [{ activitySnapshotAt: null }, { activitySnapshotAt: { lte: at } }],
    },
    data: { status: "PAUSED", lastErrorCode: "NEW_ACTIVITY", lastErrorEnc: encryptMessaging("Hubo actividad nueva en la conversación después de confirmar.") },
  });
  if (result.count) await createAttentionNotification(userId, conversationId, "Envío pausado", "Hay actividad nueva en la conversación. Revisa el borrador antes de enviarlo.");
}

async function pauseForQuotedEdit(messageId: string, conversationId: string, userId: string) {
  const result = await prisma.scheduledReply.updateMany({
    where: { conversationId, userId, quotedMessageId: messageId, status: "SCHEDULED", pauseOnActivity: true },
    data: { status: "PAUSED", lastErrorCode: "QUOTED_MESSAGE_EDITED", lastErrorEnc: encryptMessaging("El mensaje citado cambió después de confirmar.") },
  });
  if (result.count) await createAttentionNotification(userId, conversationId, "Envío pausado", "El mensaje citado cambió. Revisa el borrador antes de enviarlo.");
}

export async function createAttentionNotification(userId: string, conversationId: string, title: string, body: string) {
  const actionUrl = `/inbox?conversation=${encodeURIComponent(conversationId)}&view=attention`;
  const existing = await prisma.notification.findFirst({ where: { userId, actionUrl, read: false }, select: { id: true } });
  if (!existing) await prisma.notification.create({ data: { userId, type: "SYSTEM", title, body, actionUrl } });
}

function maxDate(a: Date | null, b: Date): Date {
  return !a || b.getTime() > a.getTime() ? b : a;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function providerLabel(provider: MessagingProvider): string {
  return provider === "TELEGRAM" ? "Telegram Business" : "WhatsApp Business";
}
