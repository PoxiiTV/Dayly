/**
 * Backgrounds for a conversation, the way WhatsApp or Telegram let you tell
 * one chat from another.
 *
 * Gradients and inline SVG patterns, never image files: nothing to download,
 * nothing to add to the CSP (`img-src data:` already covers them), and each one
 * carries a light and a dark variant so the bubbles stay readable in both
 * themes. Mirror of `server/src/lib/chat/wallpapers.ts`.
 */
export type ChatWallpaper = {
  id: string;
  name: string;
  light: string;
  dark: string;
};

/** SVG patterns live in a data URI; this keeps the quoting readable. */
function svg(body: string, width: number, height = width): string {
  const doc = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(doc)}")`;
}

/** Fine diagonal weave: reads as texture, never as a grid of dots. */
function weave(color: string, opacity: number): string {
  return svg(
    `<path d='M0 40L40 0M-10 10L10 -10M30 50L50 30' stroke='${color}' stroke-opacity='${opacity}' stroke-width='1' fill='none'/>`,
    40,
  );
}

/** Soft contour lines, like a topographic map. */
function waves(color: string, opacity: number): string {
  return svg(
    `<path d='M0 30C20 10 40 50 60 30S100 10 120 30' stroke='${color}' stroke-opacity='${opacity}' stroke-width='1.2' fill='none'/>`
    + `<path d='M0 75C20 55 40 95 60 75S100 55 120 75' stroke='${color}' stroke-opacity='${opacity}' stroke-width='1.2' fill='none'/>`,
    120,
  );
}

/**
 * A proper honeycomb: flat-top hexagons of side 48, in a 144 x 83.14 cell that
 * tiles seamlessly. Big enough to read as a pattern instead of as noise.
 */
function hex(color: string, opacity: number): string {
  const side = 48;
  const half = Math.round(side * Math.sqrt(3) * 100) / 200; // half the height
  const stroke = `stroke='${color}' stroke-opacity='${opacity}' stroke-width='1.4' fill='none' stroke-linejoin='round'`;
  const full = `M96 ${half}L72 ${half * 2}L24 ${half * 2}L0 ${half}L24 0L72 0Z`;
  // The halves of the neighbouring column, so the comb continues across tiles.
  const top = `M72 0L96 ${half}L144 ${half}L168 0`;
  const bottom = `M72 ${half * 2}L96 ${half}L144 ${half}L168 ${half * 2}`;
  return svg(
    `<path d='${full}' ${stroke}/><path d='${top}' ${stroke}/><path d='${bottom}' ${stroke}/>`,
    144,
    half * 2,
  );
}

