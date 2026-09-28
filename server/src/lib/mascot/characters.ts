export const MASCOT_IDS = ["calen", "tashi", "nubo", "foco", "posti", "orbi"] as const;
export type MascotId = (typeof MASCOT_IDS)[number];

const NAMES: Record<MascotId, string> = {
  calen: "Calen",
  tashi: "Tashi",
  nubo: "Nubo",
  foco: "Foco",
  posti: "Posti",
  orbi: "Orbi",
};

export function asMascotId(value: unknown): MascotId {
  // Legacy accounts may still contain the old Habi id in their profile.
  if (value === "habi") return "nubo";
  if (typeof value === "string" && (MASCOT_IDS as readonly string[]).includes(value)) return value as MascotId;
  return "calen";
}

export function mascotName(id: MascotId): string {
  return NAMES[id];
}
