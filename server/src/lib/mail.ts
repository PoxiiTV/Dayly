import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { EMAIL_FONT, emailP, escapeHtml, renderEmail } from "./mailTemplates.js";
import { APP_NAME } from "./brand.js";

function transporter() {
  if (!config.smtp.host) return null;
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port === 587,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (config.nodeEnv === "test") return;
  const t = transporter();
  if (!t) {
    logger.info({ to: opts.to, subject: opts.subject }, "[mail] SMTP no configurado; no se envía.");
    if (config.nodeEnv !== "production") {
      console.log(`[DEV][mail] ${opts.subject} -> ${opts.to}\n${opts.text}`);
    }
    return;
  }
  await t.sendMail({
    from: config.smtp.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  logger.info({ to: opts.to, subject: opts.subject }, "[mail] enviado");
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  const safeName = escapeHtml(name || "ahí");
  await sendMail({
    to,
    subject: `Restablece tu contraseña en ${APP_NAME}`,
    text: `Hola ${name},\n\nUsa este enlace (caduca en 30 minutos) para elegir una contraseña nueva:\n${resetUrl}\n\nSi no lo pediste, ignora este mensaje.\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "El enlace caduca en 30 minutos.",
      heading: `Hola, ${safeName}`,
      bodyHtml: emailP(`Hemos recibido una petición para restablecer la contraseña de tu cuenta ${APP_NAME}. Pulsa el botón: el enlace caduca en <strong style="color:#18181b;font-family:${EMAIL_FONT};">30 minutos</strong>.`)
        + emailP("Si no fuiste tú, puedes ignorar este correo. Tu cuenta sigue igual.", { muted: true, last: true }),
      ctaLabel: "Elegir nueva contraseña",
      ctaUrl: resetUrl,
    }),
  });
}

export async function sendVerifyEmail(to: string, name: string, verifyUrl: string) {
  const safeName = escapeHtml(name || "ahí");
  await sendMail({
    to,
    subject: `Confirma tu email en ${APP_NAME}`,
    text: `Hola ${name},\n\nConfirma tu dirección para completar el alta:\n${verifyUrl}\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "Un clic para confirmar tu cuenta.",
      heading: `Bienvenido/a a ${APP_NAME}, ${safeName}`,
      bodyHtml: emailP("Confirma que este correo es tuyo para activar avisos de cuenta y recuperación. Solo tardas un segundo.", { last: true }),
      ctaLabel: "Confirmar mi email",
      ctaUrl: verifyUrl,
    }),
  });
}

export function loginUrl() {
  return config.clientOrigin.split(",")[0].replace(/\/$/, "") + "/login";
}

export function mailConfigured() {
  return Boolean(config.smtp.host);
}

export async function sendAdminWelcomeEmail(opts: {
  to: string;
  name: string;
  setPasswordUrl: string;
}) {
  const safeName = escapeHtml(opts.name || "ahí");
  await sendMail({
    to: opts.to,
    subject: `Tu cuenta de ${APP_NAME} ya está lista`,
    text: `Hola ${opts.name},\n\nTe han creado una cuenta en ${APP_NAME}. Elige tu contraseña con este enlace (caduca en 24 horas):\n\n${opts.setPasswordUrl}\n\nSi no esperabas este correo, ignóralo.\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "Elige tu contraseña para activar la cuenta.",
      heading: `Hola, ${safeName}`,
      bodyHtml:
        emailP(`Te han creado una cuenta en ${APP_NAME}. Pulsa el botón para elegir tu contraseña. El enlace caduca en <strong>24 horas</strong>.`)
        + emailP("Si no esperabas este correo, puedes ignorarlo.", { muted: true, last: true }),
      ctaLabel: "Elegir contraseña",
      ctaUrl: opts.setPasswordUrl,
    }),
  });
}

export function makeVerifyToken(email: string, ttlMs = 24 * 3600 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(`${email.toLowerCase()}:${exp}`).toString("base64url");
  const sig = createHmac("sha256", config.appSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUrl(token: string) {
  const base = config.clientOrigin.split(",")[0].replace(/\/$/, "");
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token: string) {
  const base = config.clientOrigin.split(",")[0].replace(/\/$/, "");
  return `${base}/reset?token=${encodeURIComponent(token)}`;
}
