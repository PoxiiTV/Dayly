import type { MessagingProvider } from "@prisma/client";
import { config } from "../config/env.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { ApiError } from "./errors.js";
import { isSpotifyClientId } from "./spotifyClientId.js";
import { prisma } from "./prisma.js";

const GRAPH_VERSION = /^v\d+\.\d+$/;
const runtime = {
  initialized: false,
  telegramBusinessEnabled: false,
  whatsappEnabled: false,
};

/**
 * Imports legacy environment values once. Presence of a database row is the
 * boundary: after bootstrap, clearing or disabling a setting cannot silently
 * resurrect an environment credential.
 */
export async function bootstrapIntegrationSettings(): Promise<void> {
  const now = new Date();

  const smtp = await prisma.smtpSetting.findUnique({ where: { id: 1 } });
  if (!smtp) {
    await prisma.smtpSetting.create({
      data: {
        id: 1,
        host: config.smtp.host,
        port: config.smtp.port,
        username: config.smtp.user,
        passwordEnc: config.smtp.pass ? encryptSecret(config.smtp.pass) : null,
        fromAddress: config.smtp.from,
      },
    });
  }

  const telegram = await prisma.telegramSetting.findUnique({ where: { id: 1 } });
  if (!telegram) {
    await prisma.telegramSetting.create({
      data: {
        id: 1,
        enabled: config.messaging.telegramBusinessEnabled,
        botTokenEnc: config.telegram.botToken ? encryptSecret(config.telegram.botToken) : null,
        webhookSecretEnc: config.telegram.webhookSecret ? encryptSecret(config.telegram.webhookSecret) : null,
        importedFromEnvAt: now,
      },
    });
  } else if (!telegram.importedFromEnvAt) {
    await prisma.telegramSetting.update({
      where: { id: 1 },
      data: {
        enabled: config.messaging.telegramBusinessEnabled,
        botTokenEnc: telegram.botTokenEnc ?? (config.telegram.botToken ? encryptSecret(config.telegram.botToken) : null),
        webhookSecretEnc: telegram.webhookSecretEnc ?? (config.telegram.webhookSecret ? encryptSecret(config.telegram.webhookSecret) : null),
        importedFromEnvAt: now,
      },
    });
  }

  const spotify = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
  if (!spotify) {
    const clientId = config.spotifyClientId.trim();
    const previouslyConnected = await prisma.spotifyConnection.count({ where: { status: "ACTIVE" } });
    await prisma.spotifySetting.create({ data: { id: 1, enabled: isSpotifyClientId(clientId), clientId, importedFromEnvAt: now, validatedAt: previouslyConnected ? now : null } });
  } else if (!spotify.importedFromEnvAt) {
    const clientId = spotify.clientId.trim() || config.spotifyClientId.trim();
    await prisma.spotifySetting.update({
      where: { id: 1 },
      data: { clientId, enabled: isSpotifyClientId(clientId), importedFromEnvAt: now },
    });
  }

  const google = await prisma.googleOAuthSetting.findUnique({ where: { id: 1 } });
  if (!google) {
    const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    const secret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
    const previouslyConnected = await prisma.mailbox.count({ where: { authType: "google", oauthRefreshEnc: { not: null } } });
    await prisma.googleOAuthSetting.create({
      data: {
        id: 1,
        enabled: Boolean(clientId && secret),
        clientId,
        clientSecretEnc: secret ? encryptSecret(secret) : null,
        importedFromEnvAt: now,
        validatedAt: clientId && secret && previouslyConnected ? now : null,
      },
    });
  }

  const whatsapp = await prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 } });
  if (!whatsapp) {
    const previouslyConnected = await prisma.messagingConnection.count({ where: { provider: "WHATSAPP", status: "ACTIVE" } });
    await prisma.whatsAppPlatformSetting.create({
      data: {
        id: 1,
        enabled: config.messaging.whatsappEnabled,
        appId: config.messaging.whatsappAppId,
        appSecretEnc: config.messaging.whatsappAppSecret ? encryptSecret(config.messaging.whatsappAppSecret) : null,
        configId: config.messaging.whatsappConfigId,
        verifyTokenEnc: config.messaging.whatsappVerifyToken ? encryptSecret(config.messaging.whatsappVerifyToken) : null,
        graphVersion: config.messaging.whatsappGraphVersion,
        importedFromEnvAt: now,
        validatedAt: previouslyConnected ? now : null,
      },
    });
  }

  await refreshPlatformRuntime();
}

export async function refreshPlatformRuntime(): Promise<void> {
  const [telegram, whatsapp] = await Promise.all([
    prisma.telegramSetting.findUnique({ where: { id: 1 }, select: { enabled: true } }),
    prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 }, select: { enabled: true } }),
  ]);
  runtime.telegramBusinessEnabled = Boolean(telegram?.enabled);
  runtime.whatsappEnabled = Boolean(whatsapp?.enabled);
  runtime.initialized = true;
}

