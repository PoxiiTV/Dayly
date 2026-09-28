import type { Conversation, MessagingConnection, MessagingProvider } from "@prisma/client";
import { decryptMessaging, decryptMessagingJson } from "../messagingCrypto.js";
import { getTelegramFile, sendTelegramBusinessMessage, TelegramRequestError } from "../telegram.js";
import { platformProviderEnabled, resolveWhatsAppPlatformConfig } from "../integrationSettings.js";
import { prisma } from "../prisma.js";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/mpeg", "audio/mp4", "audio/ogg", "video/mp4",
  "application/pdf", "text/plain",
]);

export type ProviderCapabilities = {
  sendText: boolean;
  receiveMedia: boolean;
  sendMedia: false;
  readReceipts: false;
  replyWindowHours: 24;
};

export const PROVIDER_CAPABILITIES: Record<MessagingProvider, ProviderCapabilities> = {
  TELEGRAM: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 },
  WHATSAPP: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 },
};

export class ProviderSendError extends Error {
  constructor(message: string, public readonly code: string, public readonly ambiguous: boolean) {
    super(message);
    this.name = "ProviderSendError";
  }
}

export type ProviderSendResult = { providerMessageId: string; sentAt: Date };
export type ProviderMedia = { body: Buffer; mimeType: string; filename: string };

type WhatsAppData = { phoneNumberId?: string; wabaId?: string };
export type ProviderTemplate = { name: string; language: string; parameters: string[] };

export function providerEnabled(provider: MessagingProvider): boolean {
  return platformProviderEnabled(provider);
}

export function connectionCanReply(
  connection: Pick<MessagingConnection, "provider" | "status" | "capabilities">,
): boolean {
  const capabilities = connection.capabilities as { sendText?: boolean } | null;
  return connection.status === "ACTIVE" && providerEnabled(connection.provider) && capabilities?.sendText !== false;
}

