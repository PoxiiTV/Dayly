import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret, randomToken } from "./crypto.js";
import { ApiError } from "./errors.js";
import { getSpotifyClientId, getSpotifySettings } from "./spotifyApp.js";
import { messagingHash } from "./messagingCrypto.js";
import { consumeOAuthAttempt, createOAuthAttempt } from "./oauthAttempts.js";
import { prisma } from "./prisma.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const ME_URL = "https://api.spotify.com/v1/me";
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-private",
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
type SpotifyProfile = { id?: string; display_name?: string; product?: string };
type CachedToken = { token: string; expiresAt: number };
const accessTokens = new Map<string, CachedToken>();

export function clearSpotifyAccessCache(): void {
  accessTokens.clear();
}

class SpotifyTokenError extends ApiError {
  constructor(message: string, readonly permanent: boolean) {
    super(400, "SPOTIFY_AUTH_ERROR", message);
  }
}

export async function beginSpotifyOAuth(input: { userId: string; sessionId: string; origin: string; returnTo?: string }) {
  const clientId = await getSpotifyClientId();
  if (!clientId) throw ApiError.badRequest("Spotify no está habilitado por el administrador.");
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${input.origin.replace(/\/$/, "")}/spotify/callback`;
  const state = await createOAuthAttempt({
    provider: "SPOTIFY",
    userId: input.userId,
    sessionId: input.sessionId,
    redirectUri,
    returnTo: input.returnTo,
    verifier,
  });
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeSpotifyOAuth(input: { userId: string; sessionId: string; state: string; code: string }) {
  const attempt = await consumeOAuthAttempt({ provider: "SPOTIFY", state: input.state, userId: input.userId, sessionId: input.sessionId });
  if (!attempt.verifier) throw ApiError.badRequest("La autorización de Spotify está incompleta.");
  const clientId = await getSpotifyClientId();
  if (!clientId) throw ApiError.badRequest("Spotify ha sido deshabilitado por el administrador.");
  const tokens = await spotifyTokenRequest(new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: attempt.redirectUri,
    code_verifier: attempt.verifier,
  }));
  if (!tokens.refresh_token || !tokens.access_token) throw ApiError.badRequest("Spotify no devolvió un permiso duradero.");
  const profile = await fetchSpotifyProfile(tokens.access_token);
  if (!profile.id) throw ApiError.badRequest("Spotify no devolvió la identidad de la cuenta.");
  const spotifyUserIdHash = messagingHash("SPOTIFY:user", profile.id);
  const claimed = await prisma.spotifyConnection.findUnique({ where: { spotifyUserIdHash } });
  if (claimed && claimed.userId !== input.userId) throw ApiError.conflict("Esa cuenta de Spotify ya está conectada a otro usuario.");

  const data = {
    spotifyUserIdEnc: encryptSecret(profile.id),
    spotifyUserIdHash,
    displayNameEnc: profile.display_name ? encryptSecret(profile.display_name.slice(0, 200)) : null,
    product: (profile.product ?? "free").toLowerCase().slice(0, 20),
    scopes: tokens.scope ?? SCOPES,
    refreshTokenEnc: encryptSecret(tokens.refresh_token),
    status: "ACTIVE" as const,
    connectedAt: new Date(),
    revokedAt: null,
    lastError: null,
  };
  let connection;
  try {
    connection = await prisma.$transaction(async (tx) => {
      await tx.spotifyConnection.updateMany({ where: { userId: input.userId, status: { not: "REVOKED" }, ...(claimed ? { id: { not: claimed.id } } : {}) }, data: { status: "REVOKED", revokedAt: new Date(), refreshTokenEnc: "" } });
      const saved = claimed
        ? tx.spotifyConnection.update({ where: { id: claimed.id }, data })
        : tx.spotifyConnection.create({ data: { userId: input.userId, ...data } });
      const result = await saved;
      await tx.spotifySetting.updateMany({ where: { id: 1, enabled: true }, data: { validatedAt: new Date() } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw ApiError.conflict("Esa cuenta de Spotify ya está conectada.");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw ApiError.conflict("Otra conexión de Spotify cambió a la vez. Vuelve a intentarlo.");
    throw error;
  }
  accessTokens.set(connection.id, { token: tokens.access_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in ?? 3600) - 30) * 1000 });
  return { returnTo: attempt.returnTo, connection: publicSpotifyConnection(connection) };
}

export async function spotifyStatus(userId: string) {
  const [platform, connection] = await Promise.all([
    getSpotifySettings(),
    prisma.spotifyConnection.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { connectedAt: "desc" } }),
  ]);
  return {
    enabled: platform.enabled,
    configured: platform.configured,
    available: platform.available,
    operational: platform.operational,
    connected: Boolean(connection),
    connection: connection ? publicSpotifyConnection(connection) : null,
  };
}

export async function spotifyAccessTokenForUser(userId: string, force = false) {
  const connection = await prisma.spotifyConnection.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { connectedAt: "desc" } });
  if (!connection || !connection.refreshTokenEnc) throw ApiError.badRequest("Conecta Spotify para continuar.");
  const cached = accessTokens.get(connection.id);
  if (!force && cached && cached.expiresAt > Date.now() + 10_000) return { accessToken: cached.token, expiresAt: new Date(cached.expiresAt).toISOString() };
  const clientId = await getSpotifyClientId();
  if (!clientId) throw ApiError.badRequest("Spotify está deshabilitado por el administrador.");
  let tokens: TokenResponse;
  try {
    tokens = await spotifyTokenRequest(new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(connection.refreshTokenEnc),
    }));
  } catch (error) {
    if (error instanceof SpotifyTokenError && error.permanent) {
      await prisma.spotifyConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: "La autorización ha caducado." } });
      accessTokens.delete(connection.id);
    }
    throw error;
  }
  if (!tokens.access_token) throw ApiError.badRequest("Spotify no devolvió acceso.");
  if (tokens.refresh_token) await prisma.spotifyConnection.update({ where: { id: connection.id }, data: { refreshTokenEnc: encryptSecret(tokens.refresh_token), scopes: tokens.scope ?? connection.scopes, lastError: null } });
  const expiresAt = Date.now() + Math.max(60, Number(tokens.expires_in ?? 3600) - 30) * 1000;
  accessTokens.set(connection.id, { token: tokens.access_token, expiresAt });
  return { accessToken: tokens.access_token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function disconnectSpotifyUser(userId: string) {
  const rows = await prisma.spotifyConnection.findMany({ where: { userId, status: { not: "REVOKED" } }, select: { id: true } });
  await prisma.spotifyConnection.updateMany({ where: { id: { in: rows.map(({ id }) => id) } }, data: { status: "REVOKED", revokedAt: new Date(), refreshTokenEnc: "" } });
  for (const row of rows) accessTokens.delete(row.id);
}

export async function saveSpotifyPreference(userId: string, embed: { kind: string; id: string } | null) {
  const connection = await prisma.spotifyConnection.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { connectedAt: "desc" } });
  if (!connection) throw ApiError.badRequest("Conecta Spotify para guardar esta selección.");
  return prisma.spotifyConnection.update({
    where: { id: connection.id },
    data: { selectedEmbedKind: embed?.kind ?? null, selectedEmbedId: embed?.id ?? null },
  });
}

function publicSpotifyConnection(connection: {
  id: string; displayNameEnc: string | null; product: string; scopes: string; selectedEmbedKind: string | null; selectedEmbedId: string | null; connectedAt: Date; lastError: string | null;
}) {
  return {
    name: connection.displayNameEnc ? decryptSecret(connection.displayNameEnc) : "Spotify",
    product: connection.product,
    premium: connection.product === "premium",
    scopes: connection.scopes,
    embed: connection.selectedEmbedKind && connection.selectedEmbedId ? { kind: connection.selectedEmbedKind, id: connection.selectedEmbedId } : null,
    connectedAt: connection.connectedAt.toISOString(),
    lastError: connection.lastError,
  };
}

async function spotifyTokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(12_000) });
  let payload: TokenResponse = {};
  try { payload = await response.json() as TokenResponse; } catch { /* handled below */ }
  if (!response.ok || payload.error || !payload.access_token) {
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw new SpotifyTokenError("Spotify no aceptó la autorización. Vuelve a conectar.", permanent);
  }
  return payload;
}

async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  const response = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw ApiError.badRequest("No se pudo leer la cuenta de Spotify.");
  return response.json() as Promise<SpotifyProfile>;
}
