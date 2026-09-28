import {
  DEFAULT_SPOTIFY_EMBED,
  SPOTIFY_EMBED_CLIP,
  SPOTIFY_EMBED_HEIGHT,
  parseSpotifyUrl,
  spotifyEmbedHeight,
  spotifyEmbedSrc,
  spotifyOpenUrl,
  type SpotifyEmbed,
} from "./spotifyUrl";
import { http } from "./api";

const LEGACY_SPOTIFY_KEYS = ["dayly.spotify.tokens", "dayly.spotify.verifier", "dayly.spotify.state", "dayly.spotify.return"];
if (typeof window !== "undefined") for (const key of LEGACY_SPOTIFY_KEYS) { localStorage.removeItem(key); sessionStorage.removeItem(key); }

export type SpotifyPlaylist = {
  id: string;
  name: string;
  image: string | null;
  tracks: number;
  uri: string;
};

export type SpotifyMe = {
  name: string;
  product: string;
  premium: boolean;
};

type SpotifyConnectionSummary = SpotifyMe & { scopes: string; embed: SpotifyEmbed | null; connectedAt: string; lastError: string | null };
type SpotifyConfig = { enabled: boolean; configured: boolean; available: boolean; operational: boolean; connected: boolean; connection: SpotifyConnectionSummary | null };
type AccessToken = { accessToken: string; expiresAt: string };

let configPromise: Promise<SpotifyConfig> | null = null;
let currentConfig: SpotifyConfig | null = null;
let connected = false;
let scopes = "";
let embedPreference: SpotifyEmbed | null = null;
let accessToken: { value: string; expiresAt: number } | null = null;
let refreshPromise: Promise<string> | null = null;
let spotifyGeneration = 0;

export function resetSpotifyConfig() {
  configPromise = null;
  currentConfig = null;
}

export async function loadSpotifyConfig(): Promise<SpotifyConfig> {
  if (!configPromise) {
    const generation = spotifyGeneration;
    const request = http.get<SpotifyConfig>("/api/spotify/config", { _ts: Date.now() }).then((value) => {
      assertCurrentSpotifyGeneration(generation);
      currentConfig = value;
      connected = value.connected;
      scopes = value.connection?.scopes ?? "";
      embedPreference = value.connection?.embed ? parseSpotifyUrl(`spotify:${value.connection.embed.kind}:${value.connection.embed.id}`) : null;
      return value;
    });
    configPromise = request;
    void request.catch(() => { if (configPromise === request) configPromise = null; });
  }
  return configPromise;
}

export async function spotifyConnectEnabled(): Promise<boolean> {
  return (await loadSpotifyConfig()).available;
}

export function readStoredEmbed(): SpotifyEmbed | null {
  return embedPreference;
}

export function writeStoredEmbed(embed: SpotifyEmbed | null) {
  embedPreference = embed;
  if (connected) void http.patch("/api/spotify/preference", { embed: embed ? { kind: embed.kind, id: embed.id } : null });
}

export function spotifyIsConnected(): boolean {
  return connected;
}

/**
 * A refresh token keeps the scopes it was issued with, so a session created
 * before `streaming` was requested can never drive the Web Playback SDK. Only
 * report a definitive answer: sessions stored before we recorded scopes are
 * unknown, and those get to try.
 */
export function spotifyCanStream(): boolean {
  return !scopes || scopes.split(/\s+/).includes("streaming");
}

export async function disconnectSpotify() {
  clearSpotifySession();
  await http.post("/api/spotify/disconnect");
}

export async function beginSpotifyLogin(): Promise<void> {
  resetSpotifyConfig();
  const { available } = await loadSpotifyConfig();
  if (!available) {
    throw new Error("El administrador aún no ha vinculado Spotify en Ajustes.");
  }
  const result = await http.post<{ authorizeUrl: string }>("/api/spotify/oauth/start", { returnTo: `${window.location.pathname}${window.location.search}` });
  window.location.assign(result.authorizeUrl);
}

