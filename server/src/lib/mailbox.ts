import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import type { Mailbox } from "@prisma/client";
import { ApiError } from "./errors.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { clearGoogleAccessCache, googleAccessToken, GMAIL_IMAP_HOST, GMAIL_SMTP_HOST } from "./googleMail.js";
import { assertSafeMailboxConfig, resolvePublicHost } from "./networkSafety.js";
import {
  buildReplySubject,
  clipBody,
  formatFrom,
  htmlToText,
  imapErrorDetails,
  imapErrorFields,
  imapErrorMessage,
  quotePlain,
  snippetOf,
} from "./mailboxText.js";

export const MAX_MAILBOXES = 8;
export const MAX_MESSAGES = 40;

export type PublicMailbox = {
  id: string;
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  authType: "password" | "google";
  passwordConfigured: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
};

type ResolvedMailbox = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  accessToken?: string;
  email: string;
  label: string;
};

export type MailboxAuthType = "password" | "google";

export class MailboxNotificationError extends Error {
  constructor(message: string, readonly safeToRetry: boolean) {
    super(message);
    this.name = "MailboxNotificationError";
  }
}

export function isSafeSmtpRetry(error: unknown): boolean {
  const value = error as { code?: string; command?: string; responseCode?: number } | null;
  if (!value) return false;
  if (value.command === "CONN" && ["ECONNECTION", "EDNS", "ESOCKET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(value.code ?? "")) return true;
  return [450, 451, 452].includes(value.responseCode ?? 0);
}

export function mailboxAuthType(row: Mailbox): MailboxAuthType {
  return row.authType === "google" ? "google" : "password";
}

export type MailListItem = {
  uid: number;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  seen: boolean;
  snippet: string;
};

export type MailMessage = MailListItem & {
  to: string;
  text: string;
  messageId: string | null;
};

function wrapMailError(err: unknown, host?: string): never {
  if (err instanceof ApiError) throw err;
  const details = process.env.NODE_ENV === "development" ? imapErrorDetails(err, host) : undefined;
  throw ApiError.badRequest(imapErrorMessage(err, host), details);
}

const SECRET_LOG_KEY = /pass|password|secret|authorization|cookie|token/i;

function redactImapLog(value: unknown, key = ""): unknown {
  if (SECRET_LOG_KEY.test(key) && key.toLowerCase() !== "authenticationfailed") return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/\bLOGIN\s+\S+\s+\S+/gi, "LOGIN [REDACTED]")
      .replace(/\bAUTHENTICATE\s+\S+\s+\S+/gi, "AUTHENTICATE [REDACTED]")
      .replace(/\bAUTH PLAIN\s+\S+/gi, "AUTH PLAIN [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactImapLog(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactImapLog(v, k);
    }
    return out;
  }
  return value;
}

