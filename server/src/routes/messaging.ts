import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma, type MessagingProvider, type ScheduledReplyStatus } from "@prisma/client";
import { audit } from "../middleware/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { decryptMessaging, decryptMessagingJson } from "../lib/messagingCrypto.js";
import { connectionCanReply, fetchProviderMedia, ProviderSendError } from "../lib/messaging/providers.js";
import {
  cancelScheduledReply,
  confirmScheduledReply,
  listPublicConnections,
  ownedConversation,
  ownedMessageInConversation,
  prepareScheduledReply,
  publicScheduledReply,
  publicScheduledReplyById,
  queueImmediateReply,
  queueTemplateReply,
  replyWindowEndsAt,
  updatePreparedReply,
} from "../lib/messaging/service.js";
import { logWebhookProcessingFailure, processWhatsAppWebhook, type WhatsAppWebhook } from "../lib/messaging/webhooks.js";
import {
  completeWhatsAppEmbeddedSignup,
  listWhatsAppTemplates,
  releaseWhatsAppConnection,
  verifyWhatsAppChallenge,
  verifyWhatsAppSignature,
  whatsappPublicConfig,
} from "../lib/messaging/whatsapp.js";
import { prisma } from "../lib/prisma.js";
import { activeTelegramBot } from "../lib/telegram.js";
import { getTelegramPlatformSettings, getWhatsAppPlatformConfig } from "../lib/integrationSettings.js";

export const messagingRouter = Router();

function boundedLimit(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : fallback;
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : fallback;
}

const idempotencyKey = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const messageBody = z.string().trim().min(1).max(4000);

messagingRouter.get("/whatsapp/webhook", asyncHandler(async (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (!await verifyWhatsAppChallenge(mode, token)) throw ApiError.forbidden("Webhook no autorizado.");
  res.type("text/plain").send(challenge);
}));

messagingRouter.post("/whatsapp/webhook", asyncHandler(async (req, res) => {
  const rawBody = req.rawBody;
  const signature = String(req.headers["x-hub-signature-256"] ?? "");
  if (!rawBody || !await verifyWhatsAppSignature(rawBody, signature)) throw ApiError.forbidden("Webhook no autorizado.");
  if (!(await getWhatsAppPlatformConfig()).enabled) return res.json({ ok: true });
  const eventKey = createHash("sha256").update(rawBody).digest("hex");
  try {
    await processWhatsAppWebhook(req.body as WhatsAppWebhook, eventKey);
  } catch (error) {
    logWebhookProcessingFailure("WHATSAPP", error);
    throw ApiError.internal("No se pudo procesar el evento de WhatsApp.");
  }
  res.json({ ok: true });
}));

messagingRouter.use(requireAuth);

messagingRouter.get("/connections", asyncHandler(async (req, res) => {
  const telegramBot = await activeTelegramBot(req.user!.id);
  const [connections, telegramLink, telegramPlatform, whatsapp] = await Promise.all([
    listPublicConnections(req.user!.id),
    telegramBot
      ? prisma.telegramLink.findFirst({ where: { userId: req.user!.id, botId: telegramBot.id, revokedAt: null }, select: { username: true, linkedAt: true } })
      : null,
    getTelegramPlatformSettings(),
    whatsappPublicConfig(),
  ]);
  res.json({
    connections,
    availability: {
      telegram: { enabled: telegramPlatform.enabled, configured: Boolean(telegramBot), linkedToKalen: Boolean(telegramLink), username: telegramLink?.username ?? null },
      whatsapp,
    },
  });
}));

messagingRouter.get("/whatsapp/config", asyncHandler(async (_req, res) => {
  res.json(await whatsappPublicConfig());
}));

messagingRouter.post(
  "/whatsapp/connect",
  validate(z.object({
    code: z.string().trim().min(8).max(2048),
    phoneNumberId: z.string().trim().min(1).max(80).regex(/^\d+$/),
    wabaId: z.string().trim().min(1).max(80).regex(/^\d+$/),
  })),
  asyncHandler(async (req, res) => {
    const connection = await completeWhatsAppEmbeddedSignup({ userId: req.user!.id, ...req.body });
    await audit(req, "messaging.whatsapp.connect", { entityType: "messaging_connection", entityId: connection.id, metadata: { provider: "WHATSAPP" } });
    res.status(201).json({ connection: (await listPublicConnections(req.user!.id)).find((item) => item.id === connection.id) });
  }),
);

