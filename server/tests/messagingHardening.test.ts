import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { MessagingConnection, MessagingProvider, TelegramBot } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config/env.js";
import { decryptSecret, encryptSecret } from "../src/lib/crypto.js";
import { decryptMessaging, encryptMessaging, encryptMessagingJson, messagingHash } from "../src/lib/messagingCrypto.js";
import { prisma } from "../src/lib/prisma.js";
import { ingestProviderMessage } from "../src/lib/messaging/service.js";
import { processTelegramBusinessUpdate, processWhatsAppWebhook } from "../src/lib/messaging/webhooks.js";
import { processScheduledReply } from "../src/lib/messaging/worker.js";
import { completeWhatsAppEmbeddedSignup, supportedWhatsAppTemplate } from "../src/lib/messaging/whatsapp.js";
import { handleTelegramText } from "../src/lib/telegramCalen.js";
import { googleAccountEmail } from "../src/lib/googleMail.js";
import { makeApp, registerAndLogin } from "./helpers.js";

let app: Express;

beforeAll(async () => {
  app = await makeApp();
  config.messaging.telegramBusinessEnabled = true;
  config.messaging.whatsappEnabled = true;
  await prisma.whatsAppPlatformSetting.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: true, appId: "123456789", appSecretEnc: encryptSecret("meta-secret"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-token"), graphVersion: "v99.0" },
    update: { enabled: true, appId: "123456789", appSecretEnc: encryptSecret("meta-secret"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-token"), graphVersion: "v99.0" },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("WhatsApp number ownership", () => {
  it("lets another account claim a disconnected number without inheriting its conversations", async () => {
    const a = await registerAndLogin(app, `wa-own-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `wa-own-b-${randomUUID()}`);
    const phone = `40${Date.now()}`;
    const waba = `waba${Date.now()}`;
    const first = await connectWhatsApp(a.userId, phone, waba);
    const conversation = await ingestInbound(first, "34600000001", "privado de A");

    // Still active: the other account is denied.
    await expect(connectWhatsApp(b.userId, phone, waba)).rejects.toMatchObject({ status: 409 });

    const unsubscribe = stubMeta(phone, waba);
    const disconnected = await a.authed(app).post(`/api/messaging/connections/${first.id}/disconnect`);
    expect(disconnected.status).toBe(200);
    expect(unsubscribe.mock.calls.some(([url, init]) => String(url).includes(`/${waba}/subscribed_apps`) && (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);

    const claimed = await connectWhatsApp(b.userId, phone, waba);
    expect(claimed.id).not.toBe(first.id);
    expect(claimed.userId).toBe(b.userId);
    const old = await prisma.messagingConnection.findUniqueOrThrow({ where: { id: first.id } });
    expect(old).toMatchObject({ userId: a.userId, status: "REVOKED", credentialEnc: null });
    expect(old.externalAccountIdHash).not.toBe(claimed.externalAccountIdHash);

    // New traffic for the number lands only in B's account.
    await processWhatsAppWebhook(whatsappMessagePayload(phone, "34600000001", "para B"), randomUUID());
    const aMessages = await prisma.channelMessage.findMany({ where: { conversationId: conversation.id } });
    expect(aMessages).toHaveLength(1);
    const bConversations = await prisma.conversation.findMany({ where: { userId: b.userId }, include: { messages: true } });
    expect(bConversations).toHaveLength(1);
    expect(decryptMessaging(bConversations[0].messages[0].bodyEnc!)).toBe("para B");

    // A cannot touch B's new conversation.
    const denied = await a.authed(app).get(`/api/messaging/conversations/${bConversations[0].id}/messages`);
    expect(denied.status).toBe(404);
  });

  it("keeps the WABA subscription while another active connection uses it", async () => {
    const a = await registerAndLogin(app, `wa-share-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `wa-share-b-${randomUUID()}`);
    const waba = `wabashared${Date.now()}`;
    const first = await createWhatsAppConnection(a.userId, `41${Date.now()}1`, waba);
    await createWhatsAppConnection(b.userId, `41${Date.now()}2`, waba);
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await a.authed(app).post(`/api/messaging/connections/${first.id}/disconnect`);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.messagingConnection.findUniqueOrThrow({ where: { id: first.id } })).disconnectedByUserAt).not.toBeNull();
  });
});

describe("WhatsApp webhooks", () => {
  it("imports shared history without unread counts and names contacts only in the owner's account", async () => {
    const a = await registerAndLogin(app, `wa-hist-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `wa-hist-b-${randomUUID()}`);
    const phoneA = `42${Date.now()}1`;
    const phoneB = `42${Date.now()}2`;
    const connectionA = await createWhatsAppConnection(a.userId, phoneA);
    await createWhatsAppConnection(b.userId, phoneB);
    const customer = "34611111111";
    const ts = Math.floor(Date.now() / 1000) - 3600;
    await processWhatsAppWebhook({ entry: [{ changes: [{ field: "history", value: {
      metadata: { phone_number_id: phoneA },
      history: [{ threads: [{ id: customer, messages: [
        { id: `wamid.h1.${randomUUID()}`, from: customer, timestamp: String(ts), type: "text", text: { body: "hola de antes" } },
        { id: `wamid.h2.${randomUUID()}`, from: "15550000000", timestamp: String(ts + 60), type: "text", text: { body: "respuesta desde la app" } },
      ] }] }],
    } }] }] }, randomUUID());
    await processWhatsAppWebhook({ entry: [{ changes: [{ field: "smb_app_state_sync", value: {
      metadata: { phone_number_id: phoneA },
      state_sync: [{ type: "contact", action: "add", contact: { full_name: "María Cliente", phone_number: `+${customer}` } }],
    } }] }] }, randomUUID());

    const conversation = await prisma.conversation.findFirstOrThrow({ where: { connectionId: connectionA.id }, include: { messages: { orderBy: { providerSentAt: "asc" } } } });
    expect(conversation.unreadCount).toBe(0);
    expect(conversation.messages.map((m) => m.direction)).toEqual(["INBOUND", "OUTBOUND"]);
    expect(conversation.messages[1].origin).toBe("OWNER_DEVICE");
    expect(decryptMessaging(conversation.displayNameEnc!)).toBe("María Cliente");
    expect(await prisma.conversation.count({ where: { userId: b.userId } })).toBe(0);
  });

  it("flags a failed delivery once and never downgrades it", async () => {
    const user = await registerAndLogin(app, `wa-fail-${randomUUID()}`);
    const phone = `43${Date.now()}`;
    const connection = await createWhatsAppConnection(user.userId, phone);
    const customer = "34622222222";
    const conversation = await ingestInbound(connection, customer, "hola");
    const wamid = `wamid.out.${randomUUID()}`;
    await prisma.channelMessage.create({ data: {
      userId: user.userId, conversationId: conversation.id,
      providerMessageIdEnc: encryptMessaging(wamid), providerMessageIdHash: messagingHash("WHATSAPP:message", wamid),
      direction: "OUTBOUND", origin: "API", kind: "TEXT", bodyEnc: encryptMessaging("respuesta"), deliveryStatus: "SENT", providerSentAt: new Date(),
    } });
    const status = (value: string, errors?: Array<{ code: number }>) => ({ entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phone },
      statuses: [{ id: wamid, recipient_id: customer, status: value, timestamp: String(Math.floor(Date.now() / 1000)), errors }],
    } }] }] });
    await processWhatsAppWebhook(status("failed", [{ code: 131047 }]), randomUUID());
    await processWhatsAppWebhook(status("delivered"), randomUUID());
    const message = await prisma.channelMessage.findFirstOrThrow({ where: { providerMessageIdHash: messagingHash("WHATSAPP:message", wamid) } });
    expect(message.deliveryStatus).toBe("FAILED");
    const notifications = await prisma.notification.findMany({ where: { userId: user.userId, title: "WhatsApp no entregó el mensaje" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain("plantilla");
  });
});

describe("WhatsApp templates", () => {
  it("accepts only templates the app can fill", () => {
    const body = (text: string) => ({ type: "BODY", text });
    expect(supportedWhatsAppTemplate({ name: "cita", language: "es", status: "APPROVED", category: "UTILITY", components: [body("Hola {{1}}, tu cita es el {{2}}")] })?.parameterCount).toBe(2);
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "PENDING", components: [body("Hola")] })).toBeNull();
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "APPROVED", components: [body("Hola {{nombre}}")] })).toBeNull();
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "APPROVED", components: [body("Hola {{2}}")] })).toBeNull();
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, body("Hola")] })).toBeNull();
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "APPROVED", components: [body("Hola"), { type: "BUTTONS", buttons: [{ type: "URL", url: "https://a.example/{{1}}" }] }] })).toBeNull();
    expect(supportedWhatsAppTemplate({ name: "x", language: "es", status: "APPROVED", category: "AUTHENTICATION", components: [body("Código {{1}}")] })).toBeNull();
  });

  it("sends an approved template outside the 24-hour window and denies other users", async () => {
    const owner = await registerAndLogin(app, `wa-tpl-${randomUUID()}`);
    const other = await registerAndLogin(app, `wa-tpl-other-${randomUUID()}`);
    const phone = `44${Date.now()}`;
    const waba = `wabatpl${Date.now()}`;
    const connection = await createWhatsAppConnection(owner.userId, phone, waba);
    const conversation = await ingestInbound(connection, "34633333333", "hace días", new Date(Date.now() - 3 * 24 * 60 * 60_000));
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/${waba}/message_templates`)) {
        return jsonResponse({ data: [
          { name: "retomar", language: "es", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, ¿seguimos?" }] },
          { name: "con_imagen", language: "es", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Mira" }] },
        ] });
      }
      if (url.includes(`/${phone}/messages`)) {
        sent.push(JSON.parse(String(init?.body)));
        return jsonResponse({ messages: [{ id: `wamid.tpl.${randomUUID()}` }] });
      }
      return jsonResponse({ error: { message: "Unexpected" } }, 404);
    }));

    const list = await owner.authed(app).get(`/api/messaging/conversations/${conversation.id}/templates`);
    expect(list.status).toBe(200);
    expect(list.body.templates.map((t: { name: string }) => t.name)).toEqual(["retomar"]);
    expect((await other.authed(app).get(`/api/messaging/conversations/${conversation.id}/templates`)).status).toBe(404);
    expect((await other.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "retomar", language: "es", parameters: ["Ana"], idempotencyKey: randomUUID() })).status).toBe(404);

    // Free text stays blocked outside the window.
    const text = await owner.authed(app).post(`/api/messaging/conversations/${conversation.id}/messages`).send({ body: "hola", idempotencyKey: randomUUID() });
    expect(text.status).toBe(409);
    expect((await owner.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "retomar", language: "es", parameters: [], idempotencyKey: randomUUID() })).status).toBe(422);
    expect((await owner.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "con_imagen", language: "es", parameters: [], idempotencyKey: randomUUID() })).status).toBe(422);
    expect((await owner.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "retomar", language: "es", parameters: ["con\nsalto"], idempotencyKey: randomUUID() })).status).toBe(422);

    const queued = await owner.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "retomar", language: "es", parameters: ["Ana"], idempotencyKey: randomUUID() });
    expect(queued.status).toBe(202);
    expect(queued.body.scheduledReply).toMatchObject({ isTemplate: true, body: "Hola Ana, ¿seguimos?" });
    const edit = await owner.authed(app).patch(`/api/messaging/scheduled-replies/${queued.body.scheduledReply.id}`).send({ body: "otro texto" });
    expect(edit.status).toBe(409);

    await processScheduledReply(queued.body.scheduledReply.id);
    expect(await prisma.scheduledReply.findUniqueOrThrow({ where: { id: queued.body.scheduledReply.id } })).toMatchObject({ status: "SENT" });
    expect(sent).toEqual([expect.objectContaining({
      type: "template",
      to: "34633333333",
      template: { name: "retomar", language: { code: "es" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }] },
    })]);
  });

  it("refuses templates on Telegram conversations", async () => {
    const user = await registerAndLogin(app, `tg-tpl-${randomUUID()}`);
    const connection = await createConnection(user.userId, "TELEGRAM");
    const conversation = await ingestInbound(connection, "tg-chat", "hola");
    const res = await user.authed(app).post(`/api/messaging/conversations/${conversation.id}/template`).send({ name: "retomar", language: "es", parameters: [], idempotencyKey: randomUUID() });
    expect(res.status).toBe(422);
  });
});

