import { footballIntent, footballLookup } from "./football.js";
import { weatherIntent, weatherLookup } from "./weather.js";

export type SearchTopic = "food" | "exercise" | "place";

const DENY =
  /\b(c[oó]digo|program(ar|aci[oó]n|ador)|javascript|typescript|python|hacke[ao]|exploit|malware|pol[ií]tica|elecci[oó]n|guerra|noticia|crypto|criptomoneda|blockchain|\bnft\b|ensayo|deberes)\b/i;
const FOOD =
  /receta|men[uú]s?|comida|cocinar|cocin[aeo]|ingrediente|plato|desayuno|almuerzo|cena|merienda|postre|hornear|horno|restaurante|carta\b|tapas|ensalada|guiso|sopa|pasta|arroz|pollo|vegetariano|vegano|kcal|calor[ií]as|dieta|meal\s*prep|batch\s*cook|recipe|\bmenu\b/i;
const EXERCISE =
  /ejercicio|estiramiento|sentadilla|flexiones?|abdominales?|plancha\b|calentamiento|yoga|pilates|caminar|cardio|forma f[ií]sica|mantener la forma|ponerme en forma|gimnasio|pesas|movilidad|rutina\s+(de\s+)?(ejercicio|fuerza|casa)|workout|stretch/i;
const PLACE =
  /horario|a qu[eé] hora (abre|cierra)|opening hours|\b(abre|abren|cierra|cierran)\b|farmacia|supermercado|mercadona|lidl|carrefour|alcampo|eroski|comercio|tienda|correos|ayuntamiento|biblioteca|piscina|centro de salud|ambulatorio|dentista|peluquer|gasolinera|panader[ií]a|carnicer[ií]a|fruter[ií]a|estanco|mercado/i;

const REFUSAL =
  "No puedo buscar eso. Solo busco recetas o menús, ejercicio básico para mantener la forma, y datos prácticos para tu agenda (horario de un comercio, farmacia, supermercado…).";

export function searchTopic(query: string): SearchTopic | null {
  const q = query.trim();
  if (!q || DENY.test(q)) return null;
  if (FOOD.test(q)) return "food";
  if (EXERCISE.test(q)) return "exercise";
  if (PLACE.test(q)) return "place";
  return null;
}

export function searchAllowed(query: string): boolean {
  return searchTopic(query) !== null;
}

/** DuckDuckGo Instant Answer — no arbitrary URL fetch (anti-SSRF). */
export async function webSearch(query: string, tz = "Europe/Madrid", footballApiKey?: string | null): Promise<string> {
  const q = query.trim().slice(0, 200);
  if (!q) return "Consulta vacía.";
  const football = footballIntent(q);
  if (football) return footballLookup(football.team, football.kind, tz, footballApiKey);
  const weather = weatherIntent(q);
  if (weather) return weatherLookup(weather.place, weather.kind, tz);
  if (!searchAllowed(q)) return REFUSAL;
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Dayly-mascot/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "La búsqueda no respondió.";
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      Answer?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string }[];
    };
    const bits: string[] = [];
    if (data.Answer) bits.push(data.Answer);
    if (data.AbstractText) bits.push(`${data.Heading ? data.Heading + ": " : ""}${data.AbstractText}${data.AbstractURL ? ` (${data.AbstractURL})` : ""}`);
    for (const t of data.RelatedTopics ?? []) {
      if (t.Text) bits.push(t.Text);
      if (bits.length >= 5) break;
    }
    if (bits.length === 0) return `Sin resultados útiles para «${q}». Prueba a ser más concreto o indica fecha y hora.`;
    return bits.slice(0, 5).map((b, i) => `${i + 1}. ${b}`).join("\n");
  } catch {
    return "No se pudo buscar ahora. Puedes decirme la fecha y la hora a mano.";
  }
}
