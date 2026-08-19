import rateLimit from "express-rate-limit";
import { ApiError } from "../lib/errors.js";

// In tests every request shares one loopback IP, so raise limits massively.
const isTest = process.env.NODE_ENV === "test";
const T = (n: number) => (isTest ? 1_000_000 : n);

/**
 * Rate limiting. Sensible defaults; endpoints with stricter limits are
 * configured per-route (auth especially). Uses the client IP; when behind a
 * trusted reverse proxy, TRUST_PROXY controls which header is honored.
 */
export const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: T(300),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany().message,
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

/** Very strict limiter for password reset token generation (abuse protection). */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: T(5),
  standardHeaders: true,
  legacyHeaders: false,
  message: ApiError.tooMany("Demasiadas peticiones. Inténtalo más tarde.").message,
});