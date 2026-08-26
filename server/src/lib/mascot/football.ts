/** football-data.org v4 — calendarios y resultados. La clave se guarda en Ajustes (o FOOTBALL_DATA_API_KEY). */

const BASE = "https://api.football-data.org/v4";
const DEFAULT_TZ = "Europe/Madrid";

export type FootballKind = "next" | "last" | "upcoming" | "results";

/** IDs estables de football-data.org (LaLiga + clubes grandes). */
const TEAM_IDS: Record<string, number> = {
  barcelona: 81,
  barca: 81,
  fcb: 81,
  culers: 81,
  "real madrid": 86,
  madrid: 86,
  merengues: 86,
  "atletico madrid": 78,
  atletico: 78,
  atleti: 78,
  "athletic club": 77,
  athletic: 77,
  bilbao: 77,
  "real sociedad": 92,
  sociedad: 92,
  txuri: 92,
  valencia: 95,
  che: 95,
  sevilla: 559,
  betis: 90,
  "real betis": 90,
  villarreal: 94,
  girona: 298,
  osasuna: 79,
  celta: 558,
  "celta vigo": 558,
  mallorca: 89,
  getafe: 82,
  alaves: 263,
  espanyol: 80,
  "rayo vallecano": 87,
  rayo: 87,
  levante: 88,
  elche: 285,
  oviedo: 267,
  arsenal: 57,
  chelsea: 61,
  liverpool: 64,
  "manchester city": 65,
  city: 65,
  "manchester united": 66,
  united: 66,
  tottenham: 73,
  spurs: 73,
  bayern: 5,
  "bayern munich": 5,
  dortmund: 4,
  bvb: 4,
  "borussia dortmund": 4,
  psg: 524,
  "paris saint germain": 524,
  juventus: 109,
  inter: 108,
  milan: 98,
  "ac milan": 98,
  napoli: 113,
};

const ALIAS_KEYS = Object.keys(TEAM_IDS).sort((a, b) => b.length - a.length);

export function normalizeTeamKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(cf|fc|club|de|el|la|los|las|del|the|cd|ud|rcd|sad)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTeamKey(query: string): string | null {
  const q = normalizeTeamKey(query);
  if (!q) return null;
  for (const alias of ALIAS_KEYS) {
    if (q === alias || q.includes(` ${alias} `) || q.startsWith(`${alias} `) || q.endsWith(` ${alias}`)) {
      return alias;
    }
  }
  return TEAM_IDS[q] ? q : null;
}

export function footballIntent(query: string): { team: string; kind: FootballKind } | null {
  const q = normalizeTeamKey(query);
  const aboutFootball = /\b(partido|partidos|resultado|resultados|marcador|jornada|clasico|champions|liga|futbol|barca|barcelona|fcb)\b/.test(q)
    || extractTeamKey(query) !== null;
  if (!aboutFootball) return null;
  if (!/\b(partido|partidos|resultado|resultados|marcador|jornada|proximo|proximos|siguiente|siguientes|ultimo|calendario|quien juega|cuanto quedo|como quedo)\b/.test(q)
    && !extractTeamKey(query)) {
    return null;
  }
  let kind: FootballKind = "next";
  if (/\b(proximos|siguientes|calendario)\b/.test(q)) kind = "upcoming";
  else if (/\b(resultados)\b/.test(q)) kind = "results";
  else if (/\b(resultado|marcador|quedo|gano|perdio|ultimo|ayer|anoche)\b/.test(q)) kind = "last";
  const team = extractTeamKey(query);
  if (!team) return null;
  return { team, kind };
}

