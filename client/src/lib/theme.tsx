import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import type { Theme } from "@/lib/types";
import { DEFAULT_SKIN, parseSkin, type SkinId } from "@/lib/skins";

interface ThemeCtx {
  theme: Theme;
  skin: SkinId;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  setSkin: (s: SkinId) => void;
  hydrate: (theme?: Theme | string | null, skin?: string | null) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE = "dayly.theme";
const SKIN_STORAGE = "dayly.skin";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readSavedTheme(): Theme {
  const s = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
  return s === "LIGHT" || s === "DARK" || s === "SYSTEM" ? s : "SYSTEM";
}

function readSavedSkin(): SkinId {
  return parseSkin(typeof localStorage !== "undefined" ? localStorage.getItem(SKIN_STORAGE) : null);
}

function syncThemeColor() {
  if (typeof document === "undefined") return;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!raw) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", `rgb(${raw.split(/\s+/).join(", ")})`);
}

function paintAppearance(t: Theme, skin: SkinId): "light" | "dark" {
  const r = t === "SYSTEM" ? resolveSystem() : (t.toLowerCase() as "light" | "dark");
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", r);
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem(STORAGE, t);
    localStorage.setItem(SKIN_STORAGE, skin);
    syncThemeColor();
  }
  return r;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readSavedTheme);
  const [skin, setSkinState] = useState<SkinId>(readSavedSkin);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    paintAppearance(readSavedTheme(), readSavedSkin()),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme !== "SYSTEM") return;
      setResolved(paintAppearance("SYSTEM", skin));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, skin]);

  const setTheme = (t: Theme) => {
    setResolved(paintAppearance(t, skin));
    setThemeState(t);
  };

  const setSkin = (s: SkinId) => {
    setResolved(paintAppearance(theme, s));
    setSkinState(s);
  };

  const hydrate = useCallback((nextTheme?: Theme | string | null, nextSkin?: string | null) => {
    const t: Theme = nextTheme === "LIGHT" || nextTheme === "DARK" || nextTheme === "SYSTEM" ? nextTheme : readSavedTheme();
    const s = parseSkin(nextSkin);
    setThemeState(t);
    setSkinState(s);
    setResolved(paintAppearance(t, s));
  }, []);

  return (
    <Ctx.Provider value={{ theme, skin, resolved, setTheme, setSkin, hydrate }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}

export function resolveTheme(t: Theme): "light" | "dark" {
  if (t === "SYSTEM") return resolveSystem();
  return t.toLowerCase() as "light" | "dark";
}

type WaveEvent = {
  clientX?: number;
  clientY?: number;
  currentTarget?: EventTarget | null;
};

let waving = false;

function clickPoint(e?: WaveEvent) {
  if (typeof e?.clientX === "number" && typeof e?.clientY === "number") {
    return { x: e.clientX, y: e.clientY };
  }
  if (e?.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 28, y: 28 };
}

function currentBgRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (raw) return `rgb(${raw.split(/\s+/).join(", ")})`;
  return "rgb(11, 18, 32)";
}

function runWave(apply: () => void, e?: WaveEvent) {
  const { x, y } = clickPoint(e);
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  const oldColor = currentBgRgb();
  const size = Math.ceil(radius) * 2 + 8;

  waving = true;
  const cover = document.createElement("div");
  cover.className = "dayly-theme-wave";
  const hole = document.createElement("div");
  hole.className = "dayly-theme-wave-hole";
  hole.style.left = `${x}px`;
  hole.style.top = `${y}px`;
  hole.style.boxShadow = `0 0 0 200vmax ${oldColor}`;
  cover.appendChild(hole);
  document.documentElement.appendChild(cover);
  cover.getBoundingClientRect();
  apply();

  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    cover.remove();
    waving = false;
  };

  const anim = hole.animate(
    [
      { width: "0px", height: "0px", marginLeft: "0px", marginTop: "0px" },
      {
        width: `${size}px`,
        height: `${size}px`,
        marginLeft: `${-size / 2}px`,
        marginTop: `${-size / 2}px`,
      },
    ],
    { duration: 1100, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
  );
  anim.onfinish = end;
  void anim.finished.then(end).catch(end);
  window.setTimeout(end, 1400);
}

/**
 * Apply the new theme first (real UI underneath), then an overlay of the OLD
 * color with a growing transparent hole — so buttons stay visible inside the wave.
 */
export function useThemeWave() {
  const { setTheme, setSkin, theme, skin, resolved } = useTheme();
  return (next: Theme, e?: WaveEvent) => {
    if (next === theme || waving) return;
    if (resolveTheme(next) === resolved) {
      setTheme(next);
      return;
    }
    runWave(() => setTheme(next), e);
  };
}

export function useSkinWave() {
  const { setSkin, skin } = useTheme();
  return (next: SkinId, e?: WaveEvent) => {
    if (next === skin || waving) return;
    runWave(() => setSkin(next), e);
  };
}