export async function completeSpotifyLogin(search: string): Promise<string> {
  const generation = spotifyGeneration;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const error = params.get("error");
  if (error) throw new Error(error === "access_denied" ? "Has cancelado el acceso a Spotify." : "No se pudo conectar con Spotify.");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    throw new Error("La conexión con Spotify no es válida. Inténtalo de nuevo.");
  }
  const result = await http.post<{ returnTo: string; connection: SpotifyConnectionSummary }>("/api/spotify/oauth/complete", { code, state });
  assertCurrentSpotifyGeneration(generation);
  connected = true;
  scopes = result.connection.scopes;
  embedPreference = result.connection.embed;
  resetSpotifyConfig();
  return result.returnTo;
}

/** Sync token for SDK getOAuthToken — must not await inside the callback. */
export function primeSpotifyAccessToken(): string | null {
  if (!accessToken || accessToken.expiresAt < Date.now() + 5_000) return null;
  return accessToken.value;
}

export function peekSpotifyAccessToken(): string | null {
  return primeSpotifyAccessToken();
}

export async function spotifyAccessToken(): Promise<string> {
  const primed = primeSpotifyAccessToken();
  if (primed) return primed;
  return sharedAccessTokenRequest(false);
}

/** Authenticated Spotify Web API fetch with a single 401 refresh retry. */
export async function spotifyApiFetch(url: string, init: RequestInit = {}, opts?: { revokeOn401?: boolean; retried?: boolean }): Promise<Response> {
  const generation = spotifyGeneration;
  const token = await spotifyAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  assertCurrentSpotifyGeneration(generation);
  if (res.status !== 401) return res;
  if (opts?.revokeOn401) {
    try { await loadAccessToken(true); } catch { clearSpotifySession(); throw new Error("La sesión de Spotify ha caducado. Vuelve a conectar."); }
    if (!opts.retried) return spotifyApiFetch(url, init, { ...opts, retried: true });
  }
  if (!opts?.retried) {
    await loadAccessToken(true);
    return spotifyApiFetch(url, init, { ...opts, retried: true });
  }
  return res;
}

async function loadAccessToken(force: boolean): Promise<string> {
  const generation = spotifyGeneration;
  const payload = force
    ? await http.post<AccessToken>("/api/spotify/access-token/refresh")
    : await http.get<AccessToken>("/api/spotify/access-token");
  assertCurrentSpotifyGeneration(generation);
  accessToken = { value: payload.accessToken, expiresAt: Date.parse(payload.expiresAt) };
  connected = true;
  return payload.accessToken;
}

export function clearSpotifySession() {
  spotifyGeneration += 1;
  currentConfig = null;
  configPromise = null;
  connected = false;
  scopes = "";
  embedPreference = null;
  accessToken = null;
  refreshPromise = null;
  playlistTrackCache.clear();
  playlistTrackInflight.clear();
  if (typeof window !== "undefined") for (const key of LEGACY_SPOTIFY_KEYS) { localStorage.removeItem(key); sessionStorage.removeItem(key); }
}

function assertCurrentSpotifyGeneration(generation: number): void {
  if (generation !== spotifyGeneration) throw new Error("La sesión ha cambiado. Vuelve a abrir Spotify.");
}

/**
 * Shuffle is a Web API flag on the current device. Do not follow it with
 * PUT /play, resume or togglePlay — the SDK already owns the stream.
 */
export async function putSpotifyShuffle(deviceId: string, state: boolean): Promise<void> {
  const qs = new URLSearchParams({
    state: state ? "true" : "false",
    device_id: deviceId,
  });
  const res = await spotifyApiFetch(`https://api.spotify.com/v1/me/player/shuffle?${qs.toString()}`, { method: "PUT" });
  if (res.ok || res.status === 204) return;
  if (res.status === 404) return;
  throw new Error("No se pudo cambiar el modo aleatorio.");
}

/** Forces a token refresh for the SDK when access looks valid but Spotify rejects it. */
export async function refreshSpotifyAccessToken(): Promise<string> {
  return sharedAccessTokenRequest(true);
}

function sharedAccessTokenRequest(force: boolean): Promise<string> {
  if (!refreshPromise) {
    const request = loadAccessToken(force);
    refreshPromise = request;
    void request.then(
      () => { if (refreshPromise === request) refreshPromise = null; },
      () => { if (refreshPromise === request) refreshPromise = null; },
    );
  }
  return refreshPromise;
}

export async function fetchSpotifyMe(): Promise<SpotifyMe> {
  const cfg = currentConfig ?? await loadSpotifyConfig();
  if (!cfg.connected || !cfg.connection) throw new Error("Conecta Spotify para continuar.");
  return cfg.connection;
}