type ApiMatch = {
  utcDate?: string;
  status?: string;
  venue?: string;
  competition?: { name?: string };
  homeTeam?: { name?: string; shortName?: string };
  awayTeam?: { name?: string; shortName?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
};

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 3 * 60_000;

export function resolveFootballApiKey(userKey?: string | null): string {
  return (userKey ?? "").trim() || (process.env.FOOTBALL_DATA_API_KEY ?? "").trim();
}

export async function pingFootballKey(key: string): Promise<"ok" | "invalid" | "unreachable"> {
  const token = key.trim();
  if (!token) return "invalid";
  try {
    const res = await fetch(`${BASE}/competitions`, {
      headers: { "X-Auth-Token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return "invalid";
    if (res.ok) return "ok";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function footballLookup(teamQuery: string, kind: FootballKind = "next", tz = DEFAULT_TZ, userKey?: string | null): Promise<string> {
  const key = resolveFootballApiKey(userKey);
  if (!key) return "Configura la API key de football-data.org en Ajustes → Mascota para ver partidos.";

  const alias = extractTeamKey(teamQuery) ?? normalizeTeamKey(teamQuery);
  const teamId = TEAM_IDS[alias];
  if (!teamId) {
    return `No reconozco el equipo «${teamQuery}». Prueba con el nombre del club (p. ej. Barça, Real Madrid, Athletic).`;
  }

  const cacheKey = `${teamId}:${kind}:${tz}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  const now = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const past = new Date(now.getTime() - 60 * 86400000);
  const future = new Date(now.getTime() + 90 * 86400000);

  const wantFinished = kind === "last" || kind === "results";
  const status = wantFinished ? "FINISHED" : "SCHEDULED,TIMED";
  const dateFrom = isoDay(wantFinished ? past : now);
  const dateTo = isoDay(wantFinished ? now : future);
  const url = `${BASE}/teams/${teamId}/matches?status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

  try {
    const res = await fetch(url, {
      headers: { "X-Auth-Token": key, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 429) return "La API de fútbol ha alcanzado el límite de peticiones. Prueba en un minuto.";
    if (res.status === 403 || res.status === 401) return "La clave de football-data.org no es válida o no tiene acceso a esa liga.";
    if (!res.ok) return `No pude leer el calendario (HTTP ${res.status}).`;
    const body = (await res.json()) as { matches?: ApiMatch[] };
    const matches = [...(body.matches ?? [])].sort((a, b) => (a.utcDate ?? "").localeCompare(b.utcDate ?? ""));
    const text = formatMatches(alias, kind, matches, now, tz);
    cache.set(cacheKey, { at: Date.now(), text });
    return text;
  } catch {
    return "No se pudo consultar football-data.org ahora mismo.";
  }
}

function teamLabel(m: ApiMatch, side: "home" | "away"): string {
  const t = side === "home" ? m.homeTeam : m.awayTeam;
  return t?.shortName || t?.name || side;
}

function formatWhen(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const local = new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${local} (${tz})`;
}

function formatMatches(alias: string, kind: FootballKind, matches: ApiMatch[], now: Date, tz: string): string {
  const club = alias === "barca" || alias === "barcelona" || alias === "fcb" ? "FC Barcelona" : alias;
  if (kind === "next" || kind === "upcoming") {
    const upcoming = matches.filter((m) => m.utcDate && new Date(m.utcDate) >= new Date(now.getTime() - 3 * 3600_000));
    if (upcoming.length === 0) return `No hay partidos próximos de ${club} en el calendario.`;
    const list = kind === "next" ? upcoming.slice(0, 1) : upcoming.slice(0, 5);
    return list.map((m) => {
      const score = scoreLine(m);
      return [
        `${teamLabel(m, "home")} vs ${teamLabel(m, "away")}`,
        m.competition?.name ? `Competición: ${m.competition.name}` : null,
        m.utcDate ? `Cuándo: ${formatWhen(m.utcDate, tz)}` : null,
        m.venue ? `Estadio: ${m.venue}` : null,
        m.status && m.status !== "TIMED" && m.status !== "SCHEDULED" ? `Estado: ${m.status}` : null,
        score,
      ].filter(Boolean).join("\n");
    }).join("\n---\n");
  }

  const finished = matches.filter((m) => m.utcDate && new Date(m.utcDate) <= now).reverse();
  if (finished.length === 0) return `No hay resultados recientes de ${club}.`;
  const list = kind === "last" ? finished.slice(0, 1) : finished.slice(0, 5);
  return list.map((m) => {
    const score = scoreLine(m) ?? "Sin marcador";
    return [
      `${teamLabel(m, "home")} vs ${teamLabel(m, "away")}`,
      score,
      m.competition?.name ? `Competición: ${m.competition.name}` : null,
      m.utcDate ? `Cuándo: ${formatWhen(m.utcDate, tz)}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n---\n");
}

function scoreLine(m: ApiMatch): string | null {
  const h = m.score?.fullTime?.home;
  const a = m.score?.fullTime?.away;
  if (typeof h !== "number" || typeof a !== "number") return null;
  return `Resultado: ${h}–${a}`;
}
