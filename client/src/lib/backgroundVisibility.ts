import { useSyncExternalStore } from "react";

/** How visible the app background is, 0–100. 70 reproduces the original look. */
export const BACKGROUND_VISIBILITY_DEFAULT = 70;

const STORAGE = "dayly.backgroundVisibility";
const EVENT = "dayly:background-visibility";

export function parseBackgroundVisibility(raw: string | null | undefined): number {
  const value = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(value)) return BACKGROUND_VISIBILITY_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Below the default the whole background fades into the plain theme colour
 * (photo or solid tint alike); above it the photo's readability veil thins
 * out, down to 40 % of its normal strength at 100.
 */
export function backgroundVisibilityVars(value: number): { fade: number; veil: number } {
  const v = Math.min(100, Math.max(0, value));
  const d = BACKGROUND_VISIBILITY_DEFAULT;
  const fade = Math.min(1, v / d);
  const veil = v <= d ? 1 : 1 - ((v - d) / (100 - d)) * 0.6;
  return { fade: Number(fade.toFixed(3)), veil: Number(veil.toFixed(3)) };
}

function readSaved(): number {
  try {
    return typeof localStorage === "undefined" ? BACKGROUND_VISIBILITY_DEFAULT : parseBackgroundVisibility(localStorage.getItem(STORAGE));
  } catch {
    return BACKGROUND_VISIBILITY_DEFAULT;
  }
}

function paint(value: number) {
  if (typeof document === "undefined") return;
  const { fade, veil } = backgroundVisibilityVars(value);
  const root = document.documentElement.style;
  root.setProperty("--bg-fade", String(fade));
  root.setProperty("--bg-veil", String(veil));
}

paint(readSaved());

export function setBackgroundVisibility(value: number): void {
  const next = parseBackgroundVisibility(String(value));
  try {
    localStorage.setItem(STORAGE, String(next));
  } catch {
    // Restricted storage still applies the value for this session.
  }
  paint(next);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE) return;
    paint(readSaved());
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useBackgroundVisibility(): number {
  return useSyncExternalStore(subscribe, readSaved, () => BACKGROUND_VISIBILITY_DEFAULT);
}