function imapFlowLogger(): false | {
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
} {
  if (logger.level !== "debug") return false;
  const emit = (level: "debug" | "info" | "warn" | "error") => (obj: unknown, msg?: string) => {
    logger[level]({ imap: redactImapLog(obj) }, typeof msg === "string" ? msg : "imap");
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

function logMailboxFailure(op: string, box: { imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; username: string; email: string }, err: unknown, via: "imap" | "smtp") {
  const f = imapErrorFields(err);
  logger.warn({
    op,
    via,
    host: via === "smtp" ? box.smtpHost : box.imapHost,
    port: box.imapPort,
    secure: box.imapSecure,
    user: box.username,
    email: box.email,
    code: f.code,
    authenticationFailed: f.authenticationFailed,
    responseText: f.responseText?.slice(0, 240),
    serverResponseCode: f.serverResponseCode,
    command: f.command,
    message: f.message.slice(0, 240),
  }, "mailbox operation failed");
}

function toIso(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function publicMailbox(row: Mailbox): PublicMailbox {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    username: row.username,
    authType: mailboxAuthType(row),
    passwordConfigured: mailboxAuthType(row) === "google" || Boolean(row.passwordEnc),
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
  };
}

export async function resolveMailbox(row: Mailbox): Promise<ResolvedMailbox> {
  const base = {
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    username: row.username,
    email: row.email,
    label: row.label,
  };
  const kind = mailboxAuthType(row);
  switch (kind) {
    case "google": {
      if (!row.oauthRefreshEnc) {
        throw ApiError.badRequest("Vuelve a conectar Gmail con Google.");
      }
      const accessToken = await googleAccessToken(decryptSecret(row.oauthRefreshEnc), row.id);
      return { ...base, password: "", accessToken };
    }
    case "password": {
      if (!row.passwordEnc) {
        throw ApiError.badRequest("Falta la contraseña de este buzón.");
      }
      return { ...base, password: decryptSecret(row.passwordEnc) };
    }
    default: {
      const _never: never = kind;
      throw ApiError.badRequest(`Tipo de buzón no soportado: ${_never}`);
    }
  }
}

export async function saveGoogleMailbox(userId: string, email: string, refreshToken: string) {
  const count = await prisma.mailbox.count({ where: { userId } });
  const existing = await prisma.mailbox.findFirst({ where: { userId, email } });
  if (!existing && count >= MAX_MAILBOXES) {
    throw ApiError.badRequest(`Puedes conectar como máximo ${MAX_MAILBOXES} buzones.`);
  }
  const data = {
    label: (existing?.label && existing.label !== existing.email ? existing.label : email).slice(0, 80),
    email,
    imapHost: GMAIL_IMAP_HOST,
    imapPort: 993,
    imapSecure: true,
    smtpHost: GMAIL_SMTP_HOST,
    smtpPort: 587,
    smtpSecure: false,
    username: email,
    authType: "google",
    passwordEnc: null as string | null,
    oauthRefreshEnc: encryptSecret(refreshToken),
    lastError: null as string | null,
  };
  const saved = existing
    ? await prisma.mailbox.update({ where: { id: existing.id }, data })
    : await prisma.mailbox.create({ data: { userId, ...data } });
  // A new grant must not keep using an access token cached from the old one.
  clearGoogleAccessCache(saved.id);
  await prisma.user.updateMany({ where: { id: userId, defaultMailboxId: null }, data: { defaultMailboxId: saved.id } });
  return saved;
}

async function withImap<T>(box: ResolvedMailbox, op: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const target = await resolvePublicHost(box.imapHost);
  const client = new ImapFlow({
    host: target.address,
    servername: target.servername,
    port: box.imapPort,
    secure: box.imapSecure,
    auth: box.accessToken
      ? { user: box.username, accessToken: box.accessToken }
      : { user: box.username, pass: box.password },
    logger: imapFlowLogger(),
    disableAutoIdle: true,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: true },
  });
  try {
    logger.info({
      op,
      host: box.imapHost,
      port: box.imapPort,
      secure: box.imapSecure,
      user: box.username,
    }, "mailbox imap connecting");
    await client.connect();
    const result = await fn(client);
    logger.info({ op, host: box.imapHost, user: box.username }, "mailbox imap ok");
    return result;
  } catch (err) {
    logMailboxFailure(op, box, err, "imap");
    wrapMailError(err, box.imapHost);
    throw err;
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

export async function testMailboxConnection(row: Mailbox): Promise<void> {
  const box = await resolveMailbox(row);
  await assertSafeMailboxConfig(box);
  await withImap(box, "test", async (client) => {
    await client.mailboxOpen("INBOX", { readOnly: true });
  });
}

function envelopeAddress(list: { name?: string | null; address?: string | null }[] | undefined): { name: string; address: string; formatted: string } {
  const first = list?.[0];
  const name = first?.name?.trim() ?? "";
  const address = first?.address?.trim() ?? "";
  return { name, address, formatted: formatFrom(name, address) };
}

export async function listMailboxMessages(row: Mailbox): Promise<MailListItem[]> {
  const box = await resolveMailbox(row);
  return withImap(box, "list", async (client) => {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const exists = typeof client.mailbox === "object" && client.mailbox ? client.mailbox.exists : 0;
      if (!exists) return [];
      const from = Math.max(1, exists - MAX_MESSAGES + 1);
      const items: MailListItem[] = [];
      for await (const msg of client.fetch(`${from}:${exists}`, { envelope: true, flags: true, uid: true, internalDate: true })) {
        const fromAddr = envelopeAddress(msg.envelope?.from);
        const subject = (msg.envelope?.subject ?? "").trim() || "(sin asunto)";
        const date = toIso(msg.internalDate ?? msg.envelope?.date);
        const seen = msg.flags?.has("\\Seen") ?? false;
        items.push({
          uid: msg.uid,
          from: fromAddr.formatted,
          fromAddress: fromAddr.address,
          subject,
          date,
          seen,
          snippet: "",
        });
      }
      return items.reverse();
    } finally {
      lock.release();
    }
  });
}

export async function readMailboxMessage(row: Mailbox, uid: number): Promise<MailMessage> {
  const box = await resolveMailbox(row);
  return withImap(box, "read", async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true, flags: true, uid: true, internalDate: true }, { uid: true });
      if (!msg || !msg.source) throw ApiError.notFound("No se encontró ese mensaje.");
      const parsed = await simpleParser(msg.source);
      const text = clipBody(
        (parsed.text && parsed.text.trim())
          || (parsed.html ? htmlToText(String(parsed.html)) : "")
          || "",
      );
      const fromAddr = envelopeAddress(msg.envelope?.from);
      const toAddr = envelopeAddress(msg.envelope?.to);
      try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* ignore */ }
      return {
        uid: msg.uid,
        from: fromAddr.formatted,
        fromAddress: fromAddr.address || parsed.from?.value?.[0]?.address || "",
        to: toAddr.formatted,
        subject: (msg.envelope?.subject ?? parsed.subject ?? "").trim() || "(sin asunto)",
        date: toIso(msg.internalDate ?? parsed.date),
        seen: true,
        snippet: snippetOf(text),
        text,
        messageId: parsed.messageId ?? msg.envelope?.messageId ?? null,
      };
    } finally {
      lock.release();
    }
  });
}

