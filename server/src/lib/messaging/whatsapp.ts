import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "../errors.js";
import { getWhatsAppPlatformConfig, resolveWhatsAppPlatformConfig, resolveWhatsAppWebhookSecrets } from "../integrationSettings.js";
import type { MessagingConnection } from "@prisma/client";
import { logger } from "../logger.js";
import { decryptMessaging, decryptMessagingJson, encryptMessaging, encryptMessagingJson, messagingHash } from "../messagingCrypto.js";
import { prisma } from "../prisma.js";
import { PROVIDER_CAPABILITIES } from "./providers.js";

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } };
type PhoneResponse = { id?: string; display_phone_number?: string; verified_name?: string; error?: { message?: string } };

export async function whatsappPublicConfig() {
  const platform = await getWhatsAppPlatformConfig();
  return {
    enabled: platform.enabled,
    configured: platform.configured,
    available: platform.available,
    operational: platform.operational,
    appId: platform.available ? platform.appId : null,
    configId: platform.available ? platform.configId : null,
    graphVersion: platform.available ? platform.graphVersion : null,
  };
}

export async function whatsappConfigured(): Promise<boolean> {
  return (await getWhatsAppPlatformConfig()).available;
}

export async function completeWhatsAppEmbeddedSignup(input: {
  userId: string;
  code: string;
  phoneNumberId: string;
  wabaId: string;
}) {
  const platform = await resolveWhatsAppPlatformConfig();
  const graphBase = `https://graph.facebook.com/${platform.graphVersion}`;
  const tokenUrl = new URL(`${graphBase}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", platform.appId);
  tokenUrl.searchParams.set("client_secret", platform.appSecret);
  tokenUrl.searchParams.set("code", input.code);
  const tokenResponse = await fetch(tokenUrl, { method: "GET", signal: AbortSignal.timeout(12_000) });
  const tokenPayload = await safeJson<TokenResponse>(tokenResponse);
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw ApiError.badRequest(tokenPayload.error?.message || "Meta no pudo completar la conexión.");
  }
  const token = tokenPayload.access_token;
  const auth = { Authorization: `Bearer ${token}` };
  const phoneResponse = await fetch(`${graphBase}/${encodeURIComponent(input.phoneNumberId)}?fields=id,display_phone_number,verified_name`, {
    headers: auth,
    signal: AbortSignal.timeout(10_000),
  });
  const phone = await safeJson<PhoneResponse>(phoneResponse);
  if (!phoneResponse.ok || phone.id !== input.phoneNumberId) throw ApiError.badRequest(phone.error?.message || "El número de WhatsApp no pudo verificarse.");

  const numbersResponse = await fetch(`${graphBase}/${encodeURIComponent(input.wabaId)}/phone_numbers?fields=id&limit=100`, {
    headers: auth,
    signal: AbortSignal.timeout(10_000),
  });
  const numbers = await safeJson<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(numbersResponse);
  if (!numbersResponse.ok || !numbers.data?.some((item) => item.id === input.phoneNumberId)) {
    throw ApiError.badRequest(numbers.error?.message || "El número no pertenece a la cuenta empresarial seleccionada.");
  }

  const subscribe = await fetch(`${graphBase}/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
    method: "POST",
    headers: auth,
    signal: AbortSignal.timeout(10_000),
  });
  const subscribed = await safeJson<{ success?: boolean; error?: { message?: string } }>(subscribe);
  if (!subscribe.ok || subscribed.success !== true) throw ApiError.badRequest(subscribed.error?.message || "No se pudo activar el webhook de la cuenta de WhatsApp.");

  const externalAccountIdHash = messagingHash("WHATSAPP:account", input.phoneNumberId);
  const label = [phone.verified_name, phone.display_phone_number].filter(Boolean).join(" · ") || "WhatsApp Business";
  try {
    const existing = await prisma.messagingConnection.findUnique({
      where: { provider_externalAccountIdHash: { provider: "WHATSAPP", externalAccountIdHash } },
    });
    // A number another account disconnected can be claimed, but never by
    // reusing that row: its conversations belong to the previous owner.
    if (existing && existing.userId !== input.userId && existing.status !== "REVOKED") {
      throw ApiError.conflict("Ese número de WhatsApp ya está conectado a otra cuenta.");
    }
    const reuse = existing && existing.userId === input.userId ? existing : null;
    const saved = await prisma.$transaction(async (tx) => {
      if (existing && !reuse) {
        const released = await tx.messagingConnection.updateMany({
          where: { id: existing.id, status: "REVOKED" },
          data: { externalAccountIdHash: messagingHash("WHATSAPP:released", existing.id), credentialEnc: null },
        });
        if (released.count !== 1) throw ApiError.conflict("Ese número de WhatsApp ya está conectado a otra cuenta.");
      }
      const previous = await tx.messagingConnection.findMany({
        where: { userId: input.userId, provider: "WHATSAPP", status: { not: "REVOKED" }, ...(reuse ? { id: { not: reuse.id } } : {}) },
        select: { id: true },
      });
      const previousIds = previous.map(({ id }) => id);
      if (previousIds.length) {
        await tx.scheduledReply.updateMany({
          where: { userId: input.userId, conversation: { connectionId: { in: previousIds } }, status: { in: ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"] } },
          data: { status: "CANCELED", lastErrorCode: "CONNECTION_REPLACED" },
        });
        await tx.messagingConnection.updateMany({ where: { id: { in: previousIds } }, data: { status: "REVOKED", revokedAt: new Date(), credentialEnc: null } });
      }
      const data = {
        userId: input.userId,
        provider: "WHATSAPP",
        status: "ACTIVE",
        externalAccountIdEnc: encryptMessaging(input.phoneNumberId),
        externalAccountIdHash,
        labelEnc: encryptMessaging(label),
        credentialEnc: encryptMessaging(token),
        providerDataEnc: encryptMessagingJson({ phoneNumberId: input.phoneNumberId, wabaId: input.wabaId }),
        capabilities: PROVIDER_CAPABILITIES.WHATSAPP,
        lastError: null,
        connectedAt: new Date(),
        revokedAt: null,
        disconnectedByUserAt: null,
      } as const;
      const result = reuse
        ? await tx.messagingConnection.update({ where: { id: reuse.id }, data })
        : await tx.messagingConnection.create({ data });
      await tx.whatsAppPlatformSetting.updateMany({ where: { id: 1, enabled: true }, data: { validatedAt: new Date() } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await requestWhatsAppAppSync(graphBase, token, input.phoneNumberId);
    return saved;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict("Ese número de WhatsApp ya está conectado a otra cuenta.");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw ApiError.conflict("Otra conexión de WhatsApp cambió a la vez. Vuelve a intentarlo.");
    }
    throw error;
  }
}

export async function verifyWhatsAppSignature(rawBody: Buffer, signature: string): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  let appSecret: string;
  try { appSecret = (await resolveWhatsAppWebhookSecrets()).appSecret; } catch { return false; }
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyWhatsAppChallenge(mode: string, token: string): Promise<boolean> {
  if (mode !== "subscribe") return false;
  let verifyToken: string;
  try { verifyToken = (await resolveWhatsAppWebhookSecrets()).verifyToken; } catch { return false; }
  const a = Buffer.from(verifyToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Coexistence numbers (WhatsApp Business app + Cloud API) can share their
// contacts and last months of chats once, within 24 hours of onboarding.
// Numbers onboarded without the app reject it; that is not a failure.
async function requestWhatsAppAppSync(graphBase: string, token: string, phoneNumberId: string) {
  for (const syncType of ["smb_app_state_sync", "history"]) {
    try {
      const response = await fetch(`${graphBase}/${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) logger.info({ syncType, status: response.status }, "WhatsApp app sync not started");
    } catch (error) {
      logger.info({ err: error, syncType }, "WhatsApp app sync request failed");
    }
  }
}

/**
 * Best effort: stops Meta from delivering webhooks for a WABA nobody uses
 * anymore. Other active connections on the same WABA keep the subscription.
 */
export async function releaseWhatsAppConnection(connection: MessagingConnection): Promise<void> {
  if (connection.provider !== "WHATSAPP" || !connection.credentialEnc) return;
  const data = decryptMessagingJson<{ wabaId?: string }>(connection.providerDataEnc, {});
  if (!data.wabaId) return;
  const others = await prisma.messagingConnection.findMany({
    where: { provider: "WHATSAPP", status: "ACTIVE", id: { not: connection.id } },
    select: { providerDataEnc: true },
  });
  if (others.some((row) => decryptMessagingJson<{ wabaId?: string }>(row.providerDataEnc, {}).wabaId === data.wabaId)) return;
  try {
    const platform = await resolveWhatsAppPlatformConfig();
    const response = await fetch(`https://graph.facebook.com/${platform.graphVersion}/${encodeURIComponent(data.wabaId)}/subscribed_apps`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${decryptMessaging(connection.credentialEnc)}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) logger.info({ status: response.status }, "WhatsApp webhook unsubscribe rejected");
  } catch (error) {
    logger.info({ err: error }, "WhatsApp webhook unsubscribe failed");
  }
}

async function safeJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; } catch { return {} as T; }
}

export type WhatsAppTemplate = {
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  parameterCount: number;
};

type GraphTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; url?: string }> }>;
};

const TEMPLATE_BUTTONS = new Set(["QUICK_REPLY", "PHONE_NUMBER", "URL"]);

/**
 * Approved templates this app can send: positional body variables only, a
 * plain-text header without variables and buttons that need no parameters.
 */
export function supportedWhatsAppTemplate(raw: GraphTemplate): WhatsAppTemplate | null {
  if (raw.status !== "APPROVED" || !raw.name || !raw.language || raw.category === "AUTHENTICATION") return null;
  let header: string | null = null;
  let body: string | null = null;
  let footer: string | null = null;
  for (const component of raw.components ?? []) {
    const type = component.type?.toUpperCase();
    if (type === "HEADER") {
      if (component.format?.toUpperCase() !== "TEXT" || !component.text || component.text.includes("{{")) return null;
      header = component.text;
    } else if (type === "BODY") {
      if (!component.text) return null;
      body = component.text;
    } else if (type === "FOOTER") {
      footer = component.text ?? null;
    } else if (type === "BUTTONS") {
      for (const button of component.buttons ?? []) {
        const kind = button.type?.toUpperCase() ?? "";
        if (!TEMPLATE_BUTTONS.has(kind) || (kind === "URL" && button.url?.includes("{{"))) return null;
      }
    } else {
      return null;
    }
  }
  if (!body) return null;
  const variables = [...body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => match[1]);
  if (variables.some((name) => !/^\d+$/.test(name))) return null;
  const indexes = [...new Set(variables.map(Number))].sort((a, b) => a - b);
  if (indexes.some((value, i) => value !== i + 1)) return null;
  return { name: raw.name, language: raw.language, category: raw.category ?? "UTILITY", header, body, footer, parameterCount: indexes.length };
}

export function renderWhatsAppTemplate(template: WhatsAppTemplate, parameters: string[]): string {
  const body = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, index: string) => parameters[Number(index) - 1] ?? "");
  return [template.header, body, template.footer].filter(Boolean).join("\n\n");
}

export async function listWhatsAppTemplates(connection: MessagingConnection): Promise<WhatsAppTemplate[]> {
  if (connection.provider !== "WHATSAPP" || !connection.credentialEnc) throw ApiError.conflict("La conexión de WhatsApp no está activa.");
  const data = decryptMessagingJson<{ wabaId?: string }>(connection.providerDataEnc, {});
  if (!data.wabaId) throw ApiError.conflict("Vuelve a conectar WhatsApp para usar plantillas.");
  const platform = await resolveWhatsAppPlatformConfig();
  const url = new URL(`https://graph.facebook.com/${platform.graphVersion}/${encodeURIComponent(data.wabaId)}/message_templates`);
  url.searchParams.set("fields", "name,language,status,category,components");
  url.searchParams.set("status", "APPROVED");
  url.searchParams.set("limit", "100");
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${decryptMessaging(connection.credentialEnc)}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw ApiError.badRequest("No se pudieron cargar las plantillas de WhatsApp.");
  }
  const payload = await safeJson<{ data?: GraphTemplate[]; error?: { message?: string } }>(response);
  if (!response.ok) throw ApiError.badRequest(payload.error?.message || "No se pudieron cargar las plantillas de WhatsApp.");
  return (payload.data ?? []).map(supportedWhatsAppTemplate).filter((item): item is WhatsAppTemplate => Boolean(item));
}
