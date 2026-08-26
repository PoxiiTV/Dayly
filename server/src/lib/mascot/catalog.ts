import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

const GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const CUSTOM_MODELS_CAP = 400;

const PRIVATE_NET = new BlockList();
PRIVATE_NET.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_NET.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NET.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_NET.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_NET.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_NET.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NET.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_NET.addAddress("::1", "ipv6");
PRIVATE_NET.addSubnet("fc00::", 7, "ipv6");
PRIVATE_NET.addSubnet("fe80::", 10, "ipv6");

export type MascotProvider = "opencode" | "openrouter" | "custom";
export type OpenCodeLane = "go" | "zen";
export type CatalogModel = { id: string; label: string; lane?: OpenCodeLane };

type CatalogCache = { at: number; go: string[]; zen: string[] };
let catalogCache: CatalogCache | null = null;

export function isBlockedGoModel(id: string): boolean {
  return /grok|luna/i.test(id);
}

/** Free according to the official model id (Go `ox-alpha-free`, Zen `*-free` / `big-pickle`). */
export function isGoFreeId(id: string): boolean {
  return /free/i.test(id) || id === "big-pickle";
}

function speedScore(id: string): number {
  const s = id.toLowerCase();
  let n = 0;
  if (s.includes("flash")) n += 40;
  if (s.includes("alpha")) n += 30;
  if (s.includes("mini")) n += 20;
  if (s.includes("tiny")) n += 20;
  n += Math.max(0, 40 - s.length);
  return n;
}

export function pickAutoFree(ids: string[]): string | null {
  const free = ids.filter((id) => isGoFreeId(id) && !isBlockedGoModel(id));
  if (free.length === 0) return null;
  return [...free].sort((a, b) => speedScore(b) - speedScore(a) || a.length - b.length)[0] ?? null;
}

/** HTTPS público, sin credenciales en la URL ni hosts locales/IP. */
export function parsePublicHttpsUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || s.length > 300) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return null;
  if (host.includes(":")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return url;
}

function isPrivateAddress(address: string): boolean {
  const v4mapped = address.startsWith("::ffff:") ? address.slice(7) : null;
  if (v4mapped) return PRIVATE_NET.check(v4mapped, "ipv4");
  if (address.includes(":")) return PRIVATE_NET.check(address, "ipv6");
  return PRIVATE_NET.check(address, "ipv4");
}

async function assertResolvedPublic(url: URL): Promise<void> {
  const { address } = await lookup(url.hostname, { verbatim: true });
  if (isPrivateAddress(address)) throw new Error("URL de modelos no permitida.");
}

async function fetchModelIds(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error("No se pudo leer el catálogo de OpenCode.");
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
}

export async function fetchCustomCatalog(modelsUrl: string, apiKey?: string): Promise<string[]> {
  const url = parsePublicHttpsUrl(modelsUrl);
  if (!url) throw new Error("La URL de modelos no es válida. Usa https, por ejemplo https://api.groq.com/openai/v1/models");
  await assertResolvedPublic(url);
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url.href, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(12_000),
    redirect: "manual",
  });
  if (!res.ok) throw new Error("No se pudo leer el catálogo de modelos.");
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).slice(0, CUSTOM_MODELS_CAP);
}

export async function loadOpenCodeCatalogs(): Promise<{ go: string[]; zen: string[] }> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return { go: catalogCache.go, zen: catalogCache.zen };
  }
  const [goRes, zenRes] = await Promise.allSettled([
    fetchModelIds(GO_MODELS_URL),
    fetchModelIds(ZEN_MODELS_URL),
  ]);
  const go = goRes.status === "fulfilled" ? goRes.value : [];
  const zen = zenRes.status === "fulfilled" ? zenRes.value : [];
  if (go.length === 0 && zen.length === 0) {
    const reason = goRes.status === "rejected" ? goRes.reason : zenRes.status === "rejected" ? zenRes.reason : null;
    throw reason instanceof Error ? reason : new Error("No se pudo leer el catálogo de OpenCode.");
  }
  catalogCache = { at: Date.now(), go, zen };
  return { go, zen };
}

export async function fetchGoCatalog(): Promise<string[]> {
  return (await loadOpenCodeCatalogs()).go;
}

export async function fetchZenCatalog(): Promise<string[]> {
  return (await loadOpenCodeCatalogs()).zen;
}

export async function fetchOpenRouterCatalog(): Promise<string[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error("No se pudo leer el catálogo de OpenRouter.");
  const body = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string } }[] };
  return (body.data ?? [])
    .filter((m) => m.id.endsWith(":free") || m.pricing?.prompt === "0")
    .map((m) => m.id);
}

function laneForId(id: string, go: Set<string>, zen: Set<string>): OpenCodeLane {
  if (go.has(id)) return "go";
  if (zen.has(id)) return "zen";
  if (id === "ox-alpha-free") return "go";
  if (isGoFreeId(id)) return "zen";
  return "go";
}

export function listOpencodeModels(go: string[], zen: string[]): CatalogModel[] {
  const goSet = new Set(go);
  const zenSet = new Set(zen);
  const seen = new Set<string>();
  const out: CatalogModel[] = [];

  const push = (id: string, lane: OpenCodeLane) => {
    if (!id || isBlockedGoModel(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: id, lane });
  };

  for (const id of zen) {
    if (isGoFreeId(id)) push(id, "zen");
  }
  for (const id of go) {
    if (isGoFreeId(id)) push(id, "go");
  }
  for (const id of go) {
    if (!isGoFreeId(id)) push(id, laneForId(id, goSet, zenSet));
  }
  return out;
}

export function resolveLane(model: string, go: string[], zen: string[]): OpenCodeLane {
  return laneForId(model, new Set(go), new Set(zen));
}

export async function resolveModel(provider: MascotProvider, requested: string): Promise<string> {
  return (await resolveChatTarget(provider, requested)).model;
}

export async function resolveChatTarget(
  provider: MascotProvider,
  requested: string,
): Promise<{ model: string; lane?: OpenCodeLane }> {
  if (provider !== "opencode") return { model: requested };
  const { go, zen } = await loadOpenCodeCatalogs();
  if (requested === "auto-free") {
    const picked = pickAutoFree([...go, ...zen.filter((id) => isGoFreeId(id))]);
    if (!picked) {
      const err = new Error("NOW_NO_FREE");
      err.name = "NoFreeGoModel";
      throw err;
    }
    return { model: picked, lane: resolveLane(picked, go, zen) };
  }
  return { model: requested, lane: resolveLane(requested, go, zen) };
}

export const AUTO_FREE_OPTION: CatalogModel = { id: "auto-free", label: "Auto (gratis y rápido)" };