describe("Telegram Business disconnect", () => {
  it("keeps an app disconnect until the business connection is established again", async () => {
    const user = await registerAndLogin(app, `tg-sticky-${randomUUID()}`);
    const bot = await createTelegramBot(user.userId);
    await prisma.telegramLink.create({ data: { userId: user.userId, botId: bot.id, chatId: "701", telegramUserId: "701" } });
    const accountId = `biz-${randomUUID()}`;
    const established = Math.floor(Date.now() / 1000) - 600;
    const update = (id: number, date: number, canReply = true) => ({ update_id: id, business_connection: { id: accountId, user: { id: 701 }, date, rights: { can_reply: canReply }, is_enabled: true } });
    await processTelegramBusinessUpdate(update(1, established), bot);
    const connection = await prisma.messagingConnection.findFirstOrThrow({ where: { userId: user.userId, provider: "TELEGRAM" } });
    expect(connection.status).toBe("ACTIVE");

    expect((await user.authed(app).post(`/api/messaging/connections/${connection.id}/disconnect`)).status).toBe(200);
    await processTelegramBusinessUpdate(update(2, established, false), bot);
    expect(await prisma.messagingConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "REVOKED" });

    await processTelegramBusinessUpdate(update(3, Math.floor(Date.now() / 1000) + 5), bot);
    expect(await prisma.messagingConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "ACTIVE", disconnectedByUserAt: null });
  });
});

