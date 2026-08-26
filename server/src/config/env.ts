import os from "node:crypto";
import path from "node:path";

/**
 * Central env config. Validates required vars on boot so a misconfigured
 * production server fails fast instead of serving a broken app.
 * Secrets are never logged or returned.
 */
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProd: boolean;
  port: number;
  clientOrigin: string;
  publicUrl: string;
  databaseUrl: string;
  appSecret: string;
  trustProxy: boolean | number | string[];
  sessionTtlMs: number;
  smtp: { host: string; port: number; user: string; pass: string; from: string };
  vapid: { publicKey: string; privateKey: string; subject: string };
  telegramBotToken: string;
  seedDemo: boolean;
  allowPublicRegistration: boolean;
  uploadDir: string;
}

function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const v = (raw ?? "").trim();
  if (!v) return [];
  if (v === "true") return true;
  if (v === "1") return 1;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "" || value.includes("CHANGE_ME")) {
    throw new Error(
      `Missing or placeholder environment variable: ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  const appSecret = required("APP_SECRET", process.env.APP_SECRET);

  // Reject obviously weak secrets (anything not base64-ish / too short).
  if (appSecret.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters long.");
  }

  return {
    nodeEnv,
    isProd: nodeEnv === "production",
    port: Number(process.env.PORT ?? 4000),
    clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    appSecret,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 3600 * 1000),
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      from: process.env.SMTP_FROM ?? "Dayly <no-reply@dayly.app>",
    },
vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:hello@dayly.app",
  },
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    seedDemo: (process.env.SEED_DEMO ?? (nodeEnv === "production" ? "false" : "true")) === "true",
    allowPublicRegistration: parseAllowRegistration(process.env.ALLOW_PUBLIC_REGISTRATION, nodeEnv),
    uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "uploads"),
  };
}

export const config = loadConfig();

function parseAllowRegistration(raw: string | undefined, nodeEnv: AppConfig["nodeEnv"]): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return nodeEnv !== "production";
}

/** Read at request time so tests can toggle without reloading the process. */
export function allowPublicRegistration(): boolean {
  return parseAllowRegistration(process.env.ALLOW_PUBLIC_REGISTRATION, config.nodeEnv);
}

export function smtpConfigured(): boolean {
  return Boolean(config.smtp.host);
}

// Derive deterministic sub-keys from the master secret so a single env var
// can safely seed several independent keys (HMAC-derived, distinct purposes).
export function deriveKey(purpose: string, length = 32): Buffer {
  return os.createHmac("sha256", process.env.APP_SECRET!)
    .update(`dayly:${purpose}`)
    .digest()
    .subarray(0, length);
}