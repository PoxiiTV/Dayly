export const SKIN_IDS = [
  "ink",
  "graphite",
  "slate",
  "forest",
  "clay",
  "wine",
  "copper",
  "sea",
  "gold",
  "royal",
  "amethyst",
  "ice",
] as const;

export type SkinId = (typeof SKIN_IDS)[number];

export const DEFAULT_SKIN: SkinId = "ink";

export interface SkinPreview {
  bg: string;
  surface: string;
  accent: string;
  border: string;
}

export interface SkinDef {
  id: SkinId;
  name: string;
  hint: string;
  preview: { light: SkinPreview; dark: SkinPreview };
}

export const SKINS: SkinDef[] = [
  {
    id: "ink",
    name: "Tinta",
    hint: "El de ahora",
    preview: {
      light: { bg: "#f8f8f6", surface: "#ffffff", accent: "#2563eb", border: "#e7e7e3" },
      dark: { bg: "#0b1220", surface: "#131b2d", accent: "#6382ff", border: "#252f46" },
    },
  },
  {
    id: "graphite",
    name: "Grafito",
    hint: "Mate",
    preview: {
      light: { bg: "#f4f4f5", surface: "#ffffff", accent: "#27272a", border: "#e4e4e7" },
      dark: { bg: "#0a0a0b", surface: "#161618", accent: "#4f5c73", border: "#2a2a2e" },
    },
  },
  {
    id: "slate",
    name: "Pizarra",
    hint: "Frío",
    preview: {
      light: { bg: "#f4f6f8", surface: "#ffffff", accent: "#334155", border: "#e2e6ec" },
      dark: { bg: "#0f1115", surface: "#181c24", accent: "#5c769b", border: "#30363f" },
    },
  },
  {
    id: "forest",
    name: "Bosque",
    hint: "Musgo",
    preview: {
      light: { bg: "#f5f7f3", surface: "#ffffff", accent: "#166534", border: "#e2e8e0" },
      dark: { bg: "#08140c", surface: "#102016", accent: "#2e7d58", border: "#1e3326" },
    },
  },
  {
    id: "clay",
    name: "Arcilla",
    hint: "Cálido",
    preview: {
      light: { bg: "#faf6f1", surface: "#ffffff", accent: "#b45309", border: "#ece2d8" },
      dark: { bg: "#140e0c", surface: "#221814", accent: "#c46e3a", border: "#3a2a22" },
    },
  },
  {
    id: "wine",
    name: "Vino",
    hint: "Burdeos",
    preview: {
      light: { bg: "#faf5f6", surface: "#ffffff", accent: "#881337", border: "#ece0e4" },
      dark: { bg: "#140a0e", surface: "#221218", accent: "#a63a56", border: "#3a222c" },
    },
  },
  {
    id: "copper",
    name: "Cobre",
    hint: "Óxido",
    preview: {
      light: { bg: "#faf6ee", surface: "#ffffff", accent: "#9a3412", border: "#ece2d0" },
      dark: { bg: "#120e09", surface: "#201810", accent: "#c47830", border: "#3a2e1c" },
    },
  },
  {
    id: "sea",
    name: "Mar",
    hint: "Salitre",
    preview: {
      light: { bg: "#f3f8f8", surface: "#ffffff", accent: "#0f766e", border: "#dce8e8" },
      dark: { bg: "#071214", surface: "#0e2226", accent: "#1f8a82", border: "#1c3438" },
    },
  },
  {
    id: "gold",
    name: "Dorado",
    hint: "Oro",
    preview: {
      light: { bg: "#faf6ea", surface: "#ffffff", accent: "#926210", border: "#e8dcbc" },
      dark: { bg: "#0c0a06", surface: "#18140c", accent: "#c4a024", border: "#3a3016" },
    },
  },
  {
    id: "royal",
    name: "Royal",
    hint: "Eléctrico",
    preview: {
      light: { bg: "#f4f6fc", surface: "#ffffff", accent: "#1d35c4", border: "#dce2f2" },
      dark: { bg: "#060a1c", surface: "#0c1230", accent: "#3d62e8", border: "#243058" },
    },
  },
  {
    id: "amethyst",
    name: "Amatista",
    hint: "Violeta",
    preview: {
      light: { bg: "#f8f4fa", surface: "#ffffff", accent: "#6d289c", border: "#e8def0" },
      dark: { bg: "#0e0814", surface: "#1a1228", accent: "#8a5cbc", border: "#32244a" },
    },
  },
  {
    id: "ice",
    name: "Hielo",
    hint: "Glaciar",
    preview: {
      light: { bg: "#f4f8fc", surface: "#ffffff", accent: "#0e7490", border: "#dce8f0" },
      dark: { bg: "#081018", surface: "#142030", accent: "#4a90b8", border: "#243848" },
    },
  },
];

const SKIN_SET = new Set<string>(SKIN_IDS);

export function parseSkin(value: unknown): SkinId {
  return typeof value === "string" && SKIN_SET.has(value) ? (value as SkinId) : DEFAULT_SKIN;
}
