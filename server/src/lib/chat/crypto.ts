import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deriveKey } from "../../config/env.js";
import { ApiError } from "../errors.js";

// Own key namespace, not the business-messaging one: rotating or compromising
// the CRM key must not reach private messages between users of the instance.
const DOMAIN = "user-chat:fields";
const VERSION = "c1";

/** AES-256-GCM with a chat-specific derived key. */
export function encryptChat(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), iv);
  cipher.setAAD(Buffer.from(VERSION));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptChat(payload: string): string {
  try {
    const [version, ivRaw, tagRaw, dataRaw] = payload.split(".");
    if (version !== VERSION || !ivRaw || !tagRaw || dataRaw === undefined) throw new Error("invalid encrypted payload");
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw ApiError.internal("No se pudo leer un mensaje.");
  }
}
