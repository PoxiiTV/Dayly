import type { CSSProperties } from "react";
import type { Tag } from "./types";
import { DEFAULT_ENTITY_COLOR } from "./projects";

type RGB = { r: number; g: number; b: number };

const WHITE = "#ffffff";
const DARK = "#18181b";
const BLACK = "#000000";
const CONTRAST_TARGET = 4.5;

function parseHex(value: string | null | undefined): RGB | null {
  if (!value) return null;
  const raw = value.trim();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw)) return null;
  const hex = raw.length === 4
    ? raw.slice(1).split("").map((part) => part + part).join("")
    : raw.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function normalizeHex(value: string | null | undefined): string | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  return `#${[rgb.r, rgb.g, rgb.b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: RGB): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function contrastRatio(first: RGB, second: RGB): number {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function mixHex(first: string, second: string, amount: number): string {
  const a = parseHex(first)!;
  const b = parseHex(second)!;
  const channel = (from: number, to: number) => Math.round(from + (to - from) * amount);
  return `#${[channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

function ensureContrast(background: string, foreground: string): string {
  const foregroundRgb = parseHex(foreground)!;
  const initial = parseHex(background)!;
  if (contrastRatio(initial, foregroundRgb) >= CONTRAST_TARGET) return background;

  // Move the stop towards the opposite extreme until the text has AA contrast.
  const target = foreground === WHITE ? BLACK : WHITE;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    const candidate = parseHex(mixHex(background, target, middle))!;
    if (contrastRatio(candidate, foregroundRgb) >= CONTRAST_TARGET) high = middle;
    else low = middle;
  }
  return mixHex(background, target, high);
}

function chooseForeground(colors: string[]): string {
  const whiteMin = Math.min(...colors.map((color) => contrastRatio(parseHex(color)!, parseHex(WHITE)!)));
  const darkMin = Math.min(...colors.map((color) => contrastRatio(parseHex(color)!, parseHex(DARK)!)));
  return whiteMin >= darkMin ? WHITE : DARK;
}

/** Returns only safe, unique hex colors defined by the item's tags. */
export function getCalendarTagColors(tags?: Tag[]): string[] {
  return Array.from(new Set((tags ?? [])
    .map((tag) => normalizeHex(tag.color))
    .filter((color): color is string => Boolean(color))));
}

export function hasTagColors(tags?: Tag[]): boolean {
  return getCalendarTagColors(tags).length > 0;
}

/**
 * Creates the visual treatment for a calendar item. Tag colors are adjusted
 * only as much as needed to keep normal text at least 4.5:1 against every
 * gradient stop. Items without coloured tags retain their own color.
 */
export function calendarItemStyle(tags: Tag[] | undefined, fallback?: string | null): CSSProperties {
  const colors = getCalendarTagColors(tags);
  const source = colors.length > 0 ? colors : [normalizeHex(fallback) ?? DEFAULT_ENTITY_COLOR];
  const foreground = chooseForeground(source);
  const accessible = source.map((color) => ensureContrast(color, foreground));
  const background = accessible.length === 1
    ? accessible[0]
    : `linear-gradient(110deg, ${accessible.map((color, index) => `${color} ${Math.round(index * 100 / (accessible.length - 1))}%`).join(", ")})`;

  return { background, color: foreground };
}
