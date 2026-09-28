import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { MessagingConnection, MessagingProvider } from "@prisma/client";
import { config } from "../src/config/env.js";
import { decryptMessaging, encryptMessaging, encryptMessagingJson, messagingHash } from "../src/lib/messagingCrypto.js";
import { prisma } from "../src/lib/prisma.js";
import { ingestProviderMessage, REPLY_WINDOW_MS, replyWindowEndsAt } from "../src/lib/messaging/service.js";
import { processTelegramBusinessUpdate, processWhatsAppWebhook } from "../src/lib/messaging/webhooks.js";
import { processScheduledReply, purgeMessagingRetention, tickMessagingWorker } from "../src/lib/messaging/worker.js";
import { verifyWhatsAppChallenge, verifyWhatsAppSignature } from "../src/lib/messaging/whatsapp.js";
import { makeApp, registerAndLogin } from "./helpers.js";
import { encryptSecret } from "../src/lib/crypto.js";

let app: Express;

beforeAll(async () => {
  app = await makeApp();
  config.messaging.telegramBusinessEnabled = true;
  config.messaging.whatsappEnabled = true;
  config.messaging.whatsappGraphVersion = "v99.0";
  await prisma.whatsAppPlatformSetting.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: true, appId: "123456789", appSecretEnc: encryptSecret("app-secret-for-signature-test"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-test-token"), graphVersion: "v99.0" },
    update: { enabled: true, appId: "123456789", appSecretEnc: encryptSecret("app-secret-for-signature-test"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-test-token"), graphVersion: "v99.0" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("business messaging crypto and verification", () => {
  it("encrypts fields with authentication and keeps lookup namespaces separate", () => {
    const encrypted = encryptMessaging("mensaje sensible");
    expect(encrypted).not.toContain("mensaje sensible");
    expect(decryptMessaging(encrypted)).toBe("mensaje sensible");
    const [version, iv, tag, data] = encrypted.split(".");
    const replacement = tag.startsWith("A") ? "B" : "A";
    expect(() => decryptMessaging([version, iv, `${replacement}${tag.slice(1)}`, data].join("."))).toThrow();
    expect(messagingHash("chat", "42")).not.toBe(messagingHash("message", "42"));
  });

  it("validates WhatsApp challenge and raw-body HMAC without exposing the secret", async () => {
    const raw = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac("sha256", "app-secret-for-signature-test").update(raw).digest("hex")}`;
    expect(await verifyWhatsAppChallenge("subscribe", "verify-test-token")).toBe(true);
    expect(await verifyWhatsAppChallenge("subscribe", "wrong")).toBe(false);
    expect(await verifyWhatsAppSignature(raw, signature)).toBe(true);
    expect(await verifyWhatsAppSignature(Buffer.from("tampered"), signature)).toBe(false);
  });

  it("computes the 24-hour reply boundary", () => {
    const inbound = new Date("2026-09-09T08:00:00.000Z");
    expect(replyWindowEndsAt({ lastInboundAt: inbound })?.getTime()).toBe(inbound.getTime() + REPLY_WINDOW_MS);
    expect(replyWindowEndsAt({ lastInboundAt: null })).toBeNull();
  });
});

describe("business messaging ownership and confirmation", () => {
  it("keeps conversations, media handles and drafts isolated by user", async () => {
    const a = await registerAndLogin(app, `msg-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `msg-b-${randomUUID()}`);
    const connection = await createConnection(a.userId, "TELEGRAM");
    const conversation = await createConversation(connection, "private-chat", new Date());
    const message = await prisma.channelMessage.create({
      data: {
        userId: a.userId,
        conversationId: conversation.id,
        providerMessageIdEnc: encryptMessaging("provider-private-id"),
        providerMessageIdHash: messagingHash("TELEGRAM:message", "provider-private-id"),
        direction: "INBOUND",
        origin: "CUSTOMER",
        kind: "DOCUMENT",
        bodyEnc: encryptMessaging("contenido privado"),
        mediaHandleEnc: encryptMessaging("private-file-id"),
        attachmentEnc: encryptMessagingJson({ mimeType: "application/pdf", filename: "privado.pdf" }),
        providerSentAt: new Date(),
      },
    });
    const reply = await prisma.scheduledReply.create({
      data: {
        userId: a.userId,
        conversationId: conversation.id,
        bodyEnc: encryptMessaging("respuesta privada"),
        sendAt: new Date(Date.now() + 60_000),
        timezone: "Europe/Madrid",
      },
    });

    expect((await b.authed(app).get(`/api/messaging/conversations/${conversation.id}/messages`)).status).toBe(404);
    expect((await b.authed(app).get(`/api/messaging/messages/${message.id}/media`)).status).toBe(404);
    expect((await b.authed(app).patch(`/api/messaging/scheduled-replies/${reply.id}`).send({ body: "intrusión" })).status).toBe(404);
    expect((await b.authed(app).post(`/api/messaging/connections/${connection.id}/disconnect`)).status).toBe(404);

    const list = await b.authed(app).get("/api/messaging/conversations");
    expect(list.status).toBe(200);
    expect(list.body.conversations).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain("private-chat");
    expect(JSON.stringify(list.body)).not.toContain("contenido privado");
  });

  it("requires the exact draft version and makes repeated confirmation idempotent", async () => {
    const user = await registerAndLogin(app, `msg-confirm-${randomUUID()}`);
    const connection = await createConnection(user.userId, "TELEGRAM");
    const conversation = await createConversation(connection, "confirm-chat", new Date());
    const sendAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const prepared = await user.authed(app).post("/api/messaging/scheduled-replies").send({
      conversationId: conversation.id,
      body: "Responder con calma",
      sendAt,
      timezone: "Europe/Madrid",
      pauseOnActivity: true,
    });
    expect(prepared.status).toBe(201);
    expect(prepared.body.scheduledReply).toMatchObject({ status: "AWAITING_CONFIRMATION", draftVersion: 1, canConfirm: true });

    const changed = await user.authed(app).patch(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}`).send({ body: "Texto exacto revisado" });
    expect(changed.status).toBe(200);
    expect(changed.body.scheduledReply.draftVersion).toBe(2);

    const stale = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: 1, idempotencyKey: randomUUID() });
    expect(stale.status).toBe(409);

    const key = randomUUID();
    const first = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: 2, idempotencyKey: key });
    const repeated = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: 2, idempotencyKey: key });
    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body.scheduledReply.id).toBe(first.body.scheduledReply.id);
    expect(repeated.body.scheduledReply.status).toBe("SCHEDULED");
  });

  it("preserves an outside-window draft but refuses to authorize it", async () => {
    const user = await registerAndLogin(app, `msg-window-${randomUUID()}`);
    const connection = await createConnection(user.userId, "WHATSAPP");
    const conversation = await createConversation(connection, "old-chat", new Date(Date.now() - 25 * 60 * 60_000));
    const prepared = await user.authed(app).post("/api/messaging/scheduled-replies").send({
      conversationId: conversation.id,
      body: "Conservar este borrador",
      sendAt: new Date(Date.now() + 60_000).toISOString(),
      timezone: "Europe/Madrid",
    });
    expect(prepared.status).toBe(201);
    expect(prepared.body.scheduledReply).toMatchObject({ status: "AWAITING_CONFIRMATION", canConfirm: false, errorCode: "OUTSIDE_REPLY_WINDOW" });
    const confirm = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: 1, idempotencyKey: randomUUID() });
    expect(confirm.status).toBe(409);
    expect((await prisma.scheduledReply.findUniqueOrThrow({ where: { id: prepared.body.scheduledReply.id } })).status).toBe("AWAITING_CONFIRMATION");
  });

  it("deduplicates immediate queue requests", async () => {
    const user = await registerAndLogin(app, `msg-now-${randomUUID()}`);
    const connection = await createConnection(user.userId, "TELEGRAM");
    const conversation = await createConversation(connection, "now-chat", new Date());
    const key = randomUUID();
    const first = await user.authed(app).post(`/api/messaging/conversations/${conversation.id}/messages`).send({ body: "Una sola vez", idempotencyKey: key });
    const repeated = await user.authed(app).post(`/api/messaging/conversations/${conversation.id}/messages`).send({ body: "Una sola vez", idempotencyKey: key });
    expect(first.status).toBe(202);
    expect(repeated.status).toBe(202);
    expect(repeated.body.scheduledReply.id).toBe(first.body.scheduledReply.id);
    expect(await prisma.scheduledReply.count({ where: { id: first.body.scheduledReply.id } })).toBe(1);
    await prisma.scheduledReply.update({ where: { id: first.body.scheduledReply.id }, data: { status: "CANCELED" } });
  });
});

describe("business messaging webhook safety", () => {
  it("scopes identical Telegram business identifiers to each user's bot", async () => {
    const a = await registerAndLogin(app, `tg-scope-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `tg-scope-b-${randomUUID()}`);
    const botA = await createTelegramBot(a.userId, "10001");
    const botB = await createTelegramBot(b.userId, "10002");
    await prisma.telegramLink.create({ data: { userId: a.userId, botId: botA.id, chatId: "owner-chat-a", telegramUserId: "501" } });
    await prisma.telegramLink.create({ data: { userId: b.userId, botId: botB.id, chatId: "owner-chat-b", telegramUserId: "502" } });
    const accountId = `shared-business-${randomUUID()}`;

    await processTelegramBusinessUpdate({ update_id: 1, business_connection: { id: accountId, user: { id: 501 }, rights: { can_reply: true }, is_enabled: true } }, botA);
    await processTelegramBusinessUpdate({ update_id: 2, business_connection: { id: accountId, user: { id: 502 }, rights: { can_reply: true }, is_enabled: true } }, botB);

    const connections = await prisma.messagingConnection.findMany({ where: { provider: "TELEGRAM", externalAccountIdEnc: { not: "" }, userId: { in: [a.userId, b.userId] } } });
    expect(connections).toHaveLength(2);
    expect(new Set(connections.map((item) => item.telegramBotId))).toEqual(new Set([botA.id, botB.id]));
    expect(new Set(connections.map((item) => item.externalAccountIdHash)).size).toBe(2);
  });

  it("separates a multi-number WhatsApp payload by tenant and deduplicates every group", async () => {
    const a = await registerAndLogin(app, `wa-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `wa-b-${randomUUID()}`);
    const phoneA = `10${Date.now()}1`;
    const phoneB = `10${Date.now()}2`;
    await createConnection(a.userId, "WHATSAPP", phoneA);
    await createConnection(b.userId, "WHATSAPP", phoneB);
    const payload = {
      entry: [{ changes: [
        { field: "messages", value: { metadata: { phone_number_id: phoneA }, messages: [{ id: `wamid-${randomUUID()}`, from: "customer-a", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "solo para A" } }] } },
        { field: "messages", value: { metadata: { phone_number_id: phoneB }, messages: [{ id: `wamid-${randomUUID()}`, from: "customer-b", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "solo para B" } }] } },
      ] }],
    };
    const eventKey = randomUUID();
    expect(await processWhatsAppWebhook(payload, eventKey)).toBe(true);
    expect(await processWhatsAppWebhook(payload, eventKey)).toBe(true);

    const conversationsA = await prisma.conversation.findMany({ where: { userId: a.userId }, include: { messages: true } });
    const conversationsB = await prisma.conversation.findMany({ where: { userId: b.userId }, include: { messages: true } });
    expect(conversationsA).toHaveLength(1);
    expect(conversationsB).toHaveLength(1);
    expect(conversationsA[0].messages).toHaveLength(1);
    expect(conversationsB[0].messages).toHaveLength(1);
    expect(decryptMessaging(conversationsA[0].messages[0].bodyEnc!)).toBe("solo para A");
    expect(decryptMessaging(conversationsB[0].messages[0].bodyEnc!)).toBe("solo para B");
    expect(conversationsA[0].unreadCount).toBe(1);
    expect(conversationsB[0].unreadCount).toBe(1);
    expect(await prisma.webhookReceipt.count({ where: { provider: "WHATSAPP", eventKeyHash: { in: [
      messagingHash("WHATSAPP:webhook", `${eventKey}:${phoneA}`),
      messagingHash("WHATSAPP:webhook", `${eventKey}:${phoneB}`),
    ] } } })).toBe(2);
  });

  it("pauses an authorized reply on an owner-device response or cited edit", async () => {
    const user = await registerAndLogin(app, `msg-pause-${randomUUID()}`);
    const connection = await createConnection(user.userId, "TELEGRAM");
    const base = await ingestProviderMessage({
      connection,
      externalChatId: "pause-chat",
      displayName: "Cliente",
      providerMessageId: "customer-base",
      direction: "INBOUND",
      origin: "CUSTOMER",
      kind: "TEXT",
      body: "Mensaje original",
      providerSentAt: new Date(Date.now() - 2_000),
    });
    const prepared = await user.authed(app).post("/api/messaging/scheduled-replies").send({
      conversationId: base.conversation.id,
      quotedMessageId: base.message.id,
      body: "Respuesta pendiente",
      sendAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      timezone: "Europe/Madrid",
      pauseOnActivity: true,
    });
    const confirmed = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: 1, idempotencyKey: randomUUID() });
    expect(confirmed.status).toBe(200);

    await ingestProviderMessage({
      connection,
      externalChatId: "pause-chat",
      providerMessageId: "owner-mobile-reply",
      direction: "OUTBOUND",
      origin: "OWNER_DEVICE",
      kind: "TEXT",
      body: "Ya respondí desde el móvil",
      providerSentAt: new Date(),
    });
    expect((await prisma.scheduledReply.findUniqueOrThrow({ where: { id: prepared.body.scheduledReply.id } })).status).toBe("PAUSED");

    const second = await user.authed(app).patch(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}`).send({ body: "Nueva versión" });
    const reconfirmed = await user.authed(app).post(`/api/messaging/scheduled-replies/${prepared.body.scheduledReply.id}/confirm`).send({ expectedVersion: second.body.scheduledReply.draftVersion, idempotencyKey: randomUUID() });
    expect(reconfirmed.status).toBe(200);
    await ingestProviderMessage({
      connection,
      externalChatId: "pause-chat",
      providerMessageId: "customer-base",
      direction: "INBOUND",
      origin: "CUSTOMER",
      kind: "TEXT",
      body: "Mensaje original editado",
      providerSentAt: new Date(),
      edited: true,
    });
    const paused = await prisma.scheduledReply.findUniqueOrThrow({ where: { id: prepared.body.scheduledReply.id } });
    expect(paused).toMatchObject({ status: "PAUSED", lastErrorCode: "QUOTED_MESSAGE_EDITED" });
  });
});

