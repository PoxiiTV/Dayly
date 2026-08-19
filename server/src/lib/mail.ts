import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { EMAIL_FONT, emailKv, emailP, escapeHtml, renderEmail } from "./mailTemplates.js";

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
    subject: "Restablece tu contraseña en Dayly",
    text: `Hola ${name},\n\nUsa este enlace (caduca en 30 minutos) para elegir una contraseña nueva:\n${resetUrl}\n\nSi no lo pediste, ignora este mensaje.\n\n— Dayly`,
    html: renderEmail({
      preheader: "El enlace caduca en 30 minutos.",
      heading: `Hola, ${safeName}`,
      bodyHtml: emailP(`Hemos recibido una petición para restablecer la contraseña de tu cuenta Dayly. Pulsa el botón: el enlace caduca en <strong style="color:#18181b;font-family:${EMAIL_FONT};">30 minutos</strong>.`)
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
    subject: "Confirma tu email en Dayly",
    text: `Hola ${name},\n\nConfirma tu dirección para completar el alta:\n${verifyUrl}\n\n— Dayly`,
    html: renderEmail({
      preheader: "Un clic para confirmar tu cuenta.",
      heading: `Bienvenido/a a Dayly, ${safeName}`,
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
  password: string;
}) {
  const safeName = escapeHtml(opts.name || "ahí");
  const url = loginUrl();
  await sendMail({
    to: opts.to,
    subject: "Tu cuenta de Dayly ya está lista",
    text: `Hola ${opts.name},\n\nTe han creado una cuenta en Dayly. Entra con:\n\nUsuario: ${opts.to}\nContraseña: ${opts.password}\n\n${url}\n\nAl entrar te pediremos una contraseña nueva: esta del correo dejará de valer.\nNo reenvíes este mensaje.\n\n— Dayly`,
    html: renderEmail({
      preheader: "Al entrar tendrás que elegir una contraseña nueva.",
      heading: `Hola, ${safeName}`,
      bodyHtml:
        emailP("Te han creado una cuenta en Dayly. Estos son tus datos de acceso:")
        + emailKv("Usuario (email)", opts.to)
        + emailKv("Contraseña", opts.password)
        + emailP("Al entrar te pediremos una contraseña nueva. Esta del correo dejará de valer. No reenvíes este mensaje.", { muted: true, last: true }),
      ctaLabel: "Entrar en Dayly",
      ctaUrl: url,
      footerNote: "Este mensaje incluye tu contraseña. No lo reenvíes.",
    }),
  });
}

export function makeVerifyToken(email: string): string {
  const payload = Buffer.from(email.toLowerCase()).toString("base64url");
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
