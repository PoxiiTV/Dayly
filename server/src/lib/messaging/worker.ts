import { hashToken, randomToken } from "../crypto.js";
import { logger } from "../logger.js";
import { decryptMessaging, decryptMessagingJson, encryptMessaging, messagingHash } from "../messagingCrypto.js";
import { prisma } from "../prisma.js";
import { providerEnabled, ProviderSendError, sendProviderText, type ProviderTemplate } from "./providers.js";
import { assertReplyWindow, createAttentionNotification } from "./service.js";

const POLL_MS = 5_000;
const MAX_LATENESS_MS = 5 * 60_000;
const LEASE_MS = 2 * 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60_000;

let running = false;
let lastRetentionAt = 0;

export function startMessagingWorker() {
  if (process.env.NODE_ENV === "test") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await tickMessagingWorker();
    } catch (error) {
      logger.warn({ err: error }, "Messaging worker tick failed");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref();
}

export async function tickMessagingWorker(now = new Date()) {
  const staleCutoff = new Date(now.getTime() - MAX_LATENESS_MS);
  const interrupted = await prisma.scheduledReply.findMany({
    where: { status: "PROCESSING", leaseUntil: { lt: now } },
    select: { id: true, userId: true, conversationId: true },
    take: 50,
  });
  for (const row of interrupted) {
    const changed = await prisma.scheduledReply.updateMany({
      where: { id: row.id, status: "PROCESSING", leaseUntil: { lt: now } },
      data: {
        status: "REQUIRES_ATTENTION",
        lastErrorCode: "WORKER_INTERRUPTED",
        lastErrorEnc: encryptMessaging("El proceso se interrumpió después de iniciar el intento. No se reintentará automáticamente para evitar duplicados."),
        claimTokenHash: null,
        leaseUntil: null,
      },
    });
    if (changed.count) await createAttentionNotification(row.userId, row.conversationId, "Envío sin confirmar", "Revisa el envío: el proceso se interrumpió y no se reintentó para evitar duplicados.");
  }

  const late = await prisma.scheduledReply.findMany({
    where: { status: "SCHEDULED", sendAt: { lt: staleCutoff } },
    select: { id: true, userId: true, conversationId: true },
    take: 100,
  });
  for (const row of late) {
    const changed = await prisma.scheduledReply.updateMany({
      where: { id: row.id, status: "SCHEDULED", sendAt: { lt: staleCutoff } },
      data: { status: "REQUIRES_ATTENTION", lastErrorCode: "TOO_LATE", lastErrorEnc: encryptMessaging("El envío lleva más de cinco minutos vencido y no se ha enviado.") },
    });
    if (changed.count) await createAttentionNotification(row.userId, row.conversationId, "Envío vencido", "No se envió porque llevaba más de cinco minutos pendiente.");
  }

  const due = await prisma.scheduledReply.findMany({
    where: { status: "SCHEDULED", sendAt: { gte: staleCutoff, lte: now } },
    orderBy: { sendAt: "asc" },
    select: { id: true },
    take: 25,
  });
  for (const row of due) await processScheduledReply(row.id, now);

  if (now.getTime() - lastRetentionAt > 60 * 60_000) {
    await purgeMessagingRetention(now);
    lastRetentionAt = now.getTime();
  }
}

