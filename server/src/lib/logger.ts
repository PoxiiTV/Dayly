import pino from "pino";

/**
 * Structured JSON logger. Never logs secrets: child loggers must be created
 * per-request with redacted metadata (see middleware). Pino redacts by key
 * name patterns as a last line of defense.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "twoFactorSecret",
      "recoveryCodes",
      "authorization",
      "cookie",
      "*.secret",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  transport:
    process.env.NODE_ENV === "development" && process.env.LOG_PRETTY === "1"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown> = {}) {
  return logger.child(bindings);
}