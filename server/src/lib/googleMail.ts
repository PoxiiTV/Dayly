import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "./errors.js";
import { logger } from "./logger.js";
import { getGooglePlatformConfig, markGooglePlatformValidated, resolveGooglePlatformConfig } from "./integrationSettings.js";

export const GMAIL_IMAP_HOST = "imap.gmail.com";
export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GOOGLE_MAIL_SCOPE = "https://mail.google.com/";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
type TokenCacheEntry = { accessToken: string; expiresAt: number };
const accessCache = new Map<string, TokenCacheEntry>();

export function clearGoogleAccessCache(cacheKey?: string): void {
  if (cacheKey) accessCache.delete(cacheKey);
  else accessCache.clear();
}

/** PKCE verifier (RFC 7636): 43 URL-safe characters. */
export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function googleOAuthConfigured(): Promise<boolean> {
  return (await getGooglePlatformConfig()).available;
}

async function googleClient(): Promise<{ id: string; secret: string }> {
  const resolved = await resolveGooglePlatformConfig();
  return { id: resolved.clientId, secret: resolved.clientSecret };
}

function allowedOrigins(): string[] {
  const raw = [
    ...(process.env.CLIENT_ORIGIN ?? "").split(","),
    process.env.PUBLIC_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4000",
  ];
  return [...new Set(raw.map((v) => (v ?? "").trim().replace(/\/$/, "")).filter(Boolean))];
}

export function googleRedirectOrigin(requestOrigin: string | undefined): string {
  const origin = (requestOrigin ?? "").trim().replace(/\/$/, "");
  const allowed = allowedOrigins();
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? "http://localhost:5173";
}

export function originFromRequest(req: { get(name: string): string | undefined }): string {
  const header = req.get("origin");
  if (header) return googleRedirectOrigin(header);
  const referer = req.get("referer");
  if (referer) {
    try { return googleRedirectOrigin(new URL(referer).origin); } catch { /* ignore */ }
  }
  return googleRedirectOrigin(undefined);
}

export function googleCallbackUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/inbox/mailboxes/google/callback`;
}

export function googleInboxUri(origin: string, params: Record<string, string>): string {
  const url = new URL("/inbox", `${origin.replace(/\/$/, "")}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function googleAuthorizeUrl(state: string, redirectUri: string, verifier: string): Promise<string> {
  const { id } = await googleClient();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email ${GOOGLE_MAIL_SCOPE}`);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const json = await res.json() as GoogleTokenResponse;
  if (!res.ok || json.error || !json.access_token) {
    logger.warn({ error: json.error }, "google oauth token failed");
    throw ApiError.badRequest("Google no concedió acceso al correo. Inténtalo de nuevo.");
  }
  return json;
}

export async function exchangeGoogleCode(code: string, redirectUri: string, verifier: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { id, secret } = await googleClient();
  const json = await tokenRequest(new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  }));
  if (!json.refresh_token) {
    throw ApiError.badRequest("Google no envió un permiso duradero. Vuelve a pulsar Conectar con Google y acepta el acceso al correo.");
  }
  await markGooglePlatformValidated();
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function googleAccessToken(refreshToken: string, cacheKey?: string): Promise<string> {
  if (cacheKey) {
    const hit = accessCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.accessToken;
  }
  const { id, secret } = await googleClient();
  let json: GoogleTokenResponse;
  try {
    json = await tokenRequest(new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }));
  } catch (err) {
    if (err instanceof ApiError) {
      throw ApiError.badRequest("La sesión de Google caducó. Vuelve a conectar Gmail con Google.");
    }
    throw err;
  }
  const expiresIn = json.expires_in ?? 3600;
  if (cacheKey) {
    accessCache.set(cacheKey, {
      accessToken: json.access_token!,
      expiresAt: Date.now() + expiresIn * 1000,
    });
  }
  return json.access_token!;
}

export async function googleAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw ApiError.badRequest("No se pudo leer la cuenta de Google.");
  const json = await res.json() as { email?: string; email_verified?: boolean };
  const email = json.email?.trim().toLowerCase();
  if (!email) throw ApiError.badRequest("Google no devolvió un correo.");
  if (json.email_verified !== true) throw ApiError.badRequest("Google no confirma que ese correo esté verificado.");
  return email;
}

/** Best effort: tells Google to drop the grant when a Gmail box is removed. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 400) logger.info({ status: res.status }, "google token revoke rejected");
  } catch (err) {
    logger.info({ err }, "google token revoke failed");
  }
}