export async function listSpotifyPlaylists(): Promise<SpotifyPlaylist[]> {
  const items: SpotifyPlaylist[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url && items.length < 100) {
    const res = await spotifyApiFetch(url);
    if (!res.ok) throw new Error("No se pudieron leer tus listas de Spotify.");
    const json = await res.json() as {
      next?: string | null;
      items?: {
        id: string; name: string; uri: string; images?: { url: string }[];
        tracks?: { total: number }; items?: { total: number };
      }[];
    };
    for (const item of json.items ?? []) {
      items.push({
        id: item.id,
        name: item.name,
        uri: item.uri,
        tracks: item.tracks?.total ?? item.items?.total ?? 0,
        image: item.images?.[0]?.url ?? null,
      });
    }
    url = json.next ?? null;
  }
  return items;
}

export type SpotifyTrack = {
  uri: string;
  name: string;
  artists: string;
  durationMs: number;
  image: string | null;
};

export function mapSpotifyTrack(raw: unknown): SpotifyTrack | null {
  const t = raw as {
    uri?: string; name?: string; duration_ms?: number;
    artists?: { name: string }[]; album?: { images?: { url: string }[] };
  } | null;
  if (!t?.uri || !t.name || !t.uri.startsWith("spotify:track:")) return null;
  return {
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms ?? 0,
    image: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? t.album?.images?.[2]?.url ?? null,
  };
}

const playlistTrackCache = new Map<string, SpotifyTrack[]>();
const playlistTrackInflight = new Map<string, Promise<SpotifyTrack[]>>();

export function cachedPlaylistTracks(playlistId: string): SpotifyTrack[] | null {
  return playlistTrackCache.get(normalizePlaylistId(playlistId)) ?? null;
}

/** GET /playlists/{id}/items max page size after the February 2026 Web API. */
const PLAYLIST_TRACK_PAGE = 50;
const PLAYLIST_TRACK_CAP = 300;

function normalizePlaylistId(raw: string): string {
  const value = raw.trim();
  const uri = /^spotify:playlist:([A-Za-z0-9]+)$/i.exec(value);
  if (uri?.[1]) return uri[1];
  const path = /playlist\/([A-Za-z0-9]+)/i.exec(value);
  if (path?.[1]) return path[1];
  return value;
}

type PlaylistPage = { next?: string | null; items?: { item?: unknown; track?: unknown }[] };

/** Spotify Dev Mode: contents only for playlists you own or collaborate on. */
export class SpotifyPlaylistRestrictedError extends Error {
  readonly code = "PLAYLIST_RESTRICTED" as const;
  constructor() {
    super("Spotify solo deja listar las canciones de las listas que has creado tú.");
    this.name = "SpotifyPlaylistRestrictedError";
  }
}

/**
 * Official Web API (Feb 2026): GET /v1/playlists/{id}/items
 * `/tracks` was removed and returns 403. Max `limit` is 50. Each row uses
 * `item` (not `track`). Followed/editorial lists are 403 — use the player queue.
 */
export async function listPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const id = normalizePlaylistId(playlistId);
  const cached = playlistTrackCache.get(id);
  if (cached && cached.length > 0) return cached;
  const pending = playlistTrackInflight.get(id);
  if (pending) return pending;

  const load = (async () => {
    const encoded = encodeURIComponent(id);
    const tracks: SpotifyTrack[] = [];
    let url: string | null = `https://api.spotify.com/v1/playlists/${encoded}/items?limit=${PLAYLIST_TRACK_PAGE}`;
    let first = true;
    while (url && tracks.length < PLAYLIST_TRACK_CAP) {
      const res = await spotifyApiFetch(url);
      if (!res.ok) {
        if (first && res.status === 403) throw new SpotifyPlaylistRestrictedError();
        throw new Error("No se pudieron leer las canciones de la lista.");
      }
      first = false;
      const json = await res.json() as PlaylistPage;
      for (const entry of json.items ?? []) {
        const track = mapSpotifyTrack(entry.item ?? entry.track);
        if (track) tracks.push(track);
        if (tracks.length >= PLAYLIST_TRACK_CAP) break;
      }
      url = json.next ?? null;
    }
    if (tracks.length > 0) playlistTrackCache.set(id, tracks);
    else playlistTrackCache.delete(id);
    return tracks;
  })();

  playlistTrackInflight.set(id, load);
  try {
    return await load;
  } finally {
    playlistTrackInflight.delete(id);
  }
}

