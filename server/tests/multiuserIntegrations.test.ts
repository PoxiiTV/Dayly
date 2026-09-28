import { randomUUID } from "node:crypto";
import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret, hashToken, randomToken } from "../src/lib/crypto.js";
import { bootstrapIntegrationSettings, saveTelegramPlatformSettings } from "../src/lib/integrationSettings.js";
import { createOAuthAttempt, consumeOAuthAttempt } from "../src/lib/oauthAttempts.js";
import { assertPublicHost, assertSecureMailboxTransport, isPublicIp } from "../src/lib/networkSafety.js";
import { encryptMessaging, messagingHash } from "../src/lib/messagingCrypto.js";
import { completeWhatsAppEmbeddedSignup } from "../src/lib/messaging/whatsapp.js";
import { isSafeSmtpRetry } from "../src/lib/mailbox.js";
import { prisma } from "../src/lib/prisma.js";
import { adminCookie, makeApp, registerAndLogin } from "./helpers.js";

let app: Express;

beforeAll(async () => { app = await makeApp(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("multiuser integration boundaries", () => {
  it("binds OAuth state to one user and session and consumes it once", async () => {
    const a = await registerAndLogin(app, `oauth-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `oauth-b-${randomUUID()}`);
    const sessionA = await prisma.session.findFirstOrThrow({ where: { userId: a.userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    const sessionB = await prisma.session.findFirstOrThrow({ where: { userId: b.userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    const state = await createOAuthAttempt({ provider: "SPOTIFY", userId: a.userId, sessionId: sessionA.id, redirectUri: "http://localhost:5173/spotify/callback", returnTo: "//evil.example", verifier: "secret-verifier" });

    await expect(consumeOAuthAttempt({ provider: "SPOTIFY", state, userId: b.userId, sessionId: sessionB.id })).rejects.toThrow();
    const consumed = await consumeOAuthAttempt({ provider: "SPOTIFY", state, userId: a.userId, sessionId: sessionA.id });
    expect(consumed.verifier).toBe("secret-verifier");
    expect(consumed.returnTo).toBe("/");
    await expect(consumeOAuthAttempt({ provider: "SPOTIFY", state, userId: a.userId, sessionId: sessionA.id })).rejects.toThrow();
  });

  it("rejects an expired OAuth state without consuming it", async () => {
    const user = await registerAndLogin(app, `oauth-expired-${randomUUID()}`);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    const state = await createOAuthAttempt({ provider: "GOOGLE_MAIL", userId: user.userId, sessionId: session.id, redirectUri: "http://localhost:5173/api/inbox/mailboxes/google/callback" });
    await prisma.oAuthAttempt.update({ where: { stateHash: hashToken(state) }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    await expect(consumeOAuthAttempt({ provider: "GOOGLE_MAIL", state, userId: user.userId, sessionId: session.id })).rejects.toThrow(/caducado/i);
    expect((await prisma.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: hashToken(state) } })).usedAt).toBeNull();
  });

  it("rejects private mail endpoints and insecure transport", async () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("10.1.2.3")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("::ffff:7f00:1")).toBe(false);
    expect(isPublicIp("0:0:0:0:0:ffff:7f00:1")).toBe(false);
    expect(isPublicIp("fec0::1")).toBe(false);
    expect(isPublicIp("192.0.2.10")).toBe(false);
    expect(isPublicIp("2001:db8::1")).toBe(false);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
    await expect(assertPublicHost("localhost")).rejects.toThrow(/público/i);
    expect(() => assertSecureMailboxTransport({ imapSecure: false, smtpSecure: true, smtpPort: 465 })).toThrow(/IMAP/i);
    expect(() => assertSecureMailboxTransport({ imapSecure: true, smtpSecure: false, smtpPort: 143 })).toThrow(/SMTP/i);
    expect(isSafeSmtpRetry({ code: "ETIMEDOUT", command: "CONN" })).toBe(true);
    expect(isSafeSmtpRetry({ code: "ETIMEDOUT", command: "DATA" })).toBe(false);
    expect(isSafeSmtpRetry({ responseCode: 451 })).toBe(true);
    expect(isSafeSmtpRetry({ responseCode: 550 })).toBe(false);
  });

  it("denies every platform configuration route to regular users", async () => {
    const user = await registerAndLogin(app, `admin-denied-${randomUUID()}`);
    for (const endpoint of ["smtp", "telegram", "spotify", "google", "whatsapp"]) {
      expect((await user.authed(app).get(`/api/admin/${endpoint}`)).status).toBe(403);
      expect((await user.authed(app).patch(`/api/admin/${endpoint}`).send({})).status).toBe(403);
    }
  });

  it("keeps default mailboxes and Telegram bots tenant-scoped", async () => {
    const a = await registerAndLogin(app, `owned-a-${randomUUID()}`);
    const b = await registerAndLogin(app, `owned-b-${randomUUID()}`);
    const mailboxA = await createMailbox(a.userId, `a-${randomUUID()}@dayly.test`);
    const mailboxB = await createMailbox(b.userId, `b-${randomUUID()}@dayly.test`);

    expect((await b.authed(app).post(`/api/inbox/mailboxes/${mailboxA.id}/default`)).status).toBe(404);
    expect((await a.authed(app).post(`/api/inbox/mailboxes/${mailboxA.id}/default`)).status).toBe(200);
    expect((await b.authed(app).post(`/api/inbox/mailboxes/${mailboxB.id}/default`)).status).toBe(200);
    const listA = await a.authed(app).get("/api/inbox/mailboxes");
    const listB = await b.authed(app).get("/api/inbox/mailboxes");
    expect(listA.body.mailboxes).toEqual([expect.objectContaining({ id: mailboxA.id, isDefault: true })]);
    expect(listB.body.mailboxes).toEqual([expect.objectContaining({ id: mailboxB.id, isDefault: true })]);

    const routing = randomToken(24);
    const bot = await prisma.telegramBot.create({ data: {
      userId: a.userId,
      telegramBotId: String(Date.now()),
      tokenEnc: encryptSecret("123456789:abcdefghijklmnopqrstuvwxyz_ABCD"),
      username: `bot_${randomUUID().replaceAll("-", "")}`.slice(0, 60),
      routingTokenHash: hashToken(routing),
      routingTokenEnc: encryptSecret(routing),
      webhookSecretEnc: encryptSecret(randomToken(24)),
      status: "ACTIVE",
    } });
    await prisma.telegramLink.create({ data: { userId: a.userId, botId: bot.id, chatId: String(Date.now()) } });
    const statusA = await a.authed(app).get("/api/telegram/status");
    const statusB = await b.authed(app).get("/api/telegram/status");
    expect(statusA.body).toMatchObject({ configured: true, linked: true });
    expect(statusB.body).toMatchObject({ configured: false, linked: false, bot: null });
  });

  it("requires a healthy default mailbox for personal email alerts", async () => {
    const user = await registerAndLogin(app, `mail-alerts-${randomUUID()}`);
    expect((await user.authed(app).patch("/api/users/me/preferences").send({ notifyEmail: true })).status).toBe(400);

    const healthy = await createMailbox(user.userId, `healthy-${randomUUID()}@dayly.test`);
    expect((await user.authed(app).post(`/api/inbox/mailboxes/${healthy.id}/default`)).status).toBe(200);
    expect((await user.authed(app).patch("/api/users/me/preferences").send({ notifyEmail: true })).status).toBe(200);

    const failed = await createMailbox(user.userId, `failed-${randomUUID()}@dayly.test`, "No se pudo autenticar el buzón.");
    const selected = await user.authed(app).post(`/api/inbox/mailboxes/${failed.id}/default`);
    expect(selected.status).toBe(200);
    expect(selected.body.emailNotificationsDisabled).toBe(true);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { defaultMailboxId: true, notifyEmail: true } }))
      .toMatchObject({ defaultMailboxId: failed.id, notifyEmail: false });
    expect((await user.authed(app).patch("/api/users/me/preferences").send({ notifyEmail: true })).status).toBe(400);

    await user.authed(app).post(`/api/inbox/mailboxes/${healthy.id}/default`);
    await user.authed(app).patch("/api/users/me/preferences").send({ notifyEmail: true });
    expect((await user.authed(app).delete(`/api/inbox/mailboxes/${healthy.id}`)).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { defaultMailboxId: true, notifyEmail: true } }))
      .toMatchObject({ defaultMailboxId: failed.id, notifyEmail: false });
  });

  it("activates a user's Telegram webhook without hitting the legacy bridge", async () => {
    await saveTelegramPlatformSettings({ enabled: true });
    const user = await registerAndLogin(app, `telegram-route-${randomUUID()}`);
    const telegramBotId = String(1_000_000_000 + Math.floor(Math.random() * 8_000_000_000));
    let webhookUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(input).split("/").pop();
      const body = init?.body ? JSON.parse(String(init.body)) as { url?: string } : {};
      if (method === "getMe") return jsonResponse({ ok: true, result: { id: Number(telegramBotId), username: `route_bot_${telegramBotId}`, can_connect_to_business: true } });
      if (method === "getWebhookInfo") return jsonResponse({ ok: true, result: { url: webhookUrl, pending_update_count: 0 } });
      if (method === "setWebhook") { webhookUrl = body.url ?? ""; return jsonResponse({ ok: true, result: true }); }
      return jsonResponse({ ok: false, description: "Unexpected Telegram method" }, 400);
    }));

    const token = `${telegramBotId}:abcdefghijklmnopqrstuvwxyz_ABCDE`;
    expect((await user.authed(app).put("/api/telegram/bot").send({ token })).status).toBe(200);
    const activated = await user.authed(app).post("/api/telegram/bot/webhook").send({ replaceExisting: false });
    expect(activated.status).toBe(200);
    expect(activated.body.bot).toMatchObject({ status: "ACTIVE", businessCapable: true });
    expect(webhookUrl).toContain("/api/telegram/webhook/");
  });

  it("revokes the old bot, link and pending work when Telegram is replaced", async () => {
    await saveTelegramPlatformSettings({ enabled: true });
    const user = await registerAndLogin(app, `telegram-replace-${randomUUID()}`);
    const firstId = String(2_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    const secondId = String(4_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const id = url.includes(`/bot${firstId}:`) ? firstId : secondId;
      return jsonResponse({ ok: true, result: { id: Number(id), username: `replace_bot_${id}`, can_connect_to_business: true } });
    }));
    const tokenA = `${firstId}:abcdefghijklmnopqrstuvwxyz_ABCDE`;
    const tokenB = `${secondId}:abcdefghijklmnopqrstuvwxyz_ABCDE`;
    expect((await user.authed(app).put("/api/telegram/bot").send({ token: tokenA })).status).toBe(200);
    const oldBot = await prisma.telegramBot.findFirstOrThrow({ where: { userId: user.userId, telegramBotId: firstId } });
    const link = await prisma.telegramLink.create({ data: { userId: user.userId, botId: oldBot.id, chatId: String(Date.now()) } });
    const accountId = `business-${randomUUID()}`;
    const connection = await prisma.messagingConnection.create({ data: {
      userId: user.userId,
      provider: "TELEGRAM",
      telegramBotId: oldBot.id,
      status: "ACTIVE",
      externalAccountIdEnc: encryptMessaging(accountId),
      externalAccountIdHash: messagingHash("TELEGRAM:account", accountId),
      capabilities: {},
    } });
    const conversation = await prisma.conversation.create({ data: {
      userId: user.userId,
      connectionId: connection.id,
      externalChatIdEnc: encryptMessaging("customer"),
      externalChatIdHash: messagingHash("TELEGRAM:chat", `customer-${randomUUID()}`),
    } });
    const reply = await prisma.scheduledReply.create({ data: {
      userId: user.userId,
      conversationId: conversation.id,
      bodyEnc: encryptMessaging("Pendiente"),
      sendAt: new Date(Date.now() + 60_000),
      timezone: "UTC",
      status: "SCHEDULED",
    } });

    expect((await user.authed(app).put("/api/telegram/bot").send({ token: tokenB, replaceExisting: true })).status).toBe(200);
    expect(await prisma.telegramBot.findUniqueOrThrow({ where: { id: oldBot.id } })).toMatchObject({ status: "REVOKED", tokenEnc: "" });
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).not.toBeNull();
    expect(await prisma.messagingConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ status: "REVOKED" });
    expect(await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" });
  });

  it("warns before a Spotify app change and marks affected connections for reauthorization", async () => {
    const before = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
    const user = await registerAndLogin(app, `spotify-reconfigure-${randomUUID()}`);
    const cookie = await adminCookie(app);
    const baselineId = `base${Date.now()}`;
    const replacementId = `next${Date.now()}`;
    const externalId = `spotify-${randomUUID()}`;
    await prisma.spotifySetting.upsert({
      where: { id: 1 },
      create: { id: 1, clientId: baselineId, enabled: true, importedFromEnvAt: new Date(), validatedAt: new Date() },
      update: { clientId: baselineId, enabled: true, importedFromEnvAt: new Date(), validatedAt: new Date() },
    });
    const connection = await prisma.spotifyConnection.create({ data: {
      userId: user.userId,
      spotifyUserIdEnc: encryptSecret(externalId),
      spotifyUserIdHash: messagingHash("SPOTIFY:user", externalId),
      displayNameEnc: encryptSecret("Spotify de prueba"),
      product: "premium",
      scopes: "streaming user-read-private",
      refreshTokenEnc: encryptSecret("refresh-token"),
      status: "ACTIVE",
    } });
    try {
      const warned = await supertest(app).patch("/api/admin/spotify").set("Cookie", cookie).send({ clientId: replacementId, enabled: true });
      expect(warned.status).toBe(409);
      expect(warned.body.error.details).toMatchObject({ reason: "RECONNECT_REQUIRED", affectedConnections: 1 });
      expect((await prisma.spotifyConnection.findUniqueOrThrow({ where: { id: connection.id } })).status).toBe("ACTIVE");

      const confirmed = await supertest(app).patch("/api/admin/spotify").set("Cookie", cookie).send({ clientId: replacementId, enabled: true, confirmReconnect: true });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.spotify).toMatchObject({ configured: true, available: true, operational: false, validatedAt: null });
      expect((await prisma.spotifySetting.findUniqueOrThrow({ where: { id: 1 } })).validatedAt).toBeNull();
      expect(await prisma.spotifyConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .toMatchObject({ status: "ERROR", refreshTokenEnc: "", lastError: "La aplicación de Spotify ha cambiado. Vuelve a conectar." });
    } finally {
      await prisma.spotifyConnection.deleteMany({ where: { id: connection.id } });
      if (before) {
        await prisma.spotifySetting.upsert({
          where: { id: 1 },
          create: { id: 1, clientId: before.clientId, enabled: before.enabled, importedFromEnvAt: before.importedFromEnvAt, validatedAt: before.validatedAt },
          update: { clientId: before.clientId, enabled: before.enabled, importedFromEnvAt: before.importedFromEnvAt, validatedAt: before.validatedAt },
        });
      } else {
        await prisma.spotifySetting.deleteMany({ where: { id: 1 } });
      }
    }
  });

  it("exposes Spotify as available to users when the admin enables a valid app", async () => {
    const before = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
    const user = await registerAndLogin(app, `spotify-available-${randomUUID()}`);
    const clientId = `spotify${Date.now()}`;
    await prisma.spotifySetting.upsert({
      where: { id: 1 },
      create: { id: 1, clientId, enabled: true, importedFromEnvAt: new Date(), validatedAt: null },
      update: { clientId, enabled: true, importedFromEnvAt: new Date(), validatedAt: null },
    });
    try {
      const response = await user.authed(app).get("/api/spotify/config");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.body).toMatchObject({
        enabled: true,
        configured: true,
        available: true,
        operational: false,
        connected: false,
        connection: null,
      });
    } finally {
      if (before) {
        await prisma.spotifySetting.upsert({
          where: { id: 1 },
          create: { id: 1, clientId: before.clientId, enabled: before.enabled, importedFromEnvAt: before.importedFromEnvAt, validatedAt: before.validatedAt },
          update: { clientId: before.clientId, enabled: before.enabled, importedFromEnvAt: before.importedFromEnvAt, validatedAt: before.validatedAt },
        });
      } else {
        await prisma.spotifySetting.deleteMany({ where: { id: 1 } });
      }
    }
  });

  it("archives the old WhatsApp identity when the user connects another number", async () => {
    const user = await registerAndLogin(app, `wa-replace-${randomUUID()}`);
    await prisma.whatsAppPlatformSetting.upsert({
      where: { id: 1 },
      create: { id: 1, enabled: true, appId: "123456789", appSecretEnc: encryptSecret("meta-secret"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-token"), graphVersion: "v99.0" },
      update: { enabled: true, appId: "123456789", appSecretEnc: encryptSecret("meta-secret"), configId: "987654321", verifyTokenEnc: encryptSecret("verify-token"), graphVersion: "v99.0" },
    });
    const phoneA = `20${Date.now()}1`;
    const phoneB = `20${Date.now()}2`;
    const first = await connectWhatsApp(user.userId, phoneA, "30001");
    const conversation = await prisma.conversation.create({ data: {
      userId: user.userId,
      connectionId: first.id,
      externalChatIdEnc: encryptMessaging("customer"),
      externalChatIdHash: messagingHash("WHATSAPP:chat", "customer"),
      displayNameEnc: encryptMessaging("Cliente"),
      lastMessageAt: new Date(),
      lastActivityAt: new Date(),
    } });
    const reply = await prisma.scheduledReply.create({ data: { userId: user.userId, conversationId: conversation.id, bodyEnc: encryptMessaging("Pendiente"), sendAt: new Date(Date.now() + 60_000), timezone: "UTC", status: "SCHEDULED" } });

    const second = await connectWhatsApp(user.userId, phoneB, "30002");
    expect(second.id).not.toBe(first.id);
    expect(await prisma.messagingConnection.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "REVOKED", credentialEnc: null });
    expect(await prisma.scheduledReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" });
    expect(await prisma.messagingConnection.count({ where: { userId: user.userId, provider: "WHATSAPP", status: "ACTIVE" } })).toBe(1);
    expect((await prisma.whatsAppPlatformSetting.findUniqueOrThrow({ where: { id: 1 } })).validatedAt).not.toBeNull();
  });

  it("can repeat the environment bootstrap without overwriting stored settings", async () => {
    await bootstrapIntegrationSettings();
    const before = await integrationTimestamps();
    await bootstrapIntegrationSettings();
    expect(await integrationTimestamps()).toEqual(before);
  });
});

async function createMailbox(userId: string, email: string, lastError: string | null = null) {
  return prisma.mailbox.create({ data: { userId, label: email, email, imapHost: "imap.example.com", smtpHost: "smtp.example.com", username: email, passwordEnc: encryptSecret("test-password"), lastError } });
}

async function integrationTimestamps() {
  const [smtp, telegram, spotify, google, whatsapp] = await Promise.all([
    prisma.smtpSetting.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
    prisma.telegramSetting.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
    prisma.spotifySetting.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
    prisma.googleOAuthSetting.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
    prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
  ]);
  return [smtp, telegram, spotify, google, whatsapp].map((row) => row?.updatedAt.toISOString() ?? null);
}

async function connectWhatsApp(userId: string, phoneNumberId: string, wabaId: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/oauth/access_token")) return jsonResponse({ access_token: `token-${phoneNumberId}` });
    if (url.includes(`/${phoneNumberId}?`)) return jsonResponse({ id: phoneNumberId, display_phone_number: phoneNumberId, verified_name: "DAYLY Test" });
    if (url.includes(`/${wabaId}/phone_numbers`)) return jsonResponse({ data: [{ id: phoneNumberId }] });
    if (url.includes(`/${wabaId}/subscribed_apps`)) return jsonResponse({ success: true });
    return jsonResponse({ error: { message: "Unexpected Meta URL" } }, 404);
  }));
  return completeWhatsAppEmbeddedSignup({ userId, code: `code-${randomUUID()}`, phoneNumberId, wabaId });
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