messagingRouter.post("/connections/:id/disconnect", asyncHandler(async (req, res) => {
  const connection = await prisma.messagingConnection.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!connection) throw ApiError.notFound("La conexión no existe.");
  if (connection.status === "ACTIVE") await releaseWhatsAppConnection(connection);
  await prisma.$transaction([
    prisma.messagingConnection.update({
      where: { id: connection.id },
      data: { status: "REVOKED", revokedAt: new Date(), disconnectedByUserAt: new Date(), credentialEnc: null },
    }),
    prisma.scheduledReply.updateMany({
      where: { userId: req.user!.id, conversation: { connectionId: connection.id }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
      data: { status: "CANCELED", lastErrorCode: "CONNECTION_REVOKED" },
    }),
  ]);
  await audit(req, "messaging.connection.disconnect", { entityType: "messaging_connection", entityId: connection.id, metadata: { provider: connection.provider } });
  res.json({ ok: true });
}));

messagingRouter.delete(
  "/connections/:id/data",
  validate(z.object({ confirmation: z.literal("BORRAR") })),
  asyncHandler(async (req, res) => {
    const connection = await prisma.messagingConnection.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!connection) throw ApiError.notFound("La conexión no existe.");
    if (connection.status === "ACTIVE") throw ApiError.conflict("Desconecta el canal antes de borrar su copia local.");
    await audit(req, "messaging.connection.delete_local", { entityType: "messaging_connection", entityId: connection.id, metadata: { provider: connection.provider } });
    await prisma.messagingConnection.delete({ where: { id: connection.id } });
    res.json({ ok: true });
  }),
);

