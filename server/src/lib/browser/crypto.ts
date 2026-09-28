import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { deriveKey } from "../../config/env.js";
import { ApiError } from "../errors.js";

/**
 * Bookmarks and history are a record of where someone has been, so they are
 * stored the way the chat stores messages: encrypted, under a key of their own.
 * Losing the chat key must not hand over anybody's browsing.
 */
const DOMAIN = "browser:fields";
const INDEX_DOMAIN = "browser:index";
const VERSION = "b1";

/** AES-256-GCM with a browser-specific derived key. */
export function encryptBrowser(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), iv);
  cipher.setAAD(Buffer.from(VERSION));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBrowser(payload: string): string {
  try {
    const [version, ivRaw, tagRaw, dataRaw] = payload.split(".");
    if (version !== VERSION || !ivRaw || !tagRaw || dataRaw === undefined) throw new Error("invalid encrypted payload");
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), Buffer.from(ivRaw, "base64url"));
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw ApiError.internal("No se pudo leer una dirección guardada.");
  }
}

/**
 * Blind index: lets "is this page already saved?" be one indexed lookup.
 *
 * Keyed on purpose. A bare SHA-256 of a URL is no secret at all — a list of the
 * thousand most visited sites breaks it in a second.
 */
export function urlIndex(url: string): string {
  return createHmac("sha256", deriveKey(INDEX_DOMAIN, 32)).update(url).digest("hex");
}
