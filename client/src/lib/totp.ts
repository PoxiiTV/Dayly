/** TOTP (RFC 6238, SHA-1, 30 s, 6 digits) using WebCrypto. Secrets never leave the browser. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeTotpSecret(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.toLowerCase().startsWith("otpauth:")) {
      const url = new URL(trimmed);
      const secret = url.searchParams.get("secret") ?? "";
      return secret.replace(/[\s-]/g, "").toUpperCase();
    }
  } catch { /* fall through */ }
  return trimmed.replace(/[\s-]/g, "").toUpperCase();
}

export function totpSecretError(raw: string): string | null {
  const secret = normalizeTotpSecret(raw);
  if (!secret) return null;
  if (!/^[A-Z2-7]+=*$/.test(secret) || secret.replace(/=+$/, "").length < 8) {
    return "La clave TOTP no parece Base32 (Authy / Google Authenticator).";
  }
  return null;
}

function base32Decode(secret: string): Uint8Array<ArrayBuffer> {
  const clean = normalizeTotpSecret(secret).replace(/=+$/, "");
  let bits = "";
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

export function totpRemaining(at = Date.now(), period = 30): number {
  const elapsed = Math.floor(at / 1000) % period;
  return period - elapsed;
}

export async function totpCode(secret: string, at = Date.now(), period = 30, digits = 6): Promise<string> {
  const keyBytes = base32Decode(secret);
  if (keyBytes.length < 5) throw new Error("Clave TOTP demasiado corta.");
  const counter = Math.floor(Math.floor(at / 1000) / period);
  const msg = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = sig[sig.length - 1]! & 0x0f;
  const bin = ((sig[offset]! & 0x7f) << 24) | ((sig[offset + 1]! & 0xff) << 16) | ((sig[offset + 2]! & 0xff) << 8) | (sig[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, "0");
}