describe("Telegram assistant chat boundaries", () => {
  it("ignores groups and foreign senders even when the chat id is linked", async () => {
    const user = await registerAndLogin(app, `tg-private-${randomUUID()}`);
    const bot = await createTelegramBot(user.userId);
    const routeToken = decryptSecret(bot.routingTokenEnc);
    const secret = decryptSecret(bot.webhookSecretEnc);
    await prisma.telegramLink.create({ data: { userId: user.userId, botId: bot.id, chatId: "-100555", telegramUserId: "801" } });
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: String(input).split("/").pop() ?? "", body: JSON.parse(String(init?.body ?? "{}")) });
      return jsonResponse({ ok: true, result: { message_id: 1, date: 1 } });
    }));
    const post = (message: Record<string, unknown>) => supertestPost(`/api/telegram/webhook/${routeToken}`, secret, { update_id: Date.now(), message });

    expect((await post({ chat: { id: -100555, type: "supergroup" }, from: { id: 801 }, text: "qué tengo hoy" })).status).toBe(200);
    expect((await post({ chat: { id: -100555, type: "supergroup" }, from: { id: 999 }, text: "borra todo" })).status).toBe(200);
    expect((await post({ chat: { id: 902, type: "private" }, from: { id: 903 }, text: "suplantado" })).status).toBe(200);
    expect((await post({ chat: { id: -100777, type: "group" }, from: { id: 801 }, text: "/start abc" })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(String(calls[0].body.text)).toContain("chat privado");
  });

  it("refuses a second turn while another instance holds the chat and clears memory on /stop", async () => {
    const user = await registerAndLogin(app, `tg-busy-${randomUUID()}`);
    const bot = await createTelegramBot(user.userId);
    await prisma.telegramLink.create({ data: { userId: user.userId, botId: bot.id, chatId: "811", telegramUserId: "811" } });
    await prisma.telegramAssistantSession.create({ data: { botId: bot.id, chatId: "811", busyUntil: new Date(Date.now() + 60_000), historyEnc: encryptMessagingJson([{ role: "user", content: "antes" }]) } });
    const texts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      texts.push(String(JSON.parse(String(init?.body ?? "{}")).text ?? ""));
      return jsonResponse({ ok: true, result: { message_id: 1, date: 1 } });
    }));
    await handleTelegramText(bot, "811", "hola", "811");
    expect(texts).toEqual(["Un segundo, estoy con el mensaje anterior."]);

    await handleTelegramText(bot, "811", "otro", "999");
    expect(texts.at(-1)).toContain("no está vinculado");

    await handleTelegramText(bot, "811", "/stop", "811");
    expect(await prisma.telegramAssistantSession.count({ where: { botId: bot.id } })).toBe(0);
    expect(await prisma.telegramLink.count({ where: { botId: bot.id, revokedAt: null } })).toBe(0);
  });
});

