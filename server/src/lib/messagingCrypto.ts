import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { deriveKey } from "../config/env.js";
import { ApiError } from "./errors.js";

const VERSION = "m1";

/** AES-256-GCM with a messaging-specific derived key. */
export function encryptMessaging(plain: string): string {
  const iv = randomBytes(12);
  const key = deriveKey("business-messaging:fields", 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(VERSION));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMessaging(payload: string): string {
  try {
    const [version, ivRaw, tagRaw, dataRaw] = payload.split(".");
    if (version !== VERSION || !ivRaw || !tagRaw || dataRaw === undefined) throw new Error("invalid encrypted payload");
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("business-messaging:fields", 32), Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw ApiError.internal("No se pudo descifrar un dato de mensajería.");
  }
}

/** Keyed exact-match index. It is not suitable for partial/full-text search. */
export function messagingHash(namespace: string, value: string): string {
  return createHmac("sha256", deriveKey(`business-messaging:index:${namespace}`, 32))
    .update(value.trim())
    .digest("hex");
}

export function encryptMessagingJson(value: unknown): string {
  return encryptMessaging(JSON.stringify(value));
}

export function decryptMessagingJson<T>(payload: string | null | undefined, fallback: T): T {
  if (!payload) return fallback;
  try {
    return JSON.parse(decryptMessaging(payload)) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw ApiError.internal("No se pudo leer un dato de mensajería.");
    throw error;
  }
}