export async function replyMailboxMessage(row: Mailbox, uid: number, text: string): Promise<void> {
  const original = await readMailboxMessage(row, uid);
  const to = original.fromAddress;
  if (!to) throw ApiError.badRequest("Ese mensaje no tiene un remitente al que responder.");
  const box = await resolveMailbox(row);
  await assertSafeMailboxConfig(box);
  const quoted = quotePlain(original.text);
  const header = original.from
    ? `El ${new Date(original.date).toLocaleString("es-ES")}, ${original.from} escribió:`
    : "";
  const body = [text.trim(), "", header, quoted].filter(Boolean).join("\n");
  const transport = await mailboxSmtpTransport(box);
  try {
    await transport.sendMail({
      from: box.email,
      to,
      subject: buildReplySubject(original.subject),
      text: body,
      headers: {
        ...(original.messageId ? { "In-Reply-To": original.messageId, References: original.messageId } : {}),
      },
    });
  } catch (err) {
    logMailboxFailure("smtp-reply", box, err, "smtp");
    wrapMailError(err, box.smtpHost);
  }
}

export async function sendMailboxNotification(row: Mailbox, to: string, subject: string, text: string): Promise<void> {
  const box = await resolveMailbox(row);
  await assertSafeMailboxConfig(box);
  const transport = await mailboxSmtpTransport(box);
  try {
    await transport.sendMail({ from: box.email, to, subject, text });
  } catch (err) {
    logMailboxFailure("smtp-alert", box, err, "smtp");
    const message = err instanceof ApiError ? err.message : imapErrorMessage(err, box.smtpHost);
    throw new MailboxNotificationError(message, isSafeSmtpRetry(err));
  }
}

async function mailboxSmtpTransport(box: ResolvedMailbox) {
  // Connect to the exact public address that was checked. Keep the original
  // hostname only for SNI and certificate verification.
  const target = await resolvePublicHost(box.smtpHost);
  return nodemailer.createTransport({
    host: target.address,
    port: box.smtpPort,
    secure: box.smtpSecure || box.smtpPort === 465,
    requireTLS: !box.smtpSecure,
    tls: { rejectUnauthorized: true, ...(target.servername ? { servername: target.servername } : {}) },
    auth: box.accessToken
      ? { type: "OAuth2", user: box.username, accessToken: box.accessToken }
      : { user: box.username, pass: box.password },
  });
}
