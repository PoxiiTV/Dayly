export const MASCOT_IDS = ["calen", "tashi", "nubo", "foco", "posti", "orbi"] as const;
export type MascotId = (typeof MASCOT_IDS)[number];
export type MascotMood = "idle" | "thinking" | "talking";

export type MascotProfile = {
  id: MascotId;
  name: string;
  role: string;
  welcome: string;
};

export const MASCOT_PROFILES: Record<MascotId, MascotProfile> = {
  calen: {
    id: "calen",
    name: "Calen",
    role: "Calendario",
    welcome: "👋 ¡Hola! Soy Calen, tu agenda personal. ¿Qué necesitas hoy? Puedo ayudarte con tareas, notas, eventos, recordatorios, hábitos y mucho más. ✨",
  },
  tashi: {
    id: "tashi",
    name: "Tashi",
    role: "Tareas",
    welcome: "👋 ¡Hola! Soy Tashi. Te ayudo a ordenar tareas, prioridades y listas. ¿Qué tachamos hoy?",
  },
  nubo: {
    id: "nubo",
    name: "Nubo",
    role: "Notas",
    welcome: "👋 ¡Hola! Soy Nubo. Apunto ideas y notas para que no se te escapen. ¿Qué guardamos?",
  },
  foco: {
    id: "foco",
    name: "Foco",
    role: "Concentración",
    welcome: "👋 ¡Hola! Soy Foco. Te acompaño a concentrarte y a respetar el reloj. ¿Arrancamos un bloque?",
  },
  posti: {
    id: "posti",
    name: "Posti",
    role: "Apuntes",
    welcome: "👋 ¡Hola! Soy Posti. Dejo tus apuntes a mano para que no se te olvide nada.",
  },
  orbi: {
    id: "orbi",
    name: "Orbi",
    role: "Exploración",
    welcome: "👽 ¡Hola! Soy Orbi. Exploro contigo ideas, planes y nuevas posibilidades. ¿Qué descubrimos hoy?",
  },
};

export function asMascotId(value: unknown): MascotId {
  // Keep profiles saved before Habi was replaced by Nubo working.
  if (value === "habi") return "nubo";
  if (typeof value === "string" && (MASCOT_IDS as readonly string[]).includes(value)) return value as MascotId;
  return "calen";
}

export function mascotProfile(id: unknown): MascotProfile {
  return MASCOT_PROFILES[asMascotId(id)];
}