describe("Gmail with Google", () => {
  beforeAll(async () => {
    await prisma.googleOAuthSetting.upsert({
      where: { id: 1 },
      create: { id: 1, enabled: true, clientId: "google-client.apps.googleusercontent.com", clientSecretEnc: encryptSecret("google-secret") },
      update: { enabled: true, clientId: "google-client.apps.googleusercontent.com", clientSecretEnc: encryptSecret("google-secret") },
    });
  });
  afterAll(async () => {
    await prisma.googleOAuthSetting.update({ where: { id: 1 }, data: { enabled: false, clientId: "", clientSecretEnc: null, validatedAt: null } });
  });

  it("binds the authorization code to a PKCE verifier and requires a verified address", async () => {
    const user = await registerAndLogin(app, `gmail-pkce-${randomUUID()}`);
    const start = await user.authed(app).get("/api/inbox/mailboxes/google/start").set("Origin", "http://localhost:5173");
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.location);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = authorize.searchParams.get("state")!;

    let tokenBody = new URLSearchParams();
    const email = `pkce-${randomUUID()}@gmail.com`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        tokenBody = new URLSearchParams(String(init?.body));
        return jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
      }
      if (url.includes("userinfo")) return jsonResponse({ email, email_verified: true });
      return jsonResponse({}, 404);
    }));
    const callback = await user.authed(app).get("/api/inbox/mailboxes/google/callback").query({ code: "auth-code", state });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain("google=ok");
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await prisma.mailbox.count({ where: { userId: user.userId, email, authType: "google" } })).toBe(1);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ email: "x@gmail.com", email_verified: false })));
    await expect(googleAccountEmail("access")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps a Google box on Google hosts and revokes the grant when it is replaced or removed", async () => {
    const user = await registerAndLogin(app, `gmail-lock-${randomUUID()}`);
    const other = await registerAndLogin(app, `gmail-lock-other-${randomUUID()}`);
    const mailbox = await createGoogleMailbox(user.userId);
    const revoked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("oauth2.googleapis.com/revoke")) revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return jsonResponse({});
    }));

    const moved = await user.authed(app).patch(`/api/inbox/mailboxes/${mailbox.id}`).send({ imapHost: "imap.attacker.example", smtpHost: "smtp.attacker.example" });
    expect(moved.status).toBe(400);
    // Same Google hosts, another identity: the token must not be reused for it.
    const otherAccount = await user.authed(app).patch(`/api/inbox/mailboxes/${mailbox.id}`).send({ username: "victim@gmail.com", email: "victim@gmail.com" });
    expect(otherAccount.status).toBe(400);
    expect(otherAccount.body.error.message).toContain("solo permite cambiar su nombre");
    expect(await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).toMatchObject({ username: "box@gmail.com", email: mailbox.email });
    const renamed = await user.authed(app).patch(`/api/inbox/mailboxes/${mailbox.id}`).send({ label: "Trabajo", imapHost: "imap.gmail.com", imapPort: 993 });
    expect(renamed.status).toBe(200);
    expect(await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).toMatchObject({ label: "Trabajo", imapHost: "imap.gmail.com", authType: "google" });
    expect((await other.authed(app).delete(`/api/inbox/mailboxes/${mailbox.id}`)).status).toBe(404);
    expect(revoked).toEqual([]);

    const removed = await user.authed(app).delete(`/api/inbox/mailboxes/${mailbox.id}`);
    expect(removed.status).toBe(200);
    expect(revoked).toEqual(["google-refresh-token"]);
  });
});

