import { bitrateFromAudioBytes, bitrateFromIcyHeaders, codecFromContentType, snapBitrate } from "./streamBitrate.js";
import { APP_NAME } from "./brand.js";

const RADIO_STREAM_HOSTS = new Set([
  "s1.we4stream.com",
  "s2.we4stream.com",
  "s3.we4stream.com",
  "azura.abcorp.es",
  "streaming.shoutcast.com",
  "playerservices.streamtheworld.com",
  "eu1.lhdserver.es",
  "betelgeuse.nucast.co.uk",
]);

const CACHE_MS = 20_000;
const PROBE_MS = 1_800;
const PROBE_BYTES = 32_768;
const cache = new Map<string, { at: number; info: RadioStreamInfo }>();

export type RadioStreamInfo = {
  kbps: number | null;
  codec: string | null;
};

export function isAllowedRadioStreamUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (isPrivateHost(url.hostname)) return false;
  if (RADIO_STREAM_HOSTS.has(url.hostname)) return true;
  if (url.hostname.endsWith(".we4stream.com")) return true;
  if (url.hostname.endsWith(".live.streamtheworld.com")) return true;
  if (url.hostname.endsWith(".nucast.co.uk")) return true;
  return false;
}

export function stripCacheBust(url: string): string {
  return url.replace(/[?&]_=\d+$/, "").replace(/[?&]$/, "");
}

export async function probeRadioStream(url: string): Promise<RadioStreamInfo> {
  const target = stripCacheBust(url);
  if (!isAllowedRadioStreamUrl(target)) return { kbps: null, codec: null };
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS + 1_200);
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Icy-MetaData": "1",
        Accept: "*/*",
        "User-Agent": `${APP_NAME}/1.0 (radio bitrate)`,
      },
    });
    const codec = codecFromContentType(res.headers.get("content-type"));
    const icy = bitrateFromIcyHeaders(res.headers);
    const body = await readPrefix(res, PROBE_BYTES, PROBE_MS);
    const elapsed = Math.max(1, Date.now() - started);
    const metaInt = Number(res.headers.get("icy-metaint"));
    const audio = Number.isFinite(metaInt) && metaInt > 32 ? body.subarray(0, metaInt) : body;
    const framed = bitrateFromAudioBytes(audio);
    const measured = body.byteLength >= 8_192 ? snapBitrate((body.byteLength * 8) / elapsed) : 0;
    const kbps = icy ?? framed ?? (measured || null);
    const info = { kbps, codec };
    cache.set(target, { at: Date.now(), info });
    return info;
  } catch {
    return { kbps: null, codec: null };
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name.endsWith(".local") || name === "::1") return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(name)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(name)) return true;
  return false;
}

async function readPrefix(res: Response, maxBytes: number, maxMs: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const started = Date.now();
  try {
    while (total < maxBytes && Date.now() - started < maxMs) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