export async function processScheduledReply(id: string, now = new Date()) {
  const claimToken = randomToken(24);
  const claimTokenHash = hashToken(claimToken);
  const claimed = await prisma.scheduledReply.updateMany({
    where: { id, status: "SCHEDULED", sendAt: { lte: now, gte: new Date(now.getTime() - MAX_LATENESS_MS) } },
    data: { status: "PROCESSING", claimTokenHash, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return null;

  const reply = await prisma.scheduledReply.findUniqueOrThrow({
    where: { id },
    include: { conversation: { include: { connection: true } }, user: { select: { status: true } }, quotedMessage: { select: { editedAt: true } } },
  });
  const attention = async (code: string, message: string, status: "PAUSED" | "REQUIRES_ATTENTION" | "FAILED" = "REQUIRES_ATTENTION") => {
    await prisma.scheduledReply.updateMany({
      where: { id, status: "PROCESSING", claimTokenHash },
      data: { status, lastErrorCode: code, lastErrorEnc: encryptMessaging(message), claimTokenHash: null, leaseUntil: null },
    });
    await createAttentionNotification(reply.userId, reply.conversationId, status === "PAUSED" ? "Envío pausado" : "Envío requiere atención", message);
    return null;
  };

  if (reply.user.status !== "ACTIVE") return attention("USER_INACTIVE", "La cuenta no está activa.", "PAUSED");
  if (reply.conversation.connection.status !== "ACTIVE") return attention("CONNECTION_INACTIVE", "La conexión del canal ya no está activa.", "PAUSED");
  if (!providerEnabled(reply.conversation.connection.provider)) return attention("PROVIDER_DISABLED", "El canal está pausado por el administrador.", "PAUSED");
  if ((reply.conversation.connection.capabilities as { sendText?: boolean } | null)?.sendText === false) {
    return attention("MISSING_REPLY_PERMISSION", "La conexión ya no tiene permiso para responder mensajes.", "PAUSED");
  }
  if (reply.pauseOnActivity && reply.activitySnapshotAt && reply.conversation.lastActivityAt && reply.conversation.lastActivityAt.getTime() > reply.activitySnapshotAt.getTime()) {
    return attention("NEW_ACTIVITY", "Hubo actividad nueva después de confirmar. Revisa el borrador.", "PAUSED");
  }
  if (reply.pauseOnActivity && reply.quotedMessage?.editedAt && reply.authorizedAt && reply.quotedMessage.editedAt.getTime() > reply.authorizedAt.getTime()) {
    return attention("QUOTED_MESSAGE_EDITED", "El mensaje citado cambió después de confirmar.", "PAUSED");
  }
  const template = reply.templateEnc ? decryptMessagingJson<ProviderTemplate | null>(reply.templateEnc, null) : null;
  if (!template) {
    try {
      assertReplyWindow(reply.conversation, now);
    } catch {
      return attention("OUTSIDE_REPLY_WINDOW", "La ventana de respuesta de 24 horas está cerrada. El texto se conserva.", "PAUSED");
    }
  }

  await prisma.scheduledReply.updateMany({ where: { id, status: "PROCESSING", claimTokenHash }, data: { attemptStartedAt: new Date() } });
  let result;
  try {
    result = await sendProviderText(reply.conversation.connection, reply.conversation, decryptMessaging(reply.bodyEnc), template);
  } catch (error) {
    if (error instanceof ProviderSendError) {
      return attention(error.code, error.message, error.ambiguous ? "REQUIRES_ATTENTION" : "FAILED");
    }
    return attention("PROVIDER_UNKNOWN", "No se pudo confirmar el resultado del envío. No se reintentará automáticamente.");
  }

  const providerMessageHash = messagingHash(`${reply.conversation.connection.provider}:message`, result.providerMessageId);
  try {
    return await prisma.$transaction(async (tx) => {
      const message = await tx.channelMessage.upsert({
        where: { conversationId_providerMessageIdHash: { conversationId: reply.conversationId, providerMessageIdHash: providerMessageHash } },
        create: {
          userId: reply.userId,
          conversationId: reply.conversationId,
          providerMessageIdEnc: encryptMessaging(result.providerMessageId),
          providerMessageIdHash: providerMessageHash,
          direction: "OUTBOUND",
          origin: "API",
          kind: "TEXT",
          bodyEnc: reply.bodyEnc,
          deliveryStatus: "SENT",
          providerSentAt: result.sentAt,
        },
        update: { deliveryStatus: "SENT", origin: "API", bodyEnc: reply.bodyEnc },
      });
      const changed = await tx.scheduledReply.updateMany({
        where: { id, status: "PROCESSING", claimTokenHash },
        data: { status: "SENT", deliveredMessageId: message.id, claimTokenHash: null, leaseUntil: null, lastErrorCode: null, lastErrorEnc: null },
      });
      if (changed.count !== 1) throw new Error("Lost messaging lease");
      await tx.conversation.update({
        where: { id: reply.conversationId },
        data: { lastMessageAt: result.sentAt, lastOutboundAt: result.sentAt, lastActivityAt: result.sentAt },
      });
      return message;
    });
  } catch (error) {
    logger.warn({ err: error, scheduledReplyId: id }, "Sent provider message could not be finalized");
    await attention("LOCAL_FINALIZE_UNKNOWN", "El proveedor aceptó el envío, pero no se pudo cerrar su registro local. No se reintentará.");
    return null;
  }
}

export async function purgeMessagingRetention(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const [messages, receipts, replies] = await prisma.$transaction([
    prisma.channelMessage.deleteMany({ where: { providerSentAt: { lt: cutoff } } }),
    prisma.webhookReceipt.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    prisma.scheduledReply.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  const conversations = await prisma.conversation.deleteMany({
    where: {
      OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null, createdAt: { lt: cutoff } }],
      messages: { none: {} },
      scheduledReplies: { none: {} },
    },
  });
  // Telegram assistant memory only needs the last few turns of a live chat.
  await prisma.telegramAssistantSession.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60_000) } } });
  return { messages: messages.count, receipts: receipts.count, replies: replies.count, conversations: conversations.count };
}