export function platformProviderEnabled(provider: MessagingProvider): boolean {
  if (!runtime.initialized) {
    return provider === "TELEGRAM" ? config.messaging.telegramBusinessEnabled : config.messaging.whatsappEnabled;
  }
  return provider === "TELEGRAM" ? runtime.telegramBusinessEnabled : runtime.whatsappEnabled;
}

export async function getTelegramPlatformSettings() {
  const row = await prisma.telegramSetting.findUnique({ where: { id: 1 } });
  return { enabled: Boolean(row?.enabled) };
}

export async function saveTelegramPlatformSettings(input: { enabled: boolean }) {
  await prisma.telegramSetting.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: input.enabled, importedFromEnvAt: new Date() },
    update: { enabled: input.enabled },
  });
  await refreshPlatformRuntime();
  return getTelegramPlatformSettings();
}

export async function getGooglePlatformConfig() {
  const row = await prisma.googleOAuthSetting.findUnique({ where: { id: 1 } });
  const secretConfigured = Boolean(row?.clientSecretEnc);
  const configured = Boolean(row?.clientId.trim() && secretConfigured);
  const available = Boolean(row?.enabled && configured);
  return {
    enabled: Boolean(row?.enabled),
    configured,
    available,
    operational: Boolean(available && row?.validatedAt),
    clientId: row?.clientId ?? "",
    clientSecretConfigured: secretConfigured,
    validatedAt: row?.validatedAt?.toISOString() ?? null,
  };
}

export async function resolveGooglePlatformConfig() {
  const row = await prisma.googleOAuthSetting.findUnique({ where: { id: 1 } });
  const secret = row?.clientSecretEnc ? decryptSecret(row.clientSecretEnc) : "";
  if (!row?.enabled || !row.clientId.trim() || !secret) {
    throw ApiError.badRequest("Gmail con Google no está habilitado por el administrador.");
  }
  return { clientId: row.clientId.trim(), clientSecret: secret };
}

export async function saveGooglePlatformConfig(input: { enabled: boolean; clientId: string; clientSecret?: string; confirmReconnect?: boolean }) {
  const current = await prisma.googleOAuthSetting.findUnique({ where: { id: 1 } });
  const clientId = input.clientId.trim();
  const currentSecret = current?.clientSecretEnc ? decryptSecret(current.clientSecretEnc) : "";
  const nextSecret = input.clientSecret === undefined ? currentSecret : input.clientSecret.trim();
  const clientSecretEnc = input.clientSecret === undefined
    ? current?.clientSecretEnc ?? null
    : nextSecret ? encryptSecret(nextSecret) : null;
  if (input.enabled && (!clientId || !clientSecretEnc)) {
    throw ApiError.badRequest("Indica Client ID y Client Secret antes de habilitar Google.");
  }
  const identityChanged = Boolean(current && (current.clientId.trim() !== clientId || currentSecret !== nextSecret));
  const affectedConnections = identityChanged
    ? await prisma.mailbox.count({ where: { authType: "google", oauthRefreshEnc: { not: null } } })
    : 0;
  if (affectedConnections && !input.confirmReconnect) {
    throw ApiError.conflict("Cambiar la aplicación de Google obliga a volver a conectar los buzones Gmail.", {
      reason: "RECONNECT_REQUIRED",
      affectedConnections,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.googleOAuthSetting.upsert({
      where: { id: 1 },
      create: { id: 1, enabled: input.enabled, clientId, clientSecretEnc, importedFromEnvAt: new Date() },
      update: { enabled: input.enabled, clientId, clientSecretEnc, validatedAt: identityChanged ? null : undefined },
    });
    if (affectedConnections) {
      await tx.mailbox.updateMany({
        where: { authType: "google", oauthRefreshEnc: { not: null } },
        data: { oauthRefreshEnc: null, lastError: "La aplicación de Google ha cambiado. Vuelve a conectar Gmail." },
      });
      await tx.user.updateMany({ where: { defaultMailbox: { authType: "google" } }, data: { notifyEmail: false } });
    }
  });
  return getGooglePlatformConfig();
}

export async function markGooglePlatformValidated(): Promise<void> {
  await prisma.googleOAuthSetting.updateMany({ where: { id: 1, enabled: true }, data: { validatedAt: new Date() } });
}

export async function getWhatsAppPlatformConfig() {
  const row = await prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 } });
  const appSecretConfigured = Boolean(row?.appSecretEnc);
  const verifyTokenConfigured = Boolean(row?.verifyTokenEnc);
  const configured = Boolean(
    row?.appId.trim()
    && row.configId.trim()
    && GRAPH_VERSION.test(row.graphVersion.trim())
    && appSecretConfigured
    && verifyTokenConfigured,
  );
  const available = Boolean(row?.enabled && configured);
  return {
    enabled: Boolean(row?.enabled),
    configured,
    available,
    operational: Boolean(available && row?.validatedAt),
    appId: row?.appId ?? "",
    configId: row?.configId ?? "",
    graphVersion: row?.graphVersion ?? "",
    appSecretConfigured,
    verifyTokenConfigured,
    validatedAt: row?.validatedAt?.toISOString() ?? null,
  };
}