export async function sendProviderText(
  connection: MessagingConnection,
  conversation: Conversation,
  text: string,
  template?: ProviderTemplate | null,
): Promise<ProviderSendResult> {
  if (!providerEnabled(connection.provider)) {
    throw new ProviderSendError("Este canal no está habilitado en el servidor.", "PROVIDER_DISABLED", false);
  }
  const capabilities = connection.capabilities as { sendText?: boolean } | null;
  if (capabilities?.sendText === false) {
    throw new ProviderSendError("La conexión no tiene permiso para responder mensajes.", "MISSING_REPLY_PERMISSION", false);
  }
  const chatId = decryptMessaging(conversation.externalChatIdEnc);
  if (template && connection.provider !== "WHATSAPP") {
    throw new ProviderSendError("Las plantillas solo existen en WhatsApp.", "TEMPLATE_UNSUPPORTED", false);
  }
  if (connection.provider === "TELEGRAM") {
    const bot = connection.telegramBotId ? await prisma.telegramBot.findUnique({ where: { id: connection.telegramBotId } }) : null;
    if (!bot || bot.status !== "ACTIVE") throw new ProviderSendError("El bot de Telegram ya no está activo.", "TELEGRAM_BOT_INACTIVE", false);
    try {
      const result = await sendTelegramBusinessMessage(bot, decryptMessaging(connection.externalAccountIdEnc), chatId, text);
      return { providerMessageId: String(result.message_id), sentAt: new Date(result.date * 1000) };
    } catch (error) {
      if (error instanceof TelegramRequestError) {
        throw new ProviderSendError(error.message, error.status ? `TELEGRAM_${error.status}` : "TELEGRAM_TRANSPORT", error.ambiguous);
      }
      throw new ProviderSendError("Telegram no pudo completar el envío.", "TELEGRAM_ERROR", true);
    }
  }

  const graph = await whatsappGraphConfig();
  const providerData = decryptMessagingJson<WhatsAppData>(connection.providerDataEnc, {});
  const phoneNumberId = providerData.phoneNumberId || decryptMessaging(connection.externalAccountIdEnc);
  const token = connection.credentialEnc ? decryptMessaging(connection.credentialEnc) : "";
  if (!token || !phoneNumberId) throw new ProviderSendError("La conexión de WhatsApp está incompleta.", "WHATSAPP_NOT_CONFIGURED", false);
  let response: Response;
  try {
    response = await fetch(`${graph.baseUrl}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(template
        ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: chatId,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            components: template.parameters.length
              ? [{ type: "body", parameters: template.parameters.map((value) => ({ type: "text", text: value })) }]
              : [],
          },
        }
        : { messaging_product: "whatsapp", recipient_type: "individual", to: chatId, type: "text", text: { preview_url: false, body: text } }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ProviderSendError("No se pudo confirmar la respuesta de WhatsApp.", "WHATSAPP_TRANSPORT", true);
  }
  let payload: { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } = {};
  try { payload = await response.json() as typeof payload; } catch { /* handled below */ }
  const id = payload.messages?.[0]?.id;
  if (!response.ok || !id) {
    const code = payload.error?.code ? `WHATSAPP_${payload.error.code}` : `WHATSAPP_${response.status}`;
    throw new ProviderSendError(payload.error?.message || "WhatsApp rechazó el envío.", code, response.status >= 500);
  }
  return { providerMessageId: id, sentAt: new Date() };
}

export async function fetchProviderMedia(
  connection: MessagingConnection,
  mediaHandle: string,
  metadata: { mimeType?: string; filename?: string },
): Promise<ProviderMedia> {
  if (!providerEnabled(connection.provider)) throw new ProviderSendError("Este canal no está habilitado.", "PROVIDER_DISABLED", false);
  if (connection.provider === "TELEGRAM") {
    const bot = connection.telegramBotId ? await prisma.telegramBot.findUnique({ where: { id: connection.telegramBotId } }) : null;
    if (!bot || bot.status !== "ACTIVE") throw new ProviderSendError("El bot de Telegram ya no está activo.", "TELEGRAM_BOT_INACTIVE", false);
    const file = await getTelegramFile(bot, mediaHandle);
    if ((file.file_size ?? 0) > MAX_MEDIA_BYTES) throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
    return downloadMedia(file.url, {}, metadata);
  }
  const graph = await whatsappGraphConfig();
  const token = connection.credentialEnc ? decryptMessaging(connection.credentialEnc) : "";
  if (!token) throw new ProviderSendError("La conexión de WhatsApp está incompleta.", "WHATSAPP_NOT_CONFIGURED", false);
  const metadataResponse = await fetch(`${graph.baseUrl}/${encodeURIComponent(mediaHandle)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const info = await metadataResponse.json() as { url?: string; mime_type?: string; file_size?: number; error?: { message?: string } };
  if (!metadataResponse.ok || !info.url) throw new ProviderSendError(info.error?.message || "WhatsApp ya no conserva este archivo.", "MEDIA_UNAVAILABLE", false);
  if ((info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
  return downloadMedia(info.url, { Authorization: `Bearer ${token}` }, { ...metadata, mimeType: info.mime_type || metadata.mimeType });
}

async function downloadMedia(url: string, headers: Record<string, string>, metadata: { mimeType?: string; filename?: string }): Promise<ProviderMedia> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new ProviderSendError("El proveedor ya no conserva este archivo.", "MEDIA_UNAVAILABLE", false);
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_MEDIA_BYTES) throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
  const mimeType = (metadata.mimeType || response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!MEDIA_TYPES.has(mimeType)) throw new ProviderSendError("El tipo de archivo no está permitido.", "MEDIA_TYPE_BLOCKED", false);
  const body = await readMediaBody(response);
  if (body.byteLength > MAX_MEDIA_BYTES) throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
  const filename = safeFilename(metadata.filename || `archivo.${extensionFor(mimeType)}`);
  return { body, mimeType, filename };
}

async function readMediaBody(response: Response): Promise<Buffer> {
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_MEDIA_BYTES) throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw new ProviderSendError("El archivo supera el límite de 10 MB.", "MEDIA_TOO_LARGE", false);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function whatsappGraphConfig() {
  let version: string;
  try { version = (await resolveWhatsAppPlatformConfig()).graphVersion; }
  catch {
    throw new ProviderSendError("Falta configurar una versión Graph de WhatsApp revisada y vigente.", "WHATSAPP_GRAPH_VERSION", false);
  }
  return { baseUrl: `https://graph.facebook.com/${version}` };
}

function safeFilename(value: string): string {
  const safe = value.replace(/[\r\n\\/\0]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  return (safe || "archivo").slice(0, 180);
}

function extensionFor(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg", "video/mp4": "mp4", "application/pdf": "pdf", "text/plain": "txt" } as Record<string, string>)[mime] || "bin";
}