describe("business messaging worker", () => {
  it("claims a due send once even when two workers race", async () => {
    const user = await registerAndLogin(app, `worker-race-${randomUUID()}`);
    const connection = await createConnection(user.userId, "WHATSAPP");
    const conversation = await createConversation(connection, "race-chat", new Date());
    const reply = await createDueReply(user.userId, conversation.id);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: `wamid-${randomUUID()}` }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([processScheduledReply(reply.id), processScheduledReply(reply.id)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe("SENT");
    expect(await prisma.channelMessage.count({ where: { conversationId: conversation.id, origin: "API" } })).toBe(1);
  });

  it("does not retry an ambiguous provider outcome", async () => {
    const user = await registerAndLogin(app, `worker-ambiguous-${randomUUID()}`);
    const connection = await createConnection(user.userId, "WHATSAPP");
    const conversation = await createConversation(connection, "ambiguous-chat", new Date());
    const reply = await createDueReply(user.userId, conversation.id);
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);

    await processScheduledReply(reply.id);
    await processScheduledReply(reply.id);
    const row = await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } });
    expect(row).toMatchObject({ status: "REQUIRES_ATTENTION", lastErrorCode: "WHATSAPP_TRANSPORT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides and pauses replies when the connection loses send permission", async () => {
    const user = await registerAndLogin(app, `worker-permission-${randomUUID()}`);
    const connection = await createConnection(user.userId, "WHATSAPP");
    const conversation = await createConversation(connection, "permission-chat", new Date());
    const reply = await createDueReply(user.userId, conversation.id);
    await prisma.messagingConnection.update({ where: { id: connection.id }, data: { capabilities: { sendText: false } } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const listed = await user.authed(app).get("/api/messaging/conversations");
    expect(listed.body.conversations).toEqual([expect.objectContaining({ id: conversation.id, canReply: false })]);
    await processScheduledReply(reply.id);
    expect(await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ status: "PAUSED", lastErrorCode: "MISSING_REPLY_PERMISSION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks replies over five minutes late without sending", async () => {
    const user = await registerAndLogin(app, `worker-late-${randomUUID()}`);
    const connection = await createConnection(user.userId, "WHATSAPP");
    const conversation = await createConversation(connection, "late-chat", new Date());
    const reply = await prisma.scheduledReply.create({
      data: {
        userId: user.userId,
        conversationId: conversation.id,
        bodyEnc: encryptMessaging("No enviar tarde"),
        sendAt: new Date(Date.now() - 6 * 60_000),
        timezone: "UTC",
        status: "SCHEDULED",
        confirmedVersion: 1,
        authorizedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await tickMessagingWorker(new Date());
    expect(await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ status: "REQUIRES_ATTENTION", lastErrorCode: "TOO_LATE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("purges 90-day content and detaches retained reminders", async () => {
    const user = await registerAndLogin(app, `retention-${randomUUID()}`);
    const connection = await createConnection(user.userId, "TELEGRAM");
    const old = new Date(Date.now() - 91 * 24 * 60 * 60_000);
    const conversation = await createConversation(connection, "expired-chat", old);
    const message = await prisma.channelMessage.create({
      data: {
        userId: user.userId,
        conversationId: conversation.id,
        direction: "INBOUND",
        origin: "CUSTOMER",
        kind: "TEXT",
        bodyEnc: encryptMessaging("caducado"),
        providerSentAt: old,
        createdAt: old,
      },
    });
    await prisma.scheduledReply.create({ data: { userId: user.userId, conversationId: conversation.id, bodyEnc: encryptMessaging("caducado"), sendAt: old, timezone: "UTC", status: "CANCELED", createdAt: old } });
    await prisma.webhookReceipt.create({ data: { userId: user.userId, connectionId: connection.id, provider: "TELEGRAM", eventKeyHash: messagingHash("retention", randomUUID()), payloadEnc: encryptMessagingJson({ old: true }), receivedAt: old } });
    const reminder = await prisma.reminder.create({ data: { userId: user.userId, title: "Responder más tarde", remindAt: new Date(Date.now() + 24 * 60 * 60_000), targetType: "CONVERSATION", conversationId: conversation.id, messageId: message.id } });

    const result = await purgeMessagingRetention(new Date());
    expect(result.messages).toBeGreaterThanOrEqual(1);
    expect(result.receipts).toBeGreaterThanOrEqual(1);
    expect(result.replies).toBeGreaterThanOrEqual(1);
    expect(await prisma.conversation.findUnique({ where: { id: conversation.id } })).toBeNull();
    expect(await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({ conversationId: null, messageId: null });
  });
});

async function createConnection(userId: string, provider: MessagingProvider, externalId = `${provider.toLowerCase()}-${randomUUID()}`): Promise<MessagingConnection> {
  return prisma.messagingConnection.create({
    data: {
      userId,
      provider,
      status: "ACTIVE",
      externalAccountIdEnc: encryptMessaging(externalId),
      externalAccountIdHash: messagingHash(`${provider}:account`, externalId),
      labelEnc: encryptMessaging(`${provider} de prueba`),
      credentialEnc: provider === "WHATSAPP" ? encryptMessaging("test-access-token") : null,
      providerDataEnc: provider === "WHATSAPP" ? encryptMessagingJson({ phoneNumberId: externalId, wabaId: `waba-${randomUUID()}` }) : null,
      capabilities: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 },
      connectedAt: new Date(),
    },
  });
}

async function createConversation(connection: MessagingConnection, externalChatId: string, lastInboundAt: Date) {
  return prisma.conversation.create({
    data: {
      userId: connection.userId,
      connectionId: connection.id,
      externalChatIdEnc: encryptMessaging(externalChatId),
      externalChatIdHash: messagingHash(`${connection.provider}:chat`, externalChatId),
      displayNameEnc: encryptMessaging("Contacto de prueba"),
      lastMessageAt: lastInboundAt,
      lastInboundAt,
      lastActivityAt: lastInboundAt,
    },
  });
}

async function createDueReply(userId: string, conversationId: string) {
  return prisma.scheduledReply.create({
    data: {
      userId,
      conversationId,
      bodyEnc: encryptMessaging("Respuesta programada"),
      sendAt: new Date(Date.now() - 1_000),
      timezone: "UTC",
      status: "SCHEDULED",
      draftVersion: 1,
      confirmedVersion: 1,
      pauseOnActivity: false,
      authorizedAt: new Date(),
    },
  });
}

async function createTelegramBot(userId: string, telegramBotId: string) {
  const suffix = randomUUID();
  return prisma.telegramBot.create({
    data: {
      userId,
      telegramBotId: `${telegramBotId}${Date.now()}`,
      tokenEnc: encryptSecret(`token-${suffix}`),
      routingTokenHash: messagingHash("test-telegram-route", suffix),
      routingTokenEnc: encryptSecret(`route-${suffix}`),
      webhookSecretEnc: encryptSecret(`secret-${suffix}`),
      status: "ACTIVE",
    },
  });
}