/** Currently playing + upcoming tracks. Works for followed lists after Play. */
export async function listSpotifyPlaybackQueue(): Promise<SpotifyTrack[]> {
  const res = await spotifyApiFetch("https://api.spotify.com/v1/me/player/queue");
  if (!res.ok) return [];
  const json = await res.json() as { currently_playing?: unknown; queue?: unknown[] };
  const tracks: SpotifyTrack[] = [];
  const current = mapSpotifyTrack(json.currently_playing);
  if (current) tracks.push(current);
  for (const item of json.queue ?? []) {
    const track = mapSpotifyTrack(item);
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await spotifyApiFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=8&market=from_token`);
  if (!res.ok) throw new Error("No se pudo buscar en Spotify.");
  const json = await res.json() as { tracks?: { items?: unknown[] } };
  return (json.tracks?.items ?? []).map(mapSpotifyTrack).filter((t): t is SpotifyTrack => Boolean(t));
}

export type SpotifySearchResult = {
  kind: "track" | "playlist";
  id: string;
  uri: string;
  name: string;
  image: string | null;
  subtitle: string;
};

export async function searchSpotify(query: string, type: "all" | "track" | "playlist" = "all"): Promise<SpotifySearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, type: type === "all" ? "track,playlist" : type, limit: "8", market: "from_token" });
  const res = await spotifyApiFetch(`https://api.spotify.com/v1/search?${params}`);
  if (!res.ok) throw new Error("No se pudo buscar en Spotify. Vuelve a intentarlo.");
  const json = await res.json() as { tracks?: { items?: unknown[] }; playlists?: { items?: unknown[] } };
  const results: SpotifySearchResult[] = [];
  for (const item of json.tracks?.items ?? []) {
    const track = mapSpotifyTrack(item);
    if (!track) continue;
    const id = track.uri.split(":")[2];
    if (id) results.push({ kind: "track", id, uri: track.uri, name: track.name, image: track.image, subtitle: track.artists });
  }
  for (const item of json.playlists?.items ?? []) {
    if (!item || typeof item !== "object") continue;
    const playlist = item as { id?: unknown; name?: unknown; images?: { url?: unknown }[]; owner?: { display_name?: unknown } };
    if (typeof playlist.id !== "string" || !/^[a-zA-Z0-9]+$/.test(playlist.id) || typeof playlist.name !== "string") continue;
    const cover = playlist.images?.[0]?.url;
    results.push({ kind: "playlist", id: playlist.id, uri: `spotify:playlist:${playlist.id}`, name: playlist.name,
      image: typeof cover === "string" ? cover : null,
      subtitle: typeof playlist.owner?.display_name === "string" ? playlist.owner.display_name : "Playlist de Spotify" });
  }
  return results;
}

export async function playSpotifyOnDevice(deviceId: string, uri: string, offsetUri?: string): Promise<void> {
  const isTrack = /:track:/.test(uri);
  const body: Record<string, unknown> = isTrack ? { uris: [uri] } : { context_uri: uri };
  if (!isTrack && offsetUri) body.offset = { uri: offsetUri };
  const res = await spotifyApiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) throw new Error("Spotify no ha podido reproducir esa lista.");
}

export async function setSpotifyPlaybackVolume(percent: number, deviceId: string): Promise<void> {
  const volume = Math.round(Math.min(1, Math.max(0, percent)) * 100);
  const res = await spotifyApiFetch(
    `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}&device_id=${encodeURIComponent(deviceId)}`,
    { method: "PUT" },
  );
  if (!res.ok && res.status !== 204 && res.status !== 202) {
    throw new Error("No se pudo cambiar el volumen de Spotify.");
  }
}

export { DEFAULT_SPOTIFY_EMBED, SPOTIFY_EMBED_CLIP, SPOTIFY_EMBED_HEIGHT, parseSpotifyUrl, spotifyEmbedHeight, spotifyEmbedSrc, spotifyOpenUrl };
export type { SpotifyEmbed };