export const CHAT_WALLPAPERS: ChatWallpaper[] = [
  {
    id: "aurora",
    name: "Aurora",
    light: "linear-gradient(160deg, #c7d2fe 0%, #fbcfe8 55%, #a5f3fc 100%)",
    dark: "linear-gradient(160deg, #1e1b4b 0%, #3b0764 55%, #082f49 100%)",
  },
  {
    id: "sunset",
    name: "Atardecer",
    light: "linear-gradient(160deg, #fed7aa 0%, #fecdd3 60%, #fde68a 100%)",
    dark: "linear-gradient(160deg, #431407 0%, #4c0519 60%, #422006 100%)",
  },
  {
    id: "mint",
    name: "Menta",
    light: "linear-gradient(160deg, #a7f3d0 0%, #99f6e4 100%)",
    dark: "linear-gradient(160deg, #022c22 0%, #042f2e 100%)",
  },
  {
    id: "lavender",
    name: "Lavanda",
    light: "linear-gradient(160deg, #ddd6fe 0%, #f0abfc 100%)",
    dark: "linear-gradient(160deg, #2e1065 0%, #3b0764 100%)",
  },
  {
    id: "sand",
    name: "Arena",
    light: "linear-gradient(160deg, #fef08a 0%, #fed7aa 100%)",
    dark: "linear-gradient(160deg, #422006 0%, #292524 100%)",
  },
  {
    id: "ocean",
    name: "Océano",
    light: "linear-gradient(160deg, #bfdbfe 0%, #a5f3fc 100%)",
    dark: "linear-gradient(160deg, #082f49 0%, #0c4a6e 100%)",
  },
  {
    id: "graphite",
    name: "Grafito",
    light: "linear-gradient(160deg, #e2e8f0 0%, #cbd5e1 100%)",
    dark: "linear-gradient(160deg, #0f172a 0%, #1e293b 100%)",
  },
  {
    id: "dots",
    name: "Trama",
    light: `${weave("#0f172a", 0.12)}, linear-gradient(160deg, #e7edf5 0%, #d8e2ee 100%)`,
    dark: `${weave("#e2e8f0", 0.07)}, linear-gradient(160deg, #0f172a 0%, #172033 100%)`,
  },
  {
    id: "grid",
    name: "Curvas",
    light: `${waves("#0f172a", 0.13)}, linear-gradient(160deg, #e3edf8 0%, #cfe0f2 100%)`,
    dark: `${waves("#cbd5e1", 0.09)}, linear-gradient(160deg, #0b1220 0%, #142033 100%)`,
  },
  {
    id: "hex",
    name: "Panal",
    light: `${hex("#0f172a", 0.11)}, linear-gradient(160deg, #f2ece2 0%, #e6ddcd 100%)`,
    dark: `${hex("#e2e8f0", 0.07)}, linear-gradient(160deg, #14110f 0%, #1f1b17 100%)`,
  },
  {
    id: "petal",
    name: "Pétalo",
    light: "radial-gradient(60rem 30rem at 15% 0%, #fecaca 0%, transparent 62%), radial-gradient(50rem 26rem at 90% 100%, #ddd6fe 0%, transparent 58%), #fff1f2",
    dark: "radial-gradient(60rem 30rem at 15% 0%, #4c0519 0%, transparent 60%), radial-gradient(50rem 26rem at 90% 100%, #2e1065 0%, transparent 55%), #120f14",
  },
  {
    id: "slate",
    name: "Pizarra",
    light: "radial-gradient(70rem 34rem at 50% -10%, #cbd5e1 0%, transparent 68%), #eef2f6",
    dark: "radial-gradient(70rem 34rem at 50% -10%, #1e293b 0%, transparent 65%), #0b0f16",
  },
  // The same recipe as Pizarra — one soft glow over a flat base — in other
  // hues. Quiet enough to read on, and each one still tells a chat apart.
  ...glows([
    { id: "ink", name: "Tinta", light: ["#93c5fd", "#e4edfb"], dark: ["#1e3a8a", "#080d18"] },
    { id: "teal", name: "Turquesa", light: ["#5eead4", "#dcf6f4"], dark: ["#134e4a", "#06100f"] },
    { id: "moss", name: "Musgo", light: ["#86efac", "#e2f6e8"], dark: ["#14532d", "#070f0a"] },
    { id: "rose", name: "Rosa", light: ["#fda4af", "#fbe6e9"], dark: ["#881337", "#140a0e"] },
    { id: "amber", name: "Ámbar", light: ["#fcd34d", "#fbf0d9"], dark: ["#78350f", "#140e07"] },
    { id: "plum", name: "Ciruela", light: ["#d8b4fe", "#f0e6fa"], dark: ["#581c87", "#100a16"] },
    { id: "steel", name: "Acero", light: ["#a5b4fc", "#e6e9f7"], dark: ["#312e81", "#0a0a14"] },
    { id: "linen", name: "Lino", light: ["#e7e5e4", "#f3f0ec"], dark: ["#292524", "#0f0d0c"] },
  ]),
];

/** One soft halo over a flat base, the shape Pizarra is built from. */
function glows(items: { id: string; name: string; light: [string, string]; dark: [string, string] }[]): ChatWallpaper[] {
  const halo = (tint: string, base: string) =>
    `radial-gradient(70rem 34rem at 50% -10%, ${tint} 0%, transparent 65%), ${base}`;
  return items.map(({ id, name, light, dark }) => ({
    id,
    name,
    light: halo(light[0], light[1]),
    dark: halo(dark[0], dark[1]),
  }));
}

export function findChatWallpaper(id: string | null | undefined): ChatWallpaper | null {
  if (!id) return null;
  return CHAT_WALLPAPERS.find((paper) => paper.id === id) ?? null;
}

/** The dark variant only when the app is actually in dark mode. */
export function chatWallpaperBackground(paper: ChatWallpaper, dark: boolean): string {
  return dark ? paper.dark : paper.light;
}
