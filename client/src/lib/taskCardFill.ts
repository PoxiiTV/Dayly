import { useSyncExternalStore, type CSSProperties } from "react";

/** Per-task override stored in `Task.cardFill`; null follows the appearance setting. */
export type TaskCardFill = "none" | "project" | `#${string}`;

const STORAGE = "dayly.taskCardFill";
const EVENT = "dayly:task-card-fill";
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isTaskCardFill(value: unknown): value is TaskCardFill {
  return value === "none" || value === "project" || (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value));
}

function readPaintByProject(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE) === "project";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPaintCardsByProject(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE, "project");
    else localStorage.removeItem(STORAGE);
  } catch {
    // Restricted storage keeps the current session value only.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Appearance setting: paint every board card with its project colour. */
export function usePaintCardsByProject(): boolean {
  return useSyncExternalStore(subscribe, readPaintByProject, () => false);
}

/** Background colour for a board card, or null when it stays unpainted. */
export function resolveTaskCardFill(
  cardFill: string | null | undefined,
  projectColor: string | null | undefined,
  paintByProject: boolean,
): string | null {
  const mode = isTaskCardFill(cardFill) ? cardFill : null;
  if (mode === "none") return null;
  const color = mode === "project" || (mode === null && paintByProject) ? projectColor : mode;
  return color && HEX.test(color) ? color : null;
}

export type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  if (!HEX.test(hex)) return null;
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((v, i) => Math.round(v + (to[i] - v) * amount)) as Rgb;
}

const triplet = (rgb: Rgb) => rgb.join(" ");
const LIGHT_INK: Rgb = [255, 255, 255];
const DARK_INK: Rgb = [17, 17, 17];

/** Softest tint of the ink that still keeps `minContrast` on the background. */
function readableTint(ink: Rgb, background: Rgb, amount: number, minContrast: number): Rgb {
  const tinted = mix(ink, background, amount);
  return contrastRatio(tinted, background) >= minContrast ? tinted : ink;
}

const MIN_TEXT_CONTRAST = 4.5;

/**
 * Theme tokens for a painted card: the ink with the best contrast becomes the
 * text, and every accent colour collapses onto it so nothing can blend in.
 * Mid-tones where neither ink reaches AA get the fill nudged away from the ink
 * just enough to pass, so the card keeps its colour but stays legible.
 */
export function taskCardInk(fill: string): { ink: Rgb; background: string; vars: Record<string, string> } | null {
  const parsed = parseHex(fill);
  if (!parsed) return null;
  const ink = contrastRatio(LIGHT_INK, parsed) >= contrastRatio(DARK_INK, parsed) ? LIGHT_INK : DARK_INK;
  const away: Rgb = ink === LIGHT_INK ? [0, 0, 0] : [255, 255, 255];
  let background = parsed;
  for (let step = 1; step <= 20 && contrastRatio(ink, background) < MIN_TEXT_CONTRAST; step += 1) {
    background = mix(parsed, away, step * 0.05);
  }
  const text = triplet(ink);
  return {
    ink,
    background: `rgb(${background.join(" ")})`,
    vars: {
      "--surface": triplet(background),
      "--text": text,
      "--muted": triplet(readableTint(ink, background, 0.15, MIN_TEXT_CONTRAST)),
      "--faint": triplet(readableTint(ink, background, 0.25, MIN_TEXT_CONTRAST)),
      "--border": triplet(mix(ink, background, 0.7)),
      "--accent": text,
      "--accent-strong": text,
      "--danger": text,
      "--warn": text,
    },
  };
}

export function taskCardFillStyle(fill: string | null): CSSProperties | undefined {
  if (!fill) return undefined;
  const ink = taskCardInk(fill);
  if (!ink) return undefined;
  return { ...ink.vars, background: ink.background, color: "rgb(var(--text))" } as CSSProperties;
}