export async function resolveWhatsAppPlatformConfig() {
  const row = await prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 } });
  const appSecret = row?.appSecretEnc ? decryptSecret(row.appSecretEnc) : "";
  const verifyToken = row?.verifyTokenEnc ? decryptSecret(row.verifyTokenEnc) : "";
  if (!row?.enabled || !row.appId.trim() || !row.configId.trim() || !appSecret || !verifyToken || !GRAPH_VERSION.test(row.graphVersion.trim())) {
    throw ApiError.badRequest("WhatsApp no está habilitado o su configuración está incompleta.");
  }
  return {
    appId: row.appId.trim(),
    appSecret,
    configId: row.configId.trim(),
    verifyToken,
    graphVersion: row.graphVersion.trim(),
  };
}

export async function resolveWhatsAppWebhookSecrets() {
  const row = await prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 } });
  const appSecret = row?.appSecretEnc ? decryptSecret(row.appSecretEnc) : "";
  const verifyToken = row?.verifyTokenEnc ? decryptSecret(row.verifyTokenEnc) : "";
  if (!appSecret || !verifyToken) throw ApiError.badRequest("La verificación de WhatsApp no está configurada.");
  return { appSecret, verifyToken };
}

export async function saveWhatsAppPlatformConfig(input: {
  enabled: boolean;
  appId: string;
  appSecret?: string;
  configId: string;
  verifyToken?: string;
  graphVersion: string;
  confirmReconnect?: boolean;
}) {
  const current = await prisma.whatsAppPlatformSetting.findUnique({ where: { id: 1 } });
  const currentAppSecret = current?.appSecretEnc ? decryptSecret(current.appSecretEnc) : "";
  const currentVerifyToken = current?.verifyTokenEnc ? decryptSecret(current.verifyTokenEnc) : "";
  const nextAppSecret = input.appSecret === undefined ? currentAppSecret : input.appSecret.trim();
  const nextVerifyToken = input.verifyToken === undefined ? currentVerifyToken : input.verifyToken.trim();
  const appSecretEnc = input.appSecret === undefined ? current?.appSecretEnc ?? null : nextAppSecret ? encryptSecret(nextAppSecret) : null;
  const verifyTokenEnc = input.verifyToken === undefined ? current?.verifyTokenEnc ?? null : nextVerifyToken ? encryptSecret(nextVerifyToken) : null;
  const appId = input.appId.trim();
  const configId = input.configId.trim();
  const graphVersion = input.graphVersion.trim();
  if (graphVersion && !GRAPH_VERSION.test(graphVersion)) throw ApiError.badRequest("La versión Graph debe tener formato vNN.N.");
  if (input.enabled && (!appId || !configId || !appSecretEnc || !verifyTokenEnc || !graphVersion)) {
    throw ApiError.badRequest("Completa todos los datos de Meta antes de habilitar WhatsApp.");
  }
  const identityChanged = Boolean(current?.appId.trim() && current.appId.trim() !== appId);
  const validationChanged = Boolean(current && (
    current.appId.trim() !== appId
    || current.configId.trim() !== configId
    || current.graphVersion.trim() !== graphVersion
    || currentAppSecret !== nextAppSecret
    || currentVerifyToken !== nextVerifyToken
  ));
  const affectedConnections = identityChanged
    ? await prisma.messagingConnection.count({ where: { provider: "WHATSAPP", status: "ACTIVE" } })
    : 0;
  if (affectedConnections && !input.confirmReconnect) {
    throw ApiError.conflict("Cambiar la aplicación de Meta obliga a volver a conectar los números de WhatsApp.", {
      reason: "RECONNECT_REQUIRED",
      affectedConnections,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.whatsAppPlatformSetting.upsert({
      where: { id: 1 },
      create: { id: 1, enabled: input.enabled, appId, appSecretEnc, configId, verifyTokenEnc, graphVersion, importedFromEnvAt: new Date() },
      update: { enabled: input.enabled, appId, appSecretEnc, configId, verifyTokenEnc, graphVersion, validatedAt: validationChanged ? null : undefined },
    });
    if (affectedConnections) {
      const connections = await tx.messagingConnection.findMany({ where: { provider: "WHATSAPP", status: "ACTIVE" }, select: { id: true } });
      const ids = connections.map(({ id }) => id);
      if (ids.length) {
        await tx.scheduledReply.updateMany({
          where: { conversation: { connectionId: { in: ids } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
          data: { status: "CANCELED", lastErrorCode: "PLATFORM_RECONFIGURED" },
        });
        await tx.messagingConnection.updateMany({
          where: { id: { in: ids } },
          data: { status: "ERROR", credentialEnc: null, lastError: "La aplicación de Meta ha cambiado. Vuelve a conectar WhatsApp." },
        });
      }
    }
  });
  await refreshPlatformRuntime();
  return getWhatsAppPlatformConfig();
}

export async function markWhatsAppPlatformValidated(): Promise<void> {
  await prisma.whatsAppPlatformSetting.updateMany({ where: { id: 1, enabled: true }, data: { validatedAt: new Date() } });
}
