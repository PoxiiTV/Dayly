import { getGifKeys, type GifProvider } from "../gifSettings.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";

export type GifResult = {
  id: string;
  provider: GifProvider;
  /** Small looping preview for the grid. */
  preview: string;
  /** What gets sent to the conversation. */
  url: string;
  width: number;
  height: number;
  description: string;
};

export type GifSearch = {
  results: GifResult[];
  /** A provider answered with media from a host we do not allow. */
  blockedHosts: boolean;
};

/** A picker must not hang on a provider having a bad day. */
const TIMEOUT_MS = 6_000;
const PER_PROVIDER = 24;

/**
 * Media hosts we accept, per provider. These URLs end up in an `<img>` in
 * someone else's client, so anything outside the list is dropped.
 */
const ALLOWED_HOSTS: Record<GifProvider, RegExp> = {
  giphy: /(^|\.)giphy\.com$/i,
  klipy: /(^|\.)klipy\.com$/i,
};

export function isAllowedGifUrl(raw: string): boolean {
  return gifUrlProvider(raw) !== null;
}

/** Which provider a URL belongs to, or null when it belongs to none of them. */
export function gifUrlProvider(raw: string): GifProvider | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    for (const [provider, host] of Object.entries(ALLOWED_HOSTS) as [GifProvider, RegExp][]) {
      if (host.test(url.hostname)) return provider;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Cache: the same search by several people costs one call             */
/* ------------------------------------------------------------------ */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; results: GifResult[] }>();

function cached(key: string): GifResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

function remember(key: string, results: GifResult[]): void {
  if (cache.size >= CACHE_MAX) {
    // Map keeps insertion order, so this drops the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), results });
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */
async function getJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`http ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyItem = { id?: string; title?: string; images?: Record<string, GiphyImage> };

/** Maps a Giphy payload. Exported so the mapping can be tested without a key. */
export function mapGiphy(body: unknown): GifResult[] {
  const items = (body as { data?: GiphyItem[] })?.data ?? [];
  return items.flatMap((item) => {
    const images = item.images ?? {};
    const send = images.downsized_medium ?? images.fixed_height ?? images.original;
    const preview = images.fixed_width_small ?? images.preview_gif ?? send;
    if (!item.id || !send?.url || !preview?.url) return [];
    return [{
      id: `giphy:${item.id}`,
      provider: "giphy" as const,
      preview: preview.url,
      url: send.url,
      width: Number(send.width ?? 0) || 0,
      height: Number(send.height ?? 0) || 0,
      description: (item.title ?? "GIF").slice(0, 120) || "GIF",
    }];
  });
}

type TenorFormat = { url?: string; dims?: number[] };
type TenorItem = { id?: string; content_description?: string; media_formats?: Record<string, TenorFormat> };

/** Klipy publishes a Tenor-shaped v2 API, so this mapper follows that shape. */
export function mapKlipy(body: unknown): GifResult[] {
  const items = (body as { results?: TenorItem[] })?.results ?? [];
  return items.flatMap((item) => {
    const gif = item.media_formats?.gif;
    const tiny = item.media_formats?.tinygif ?? gif;
    if (!item.id || !gif?.url || !tiny?.url) return [];
    const [width = 0, height = 0] = gif.dims ?? [];
    return [{
      id: `klipy:${item.id}`,
      provider: "klipy" as const,
      preview: tiny.url,
      url: gif.url,
      width,
      height,
      description: (item.content_description ?? "GIF").slice(0, 120) || "GIF",
    }];
  });
}

async function searchGiphy(key: string, q: string): Promise<GifResult[]> {
  const url = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("api_key", key);
  url.searchParams.set("limit", String(PER_PROVIDER));
  url.searchParams.set("rating", "pg-13");
  url.searchParams.set("lang", "es");
  return mapGiphy(await getJson(url));
}

async function searchKlipy(key: string, q: string): Promise<GifResult[]> {
  const url = new URL(`https://api.klipy.com/v2/${q ? "search" : "featured"}`);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  url.searchParams.set("client_key", "dayly");
  url.searchParams.set("limit", String(PER_PROVIDER));
  url.searchParams.set("locale", "es_ES");
  url.searchParams.set("contentfilter", "medium");
  url.searchParams.set("media_filter", "gif,tinygif");
  return mapKlipy(await getJson(url));
}

const SEARCHERS: Record<GifProvider, (key: string, q: string) => Promise<GifResult[]>> = {
  giphy: searchGiphy,
  klipy: searchKlipy,
};

/** One from each provider in turn, so the grid shows both. */
export function interleave(lists: GifResult[][]): GifResult[] {
  const out: GifResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item) out.push(item);
    }
  }
  return out;
}

/** Drops anything served from a host we do not allow, and says so. */
export function keepAllowed(results: GifResult[], provider: GifProvider): { allowed: GifResult[]; blocked: boolean } {
  let blocked = false;
  const allowed = results.filter((item) => {
    const ok = gifUrlProvider(item.url) !== null && gifUrlProvider(item.preview) !== null;
    if (!ok) {
      blocked = true;
      // Worth a log line: a provider changing CDN would otherwise look like an
      // empty result set, and the fix is one hostname in the allow list.
      logger.warn({ provider, url: item.url, preview: item.preview }, "gif from a host that is not allowed");
    }
    return ok;
  });
  return { allowed, blocked };
}

/**
 * Searches every configured provider at once and merges what comes back.
 *
 * One provider failing — down, or out of quota — must not empty the picker, so
 * the other one still answers. An empty query asks for the trending list, which
 * is what the panel shows before anything is typed.
 */
export async function searchGifs(rawQuery: string): Promise<GifSearch> {
  const keys = await getGifKeys();
  const providers = Object.entries(keys) as [GifProvider, string][];
  if (providers.length === 0) throw ApiError.badRequest("La búsqueda de GIF no está configurada.");

  const q = rawQuery.trim().slice(0, 60);
  const settled = await Promise.allSettled(providers.map(async ([provider, key]) => {
    const cacheKey = `${provider}:${q}`;
    const hit = cached(cacheKey);
    if (hit) return hit;
    const results = await SEARCHERS[provider](key, q);
    remember(cacheKey, results);
    return results;
  }));

  const lists: GifResult[][] = [];
  let blockedHosts = false;
  settled.forEach((outcome, index) => {
    const provider = providers[index][0];
    if (outcome.status === "rejected") {
      logger.warn({ provider, err: outcome.reason }, "gif provider search failed");
      return;
    }
    const { allowed, blocked } = keepAllowed(outcome.value, provider);
    if (blocked) blockedHosts = true;
    lists.push(allowed);
  });

  if (lists.length === 0) throw ApiError.internal("Los proveedores de GIF no responden.");
  return { results: interleave(lists), blockedHosts };
}
