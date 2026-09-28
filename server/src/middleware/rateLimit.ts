import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";
import { ApiError } from "../lib/errors.js";

/** Same cookie the session is carried in; see services/auth.service.ts. */
const SESSION_COOKIE = "dayly_session";

// In tests every request shares one loopback IP, so raise limits massively.
const isTest = process.env.NODE_ENV === "test";
const T = (n: number) => (isTest ? 1_000_000 : n);

/**
 * Rate limiting. Endpoints with stricter limits are configured per-route (auth
 * especially); this is the blunt backstop.
 *
 * Two decisions matter here:
 *
 *   * **Signed-in traffic is counted per session, not per IP.** A shared
 *     address — a home router, an office, a phone on CGNAT — used to mean
 *     everyone drew from the same 300, so one open chat could lock the whole
 *     API for the family. Anonymous traffic still keys on the IP, which is
 *     where brute force actually lives.
 *   * **The window is one minute.** The old fifteen-minute window meant that
 *     going over left the app unusable for a quarter of an hour, which is what
 *     it felt like: "no puedo ni crear una tarea". A short window recovers on
 *     its own while still stopping a runaway client.
 */
const VAULT_BULK_POSTS = new Set([
  "/api/vault/items/import",
  "/api/vault/items/delete",
  "/api/vault/import",
  "/api/vault/rekey",
]);

/**
 * Session checks, one-shot vault batches and the chat poll must not burn the
 * global quota. The chat polls every 4s, which is 225 requests per 15 minutes
 * *per tab* against a 300 budget **per IP**: without this, two people behind
 * the same NAT would 429 each other out of the whole API, not just the chat.
 */
export function shouldSkipGlobalRateLimit(req: { method?: string; path?: string }): boolean {
  const method = req.method ?? "";
  const path = req.path ?? "";
  if (method !== "GET") return method === "POST" && VAULT_BULK_POSTS.has(path);
  if (path === "/api/auth/me" || path === "/api/chat/sync" || path === "/api/chat/friends") return true;
  if (path === "/api/chat/events") return true;
  if (path.startsWith("/api/chat/threads/") && path.endsWith("/messages")) return true;
  return false;
}

/** True when the request carries a session cookie (not that it is valid). */
function sessionToken(req: { cookies?: Record<string, unknown> }): string | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Buckets by session when there is one, by IP otherwise. The token is hashed
 * so a session identifier never becomes a key sitting in the limiter's store.
 *
 * IPv6 is collapsed to its /64 prefix: a single subscriber owns the whole
 * block, so keying on the full address would let one client spread its
 * requests across an effectively unlimited number of buckets.
 */
export function rateLimitKey(req: { cookies?: Record<string, unknown>; ip?: string }): string {
  const token = sessionToken(req);
  if (token) return `s:${createHash("sha256").update(token).digest("base64url")}`;
  const ip = req.ip ?? "unknown";
  if (ip.includes(":")) return `i:${ip.split(":").slice(0, 4).join(":")}::/64`;
  return `i:${ip}`;
}

export const limiter = rateLimit({
  windowMs: 60 * 1000,
  // A signed-in tab polls, prefetches and reacts to typing; an anonymous one
  // only needs to log in. Both are far above ordinary use and far below what a
  // runaway loop would do.
  limit: (req) => (sessionToken(req as { cookies?: Record<string, unknown> }) ? T(300) : T(60)),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
  skip: shouldSkipGlobalRateLimit,
});

/** Stricter limiter for auth/credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(20),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiados intentos. Espera unos minutos y reinténtalo.").message,
  skipSuccessfulRequests: false,
});

/** Brute-force protection for the low-entropy app PIN, scoped to a session. */
export const quickPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(20),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiados intentos de PIN. Espera unos minutos y reinténtalo.").message,
});

/** Very strict limiter for password reset token generation (abuse protection). */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: T(5),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiadas peticiones. Inténtalo más tarde.").message,
});

/** Short Icecast probes for the radio bitrate badge. */
export const radioProbeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(120),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiadas lecturas de calidad de radio.").message,
});

/** Task assistants call a model on the user's own key: bound bursts per session. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: T(20),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiadas peticiones a la IA; espera un momento.").message,
});

/** Morning-briefing test: weather lookup + Telegram send per call. */
export const briefingTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: T(3),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Espera un momento antes de volver a probar el resumen.").message,
});

/** IMAP/SMTP mailbox operations — slower and easier to abuse. */
export const mailboxLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(40),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiadas peticiones al buzón. Espera un momento.").message,
});

/** Sending is cheap but not free; a stuck client must not hammer the thread. */
export const chatSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: T(60),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
});

/**
 * "Typing…" pings. Their own budget on purpose: they are frequent by nature and
 * must never eat into what is left for actually sending a message. The client
 * throttles to one every few seconds, so this only catches a stuck tab.
 */
export const chatTypingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: T(40),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
});

/** Buzzes also have a per-thread cooldown; this is the per-session backstop. */
export const chatBuzzLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: T(10),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
});

/** Friend requests and code rotation: the abuse-prone surface. */
export const chatRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(20),
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
});
