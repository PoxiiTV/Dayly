import argon2 from "argon2";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import { deriveKey } from "../config/env.js";
import { ApiError } from "./errors.js";

// ---------- Password hashing (Argon2id, OWASP-recommended) ----------
export const PASSWORD_POLICY = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireNumber: true,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function passwordPolicyError(pw: string): string | null {
  if (!pw || pw.length < PASSWORD_POLICY.minLength) {
    return `La contraseña debe tener al menos ${PASSWORD_POLICY.minLength} caracteres.`;
  }
  if (PASSWORD_POLICY.requireUpper && !/[A-Z]/.test(pw)) {
    return "La contraseña debe incluir al menos una letra mayúscula.";
  }
  if (PASSWORD_POLICY.requireLower && !/[a-z]/.test(pw)) {
    return "La contraseña debe incluir al menos una letra minúscula.";
  }
  if (PASSWORD_POLICY.requireNumber && !/[0-9]/.test(pw)) {
    return "La contraseña debe incluir al menos un número.";
  }
  return null;
}

// ---------- Opaque tokens (sessions, resets, verification) ----------
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash an opaque token. High-entropy tokens only need fast SHA-256. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------- Field encryption (2FA secrets), AES-256-GCM ----------
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const key = deriveKey("field-encryption", 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  try {
    const [ivB, tagB, dataB] = payload.split(".");
    const iv = Buffer.from(ivB, "base64url");
    const tag = Buffer.from(tagB, "base64url");
    const data = Buffer.from(dataB, "base64url");
    const key = deriveKey("field-encryption", 32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw ApiError.internal();
  }
}

// ---------- 2FA (TOTP) ----------
const otp = authenticator.clone();
otp.options = { step: 30, window: 1, digits: 6 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function generateTotpAuthUrl(secret: string, email: string): string {
  return authenticator.keyuri(email, "Dayly", secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return otp.verify({ token: code.trim(), secret });
  } catch {
    return false;
  }
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(8).toString("hex").slice(0, 10).toUpperCase());
  }
  return codes;
}

export function normalizeRecoveryCode(code: string) {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

// ---------- misc sanitizers ----------
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function sanitizeUserInput(value: string): string {
  return value.replace(/[<>&"'`]/g, (c) => {
    const map: Record<string, string> = {
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;", "`": "&#96;",
    };
    return map[c];
  });
}