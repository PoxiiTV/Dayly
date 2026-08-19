import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Theme } from "@/lib/types";

interface ThemeCtx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE = "dayly.theme";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readSaved(): Theme {
  const s = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
  return s === "LIGHT" || s === "DARK" || s === "SYSTEM" ? s : "SYSTEM";
}

function paintTheme(t: Theme): "light" | "dark" {
  const r = t === "SYSTEM" ? resolveSystem() : (t.toLowerCase() as "light" | "dark");
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", r);
    localStorage.setItem(STORAGE, t);
  }
  return r;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readSaved);
  const [resolved, setResolved] = useState<"light" | "dark">(() => paintTheme(readSaved()));

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme !== "SYSTEM") return;
      setResolved(paintTheme("SYSTEM"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setResolved(paintTheme(t));
    setThemeState(t);
  };

  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>;
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

function themeRgb(which: "light" | "dark") {
  return which === "dark" ? "rgb(11, 18, 32)" : "rgb(248, 248, 246)";
}

/**
 * Apply the new theme first (real UI underneath), then an overlay of the OLD
 * color with a growing transparent hole — so buttons stay visible inside the wave.
 */
export function useThemeWave() {
  const { setTheme, theme, resolved } = useTheme();
  return (next: Theme, e?: WaveEvent) => {
    if (next === theme || waving) return;
    if (resolveTheme(next) === resolved) {
      setTheme(next);
      return;
    }

    const { x, y } = clickPoint(e);
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const oldColor = themeRgb(resolved);
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
    setTheme(next);

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
  };
}
