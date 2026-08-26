/** Open-Meteo — geocoding + forecast, sin API key. */

const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const UA = "Dayly-mascot/1.0";

export type WeatherKind = "now" | "today" | "tomorrow" | "week";

const TZ_CITY: Record<string, string> = {
  "Europe/Madrid": "Madrid",
  "Atlantic/Canary": "Las Palmas de Gran Canaria",
  "Europe/Lisbon": "Lisboa",
  "Europe/London": "Londres",
  "Europe/Paris": "París",
  "Europe/Berlin": "Berlín",
  "Europe/Rome": "Roma",
  "America/Mexico_City": "Ciudad de México",
  "America/New_York": "Nueva York",
  "America/Argentina/Buenos_Aires": "Buenos Aires",
  "America/Santiago": "Santiago",
  "America/Bogota": "Bogotá",
  "America/Lima": "Lima",
};

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 5 * 60_000;

export function placeFromTz(tz: string): string {
  if (TZ_CITY[tz]) return TZ_CITY[tz];
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

/** WMO Weather interpretation codes (Open-Meteo). */
export function wmoLabel(code: number): string {
  if (code === 0) return "despejado";
  if (code === 1) return "mayormente despejado";
  if (code === 2) return "parcialmente nublado";
  if (code === 3) return "cubierto";
  if (code === 45 || code === 48) return "niebla";
  if (code >= 51 && code <= 55) return "llovizna";
  if (code === 56 || code === 57) return "llovizna helada";
  if (code >= 61 && code <= 65) return "lluvia";
  if (code === 66 || code === 67) return "lluvia helada";
  if (code >= 71 && code <= 77) return "nieve";
  if (code >= 80 && code <= 82) return "chubascos";
  if (code === 85 || code === 86) return "chubascos de nieve";
  if (code === 95) return "tormenta";
  if (code === 96 || code === 99) return "tormenta con granizo";
  return `código WMO ${code}`;
}

export function weatherIntent(query: string): { place: string; kind: WeatherKind } | null {
  const q = query.trim();
  if (!/(clima|temperatura|llueve|llover|lluvia|pron[oó]stico|previsi[oó]n|meteorolog|qu[eé]\s+tiempo|el\s+tiempo|hace\s+calor|hace\s+fr[ií]o|viento)/i.test(q)) {
    return null;
  }
  let kind: WeatherKind = "now";
  if (/(semana|próximos\s+d[ií]as|proximos\s+dias)/i.test(q)) kind = "week";
  else if (/(mañana|manana|tomorrow)/i.test(q)) kind = "tomorrow";
  else if (/\bhoy\b|\btoday\b/i.test(q)) kind = "today";

  const en = q.match(/\ben\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]{2,40})/i);
  const place = en?.[1]?.replace(/[?!.]+$/g, "").trim() ?? "";
  return { place, kind };
}

type GeoHit = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

type Forecast = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
  };
};

function num(v: number | undefined, digits = 0): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function formatForecast(placeLabel: string, kind: WeatherKind, data: Forecast): string {
  const cur = data.current;
  const daily = data.daily;
  const lines: string[] = [`Clima en ${placeLabel}`];
  if (cur && (kind === "now" || kind === "today")) {
    lines.push(
      `Ahora: ${num(cur.temperature_2m, 0)} °C (sensación ${num(cur.apparent_temperature, 0)} °C), ${wmoLabel(cur.weather_code ?? -1)}.`,
      `Humedad ${num(cur.relative_humidity_2m)} % · viento ${num(cur.wind_speed_10m, 0)} km/h${typeof cur.wind_gusts_10m === "number" ? ` (rachas ${num(cur.wind_gusts_10m, 0)})` : ""}${typeof cur.precipitation === "number" && cur.precipitation > 0 ? ` · precipitación ${num(cur.precipitation, 1)} mm` : ""}.`,
    );
  }
  const days = daily?.time ?? [];
  const start = kind === "tomorrow" ? 1 : 0;
  let take: number;
  switch (kind) {
    case "week":
      take = 7;
      break;
    case "tomorrow":
      take = 1;
      break;
    case "today":
    case "now":
      take = 2;
      break;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
  const slice = days.slice(start, start + take);
  for (let i = 0; i < slice.length; i++) {
    const idx = start + i;
    const ymd = days[idx];
    if (!ymd) continue;
    const code = daily?.weather_code?.[idx] ?? -1;
    const max = daily?.temperature_2m_max?.[idx];
    const min = daily?.temperature_2m_min?.[idx];
    const pop = daily?.precipitation_probability_max?.[idx];
    const rain = daily?.precipitation_sum?.[idx];
    const wind = daily?.wind_speed_10m_max?.[idx];
    const rainBit = typeof pop === "number" ? ` · lluvia ${pop}%` : typeof rain === "number" && rain > 0 ? ` · ${num(rain, 1)} mm` : "";
    const windBit = typeof wind === "number" ? ` · viento ${num(wind, 0)} km/h` : "";
    lines.push(`${ymd}: ${num(min, 0)}–${num(max, 0)} °C, ${wmoLabel(code)}${rainBit}${windBit}.`);
  }
  if (lines.length === 1) return `No hay datos de clima para ${placeLabel}.`;
  return lines.join("\n");
}

async function geocode(place: string): Promise<GeoHit | null> {
  const url = `${GEO_BASE}?name=${encodeURIComponent(place)}&count=1&language=es&format=json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: GeoHit[] };
  const hit = body.results?.[0];
  if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") return null;
  return hit;
}

export async function weatherLookup(placeQuery: string, kind: WeatherKind = "now", tz = "Europe/Madrid"): Promise<string> {
  const place = placeQuery.trim() && !/^(aqui|aquí|casa|local)$/i.test(placeQuery.trim())
    ? placeQuery.trim()
    : placeFromTz(tz);
  const cacheKey = `${place.toLowerCase()}:${kind}:${tz}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  try {
    const geo = await geocode(place);
    if (!geo) return `No encuentro el sitio «${place}». Prueba con una ciudad (p. ej. Madrid, Valencia).`;
    const zone = geo.timezone || tz;
    const days = kind === "week" ? 7 : 3;
    const params = new URLSearchParams({
      latitude: String(geo.latitude),
      longitude: String(geo.longitude),
      timezone: zone,
      forecast_days: String(days),
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
    });
    const res = await fetch(`${FORECAST_BASE}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Open-Meteo no respondió (HTTP ${res.status}).`;
    const data = (await res.json()) as Forecast;
    const label = [geo.name, geo.admin1, geo.country].filter(Boolean).join(", ");
    const text = formatForecast(label || place, kind, data);
    cache.set(cacheKey, { at: Date.now(), text });
    return text;
  } catch {
    return "No se pudo consultar el clima ahora mismo (Open-Meteo).";
  }
}