async function connectWhatsApp(userId: string, phoneNumberId: string, wabaId: string) {
  stubMeta(phoneNumberId, wabaId);
  return completeWhatsAppEmbeddedSignup({ userId, code: `code-${randomUUID()}`, phoneNumberId, wabaId });
}

function stubMeta(phoneNumberId: string, wabaId: string) {
  const mock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) return jsonResponse({ access_token: `token-${phoneNumberId}` });
    if (url.includes(`/${phoneNumberId}?`)) return jsonResponse({ id: phoneNumberId, display_phone_number: phoneNumberId, verified_name: "DAYLY Test" });
    if (url.includes(`/${wabaId}/phone_numbers`)) return jsonResponse({ data: [{ id: phoneNumberId }] });
    if (url.includes(`/${wabaId}/subscribed_apps`)) return jsonResponse({ success: true });
    if (url.includes("/smb_app_data")) return jsonResponse({ success: true });
    return jsonResponse({ error: { message: "Unexpected Meta URL" } }, 404);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function whatsappMessagePayload(phoneNumberId: string, from: string, body: string) {
  return { entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: `wamid.${randomUUID()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  } }] }] };
}

async function ingestInbound(connection: MessagingConnection, chatId: string, body: string, at = new Date()) {
  const result = await ingestProviderMessage({
    connection, externalChatId: chatId, displayName: "Cliente", providerMessageId: `in-${randomUUID()}`,
    direction: "INBOUND", origin: "CUSTOMER", kind: "TEXT", body, providerSentAt: at,
  });
  return result.conversation;
}

async function createWhatsAppConnection(userId: string, phoneNumberId: string, wabaId = `waba-${randomUUID()}`) {
  return createConnection(userId, "WHATSAPP", phoneNumberId, wabaId);
}

async function createConnection(userId: string, provider: MessagingProvider, externalId = `${provider.toLowerCase()}-${randomUUID()}`, wabaId = `waba-${randomUUID()}`): Promise<MessagingConnection> {
  return prisma.messagingConnection.create({ data: {
    userId, provider, status: "ACTIVE",
    externalAccountIdEnc: encryptMessaging(externalId),
    externalAccountIdHash: messagingHash(`${provider}:account`, externalId),
    labelEnc: encryptMessaging(`${provider} de prueba`),
    credentialEnc: provider === "WHATSAPP" ? encryptMessaging("test-access-token") : null,
    providerDataEnc: provider === "WHATSAPP" ? encryptMessagingJson({ phoneNumberId: externalId, wabaId }) : null,
    capabilities: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 },
    connectedAt: new Date(),
  } });
}

async function createTelegramBot(userId: string): Promise<TelegramBot> {
  const suffix = randomUUID();
  return prisma.telegramBot.create({ data: {
    userId,
    telegramBotId: `7${Date.now()}${Math.floor(Math.random() * 1000)}`,
    tokenEnc: encryptSecret(`123456:${suffix}`),
    username: "calen_test_bot",
    routingTokenHash: (await import("../src/lib/crypto.js")).hashToken(`route-${suffix}`),
    routingTokenEnc: encryptSecret(`route-${suffix}`),
    webhookSecretEnc: encryptSecret(`secret-${suffix}`),
    status: "ACTIVE",
  } });
}

async function createGoogleMailbox(userId: string) {
  return prisma.mailbox.create({ data: {
    userId, label: "Gmail", email: `box-${randomUUID()}@gmail.com`,
    imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecure: false,
    username: "box@gmail.com", authType: "google", oauthRefreshEnc: encryptSecret("google-refresh-token"),
  } });
}

async function supertestPost(path: string, secret: string, body: unknown) {
  const { default: supertest } = await import("supertest");
  return supertest(app).post(path).set("X-Telegram-Bot-Api-Secret-Token", secret).send(body);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