messagingRouter.get("/conversations", asyncHandler(async (req, res) => {
  const provider = String(req.query.provider ?? "").toUpperCase();
  const view = String(req.query.view ?? "all");
  const limit = boundedLimit(req.query.limit, 50);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const attentionStatuses: ScheduledReplyStatus[] = ["PAUSED", "REQUIRES_ATTENTION", "FAILED"];
  const where: Prisma.ConversationWhereInput = {
    userId: req.user!.id,
    ...(provider === "TELEGRAM" || provider === "WHATSAPP" ? { connection: { provider: provider as MessagingProvider } } : {}),
    ...(view === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(view === "scheduled" ? { scheduledReplies: { some: { status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED"] } } } } : {}),
    ...(view === "attention" ? { scheduledReplies: { some: { status: { in: attentionStatuses } } } } : {}),
  };
  const rows = await prisma.conversation.findMany({
    where,
    include: {
      connection: true,
      messages: { orderBy: [{ providerSentAt: "desc" }, { id: "desc" }], take: 1 },
      scheduledReplies: { where: { status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", ...attentionStatuses] } }, select: { status: true } },
    },
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({
    conversations: page.map((row) => {
      const last = row.messages[0];
      const windowEnd = replyWindowEndsAt(row);
      return {
        id: row.id,
        provider: row.connection.provider,
        accountLabel: row.connection.labelEnc ? decryptMessaging(row.connection.labelEnc) : row.connection.provider,
        displayName: row.displayNameEnc ? decryptMessaging(row.displayNameEnc) : "Contacto",
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
        replyWindowEndsAt: windowEnd?.toISOString() ?? null,
        canReply: Boolean(windowEnd && windowEnd.getTime() > Date.now() && connectionCanReply(row.connection)),
        unreadCount: row.unreadCount,
        preview: last?.providerDeletedAt ? "Mensaje eliminado" : last?.bodyEnc ? decryptMessaging(last.bodyEnc) : last ? mediaLabel(last.kind) : "Sin mensajes",
        lastDirection: last?.direction ?? null,
        scheduledCount: row.scheduledReplies.filter((item) => ["AWAITING_CONFIRMATION", "SCHEDULED"].includes(item.status)).length,
        attentionCount: row.scheduledReplies.filter((item) => attentionStatuses.includes(item.status as typeof attentionStatuses[number])).length,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}));

messagingRouter.get("/conversations/:id/messages", asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user!.id, req.params.id);
  const limit = boundedLimit(req.query.limit, 60);
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  const rows = await prisma.channelMessage.findMany({
    where: { conversationId: conversation.id, userId: req.user!.id, ...(before ? { providerSentAt: { lt: before } } : {}) },
    orderBy: [{ providerSentAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  res.json({
    conversation: {
      id: conversation.id,
      provider: conversation.connection.provider,
      accountLabel: conversation.connection.labelEnc ? decryptMessaging(conversation.connection.labelEnc) : conversation.connection.provider,
      displayName: conversation.displayNameEnc ? decryptMessaging(conversation.displayNameEnc) : "Contacto",
      lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
      replyWindowEndsAt: replyWindowEndsAt(conversation)?.toISOString() ?? null,
    },
    messages: page.map(publicMessage),
    nextBefore: hasMore ? page[0]?.providerSentAt.toISOString() ?? null : null,
  });
}));

messagingRouter.post("/conversations/:id/read", asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user!.id, req.params.id);
  await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
  res.json({ ok: true, providerReceiptSent: false });
}));

messagingRouter.post(
  "/conversations/:id/messages",
  validate(z.object({ body: messageBody, idempotencyKey })),
  asyncHandler(async (req, res) => {
    const queued = await queueImmediateReply({ userId: req.user!.id, conversationId: req.params.id, body: req.body.body, idempotencyKey: req.body.idempotencyKey });
    await audit(req, "messaging.message.queue", { entityType: "scheduled_reply", entityId: queued.id, metadata: { immediate: true } });
    res.status(202).json({ scheduledReply: await publicScheduledReplyById(req.user!.id, queued.id) });
  }),
);

messagingRouter.get("/conversations/:id/templates", asyncHandler(async (req, res) => {
  const conversation = await ownedConversation(req.user!.id, req.params.id);
  if (conversation.connection.provider !== "WHATSAPP") return res.json({ templates: [] });
  if (!connectionCanReply(conversation.connection)) throw ApiError.conflict("La conexión del canal no permite responder.");
  res.json({ templates: await listWhatsAppTemplates(conversation.connection) });
}));

messagingRouter.post(
  "/conversations/:id/template",
  validate(z.object({
    name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/),
    language: z.string().trim().min(2).max(15).regex(/^[A-Za-z_]+$/),
    parameters: z.array(z.string().max(1024)).max(20).default([]),
    idempotencyKey,
  })),
  asyncHandler(async (req, res) => {
    const queued = await queueTemplateReply({ userId: req.user!.id, conversationId: req.params.id, ...req.body });
    await audit(req, "messaging.template.queue", { entityType: "scheduled_reply", entityId: queued.id, metadata: { template: req.body.name } });
    res.status(202).json({ scheduledReply: await publicScheduledReplyById(req.user!.id, queued.id) });
  }),
);

messagingRouter.get("/messages/:id/media", asyncHandler(async (req, res) => {
  const message = await prisma.channelMessage.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { conversation: { include: { connection: true } } },
  });
  if (!message || !message.mediaHandleEnc) throw ApiError.notFound("El archivo ya no está disponible.");
  const metadata = decryptMessagingJson<{ mimeType?: string; filename?: string }>(message.attachmentEnc, {});
  let file;
  try {
    file = await fetchProviderMedia(message.conversation.connection, decryptMessaging(message.mediaHandleEnc), metadata);
  } catch (error) {
    if (!(error instanceof ProviderSendError)) throw error;
    if (error.code === "MEDIA_TOO_LARGE") throw ApiError.badRequest(error.message);
    if (error.code === "MEDIA_TYPE_BLOCKED") throw ApiError.badRequest(error.message);
    throw ApiError.notFound(error.message);
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.body);
}));

messagingRouter.post(
  "/conversations/:id/reminders",
  validate(z.object({ title: z.string().trim().min(1).max(300), remindAt: z.string().datetime(), messageId: z.string().trim().min(1).max(191).nullish() })),
  asyncHandler(async (req, res) => {
    const conversation = await ownedConversation(req.user!.id, req.params.id);
    if (req.body.messageId) await ownedMessageInConversation(req.user!.id, conversation.id, req.body.messageId);
    const reminder = await prisma.reminder.create({
      data: {
        userId: req.user!.id,
        title: req.body.title,
        remindAt: new Date(req.body.remindAt),
        targetType: "CONVERSATION",
        targetId: null,
        conversationId: conversation.id,
        messageId: req.body.messageId ?? null,
      },
    });
    await audit(req, "messaging.reminder.create", { entityType: "reminder", entityId: reminder.id, metadata: { source: "conversation" } });
    res.status(201).json({ reminder });
  }),
);

messagingRouter.get("/scheduled-replies", asyncHandler(async (req, res) => {
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : undefined;
  const rows = await prisma.scheduledReply.findMany({
    where: { userId: req.user!.id, ...(conversationId ? { conversationId } : {}) },
    include: { conversation: { include: { connection: true } } },
    orderBy: [{ sendAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json({ scheduledReplies: rows.map((row) => publicScheduledReply(row, scheduledContext(row))) });
}));

messagingRouter.post(
  "/scheduled-replies",
  validate(z.object({ conversationId: z.string().min(1).max(191), body: messageBody, sendAt: z.string().datetime(), timezone: z.string().min(1).max(80), quotedMessageId: z.string().min(1).max(191).nullish(), pauseOnActivity: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const reply = await prepareScheduledReply({ userId: req.user!.id, ...req.body, sendAt: new Date(req.body.sendAt) });
    await audit(req, "messaging.reply.prepare", { entityType: "scheduled_reply", entityId: reply.id });
    res.status(201).json({ scheduledReply: await publicScheduledReplyById(req.user!.id, reply.id) });
  }),
);

messagingRouter.patch(
  "/scheduled-replies/:id",
  validate(z.object({ body: messageBody.optional(), sendAt: z.string().datetime().optional(), pauseOnActivity: z.boolean().optional(), quotedMessageId: z.string().min(1).max(191).nullable().optional() }).refine((body) => Object.keys(body).length > 0, "No hay cambios.")),
  asyncHandler(async (req, res) => {
    const reply = await updatePreparedReply({ userId: req.user!.id, id: req.params.id, ...req.body, sendAt: req.body.sendAt ? new Date(req.body.sendAt) : undefined });
    await audit(req, "messaging.reply.update", { entityType: "scheduled_reply", entityId: reply.id });
    res.json({ scheduledReply: await publicScheduledReplyById(req.user!.id, reply.id) });
  }),
);

messagingRouter.post(
  "/scheduled-replies/:id/confirm",
  validate(z.object({ expectedVersion: z.number().int().positive(), idempotencyKey })),
  asyncHandler(async (req, res) => {
    const reply = await confirmScheduledReply(req.user!.id, req.params.id, req.body.expectedVersion, req.body.idempotencyKey);
    await audit(req, "messaging.reply.confirm", { entityType: "scheduled_reply", entityId: reply.id, metadata: { version: req.body.expectedVersion } });
    res.json({ scheduledReply: await publicScheduledReplyById(req.user!.id, reply.id) });
  }),
);

messagingRouter.post("/scheduled-replies/:id/cancel", asyncHandler(async (req, res) => {
  const reply = await cancelScheduledReply(req.user!.id, req.params.id);
  await audit(req, "messaging.reply.cancel", { entityType: "scheduled_reply", entityId: reply.id });
  res.json({ scheduledReply: await publicScheduledReplyById(req.user!.id, reply.id) });
}));

function publicMessage(message: {
  id: string;
  direction: string;
  origin: string;
  kind: string;
  bodyEnc: string | null;
  attachmentEnc: string | null;
  mediaHandleEnc: string | null;
  deliveryStatus: string;
  providerSentAt: Date;
  editedAt: Date | null;
  providerDeletedAt: Date | null;
  replyToMessageId: string | null;
}) {
  return {
    id: message.id,
    direction: message.direction,
    origin: message.origin,
    kind: message.kind,
    body: message.providerDeletedAt ? "Mensaje eliminado" : message.bodyEnc ? decryptMessaging(message.bodyEnc) : mediaLabel(message.kind),
    attachment: message.attachmentEnc ? decryptMessagingJson(message.attachmentEnc, null) : null,
    hasMedia: Boolean(message.mediaHandleEnc && !message.providerDeletedAt),
    deliveryStatus: message.deliveryStatus,
    providerSentAt: message.providerSentAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.providerDeletedAt?.toISOString() ?? null,
    replyToMessageId: message.replyToMessageId,
  };
}

function scheduledContext(row: {
  conversation: {
    displayNameEnc: string | null;
    lastInboundAt: Date | null;
    connection: { provider: "TELEGRAM" | "WHATSAPP"; status: "PENDING" | "ACTIVE" | "REVOKED" | "ERROR"; labelEnc: string | null; capabilities: Prisma.JsonValue };
  };
}) {
  return {
    provider: row.conversation.connection.provider,
    recipient: row.conversation.displayNameEnc ? decryptMessaging(row.conversation.displayNameEnc) : "Contacto",
    accountLabel: row.conversation.connection.labelEnc ? decryptMessaging(row.conversation.connection.labelEnc) : row.conversation.connection.provider,
    lastInboundAt: row.conversation.lastInboundAt,
    canReply: connectionCanReply(row.conversation.connection),
  };
}

function mediaLabel(kind: string): string {
  return ({ IMAGE: "Imagen", AUDIO: "Audio", VIDEO: "Vídeo", DOCUMENT: "Documento", LOCATION: "Ubicación", CONTACT: "Contacto", STICKER: "Sticker" } as Record<string, string>)[kind] || "Contenido no compatible";
}
