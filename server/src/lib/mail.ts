import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { EMAIL_FONT, emailKv, emailP, escapeHtml, renderEmail } from "./mailTemplates.js";
import { APP_NAME } from "./brand.js";
import { prisma } from "./prisma.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export interface SmtpSettingsInput {
  host: string;
  port: number;
  username: string;
  password?: string;
  fromAddress: string;
}

type ResolvedSmtp = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

async function resolveSmtp(): Promise<ResolvedSmtp> {
  const stored = await prisma.smtpSetting.findUnique({ where: { id: 1 } });
  if (stored) {
    return {
      host: stored.host,
      port: stored.port,
      user: stored.username,
      pass: stored.passwordEnc ? decryptSecret(stored.passwordEnc) : "",
      from: stored.fromAddress,
    };
  }
  return { host: "", port: 587, user: "", pass: "", from: "" };
}

function transporter(smtp: ResolvedSmtp) {
  if (!smtp.host) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port === 587,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (config.nodeEnv === "test") return;
  const smtp = await resolveSmtp();
  const t = transporter(smtp);
  if (!t) {
    logger.info({ to: opts.to, subject: opts.subject }, "[mail] SMTP no configurado; no se envía.");
    if (config.nodeEnv !== "production") {
      console.log(`[DEV][mail] ${opts.subject} -> ${opts.to}\n${opts.text}`);
    }
    return;
  }
  await t.sendMail({
    from: smtp.from,
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

export async function smtpReady(): Promise<boolean> {
  const stored = await prisma.smtpSetting.findUnique({ where: { id: 1 }, select: { host: true } });
  return Boolean(stored?.host?.trim());
}

export async function sendVaultUnlockEmail(to: string, name: string, code: string) {
  const safeName = escapeHtml(name || "ahí");
  const vaultUrl = config.clientOrigin.split(",")[0].replace(/\/$/, "") + "/vault";
  await sendMail({
    to,
    subject: `Código para abrir el Cofre en ${APP_NAME}`,
    text: `Hola ${name},\n\nTu código para abrir el Cofre es: ${code}\nCaduca en 10 minutos. Si no fuiste tú, cambia la contraseña de la cuenta y revisa las sesiones.\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "Caduca en 10 minutos. No es la contraseña del Cofre.",
      heading: `Hola, ${safeName}`,
      bodyHtml:
        emailP(`Para abrir el Cofre de ${APP_NAME} introduce este código. Caduca en <strong style="color:#18181b;font-family:${EMAIL_FONT};">10 minutos</strong>.`)
        + emailKv("Código", code)
        + emailP("No es la contraseña del Cofre. Si no pediste abrir el Cofre, ignora el correo y revisa tus sesiones.", { muted: true, last: true }),
      ctaLabel: "Ir al Cofre",
      ctaUrl: vaultUrl,
    }),
  });
}

export async function mailConfigured() {
  return Boolean((await resolveSmtp()).host);
}

export async function getSmtpSettings() {
  const smtp = await resolveSmtp();
  const stored = await prisma.smtpSetting.findUnique({ where: { id: 1 }, select: { passwordEnc: true } });
  return {
    host: smtp.host,
    port: smtp.port,
    username: smtp.user,
    fromAddress: smtp.from,
    passwordConfigured: Boolean(smtp.pass || stored?.passwordEnc),
    stored: Boolean(stored),
  };
}

export async function saveSmtpSettings(input: SmtpSettingsInput) {
  const current = await prisma.smtpSetting.findUnique({ where: { id: 1 } });
  const passwordEnc = input.password === undefined
    ? current?.passwordEnc ?? null
    : input.password ? encryptSecret(input.password) : null;
  await prisma.smtpSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordEnc,
      fromAddress: input.fromAddress,
    },
    update: {
      host: input.host,
      port: input.port,
      username: input.username,
      passwordEnc,
      fromAddress: input.fromAddress,
    },
  });
  return getSmtpSettings();
}

export async function testSmtpConnection() {
  const smtp = await resolveSmtp();
  const t = transporter(smtp);
  if (!t) throw new Error("Configura un servidor SMTP antes de probar la conexión.");
  await t.verify();
}

export async function sendAdminWelcomeEmail(opts: {
  to: string;
  name: string;
  temporaryPassword: string;
  loginUrl: string;
}) {
  const safeName = escapeHtml(opts.name || "ahí");
  await sendMail({
    to: opts.to,
    subject: `Tu cuenta de ${APP_NAME} ya está lista`,
    text: `Hola ${opts.name},\n\nTe han creado una cuenta en ${APP_NAME}.\nUsuario: ${opts.to}\nContraseña temporal: ${opts.temporaryPassword}\n\nInicia sesión con estos datos y elige una contraseña nueva cuando te la pidamos:\n${opts.loginUrl}\n\nSi no esperabas este correo, ignóralo.\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "Tus datos de acceso temporal a tu agenda.",
      heading: `Hola, ${safeName}`,
      bodyHtml:
        emailP(`Te han creado una cuenta en ${APP_NAME}. Estos son tus datos de acceso temporal:`)
        + emailKv("Usuario", opts.to)
        + emailKv("Contraseña temporal", opts.temporaryPassword)
        + emailP("Al iniciar sesión te obligaremos a elegir una contraseña nueva. No reutilices esta contraseña en otros servicios.", { muted: true, last: true }),
      ctaLabel: "Entrar y cambiar contraseña",
      ctaUrl: opts.loginUrl,
    }),
  });
}

export async function sendAdminPasswordResetEmail(opts: {
  to: string;
  name: string;
  temporaryPassword: string;
  loginUrl: string;
}) {
  const safeName = escapeHtml(opts.name || "ahí");
  await sendMail({
    to: opts.to,
    subject: `Un administrador ha restablecido tu contraseña en ${APP_NAME}`,
    text: `Hola ${opts.name},\n\nUn administrador ha restablecido tu contraseña de ${APP_NAME}.\nUsuario: ${opts.to}\nContraseña temporal: ${opts.temporaryPassword}\n\nInicia sesión con estos datos y elige una contraseña nueva cuando te la pidamos:\n${opts.loginUrl}\n\nSi no esperabas este correo, avisa a tu administrador.\n\n— ${APP_NAME}`,
    html: renderEmail({
      preheader: "Tu contraseña temporal de acceso.",
      heading: `Hola, ${safeName}`,
      bodyHtml:
        emailP(`Un administrador ha restablecido la contraseña de tu cuenta ${APP_NAME}. Estos son tus datos de acceso temporal:`)
        + emailKv("Usuario", opts.to)
        + emailKv("Contraseña temporal", opts.temporaryPassword)
        + emailP("Al iniciar sesión te obligaremos a elegir una contraseña nueva. No reutilices esta contraseña en otros servicios. Si no lo esperabas, avisa a tu administrador.", { muted: true, last: true }),
      ctaLabel: "Entrar y cambiar contraseña",
      ctaUrl: opts.loginUrl,
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
