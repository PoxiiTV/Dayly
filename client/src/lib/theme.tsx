import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import type { Theme } from "@/lib/types";
import { DEFAULT_SKIN, parseSkin, type SkinId } from "@/lib/skins";
import { paintWallpaper, parseWallpaper, WALLPAPER_STORAGE } from "@/lib/wallpapers";
import {
  DEFAULT_DARK_END_MIN,
  DEFAULT_DARK_START_MIN,
  clampMinuteOfDay,
  isDarkDuringSchedule,
  minutesInTimeZone,
  msUntilScheduleBoundary,
} from "@/lib/themeSchedule";

export type ThemeSchedule = {
  enabled: boolean;
  startMin: number;
  endMin: number;
};

interface ThemeCtx {
  theme: Theme;
  skin: SkinId;
  resolved: "light" | "dark";
  schedule: ThemeSchedule;
  timezone: string;
  setTheme: (t: Theme) => void;
  setSkin: (s: SkinId) => void;
  setSchedule: (next: ThemeSchedule) => void;
  hydrate: (theme?: Theme | string | null, skin?: string | null, schedule?: Partial<ThemeSchedule> | null, timezone?: string | null) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE = "dayly.theme";
const SKIN_STORAGE = "dayly.skin";
const SCHEDULE_STORAGE = "dayly.themeSchedule";
const TZ_STORAGE = "dayly.themeTz";

const DEFAULT_SCHEDULE: ThemeSchedule = {
  enabled: false,
  startMin: DEFAULT_DARK_START_MIN,
  endMin: DEFAULT_DARK_END_MIN,
};

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseTheme(value: unknown): Theme | null {
  return value === "LIGHT" || value === "DARK" || value === "SYSTEM" ? value : null;
}

function readSavedTheme(): Theme {
  const s = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
  return parseTheme(s) ?? "LIGHT";
}

function readSavedSkin(): SkinId {
  return parseSkin(typeof localStorage !== "undefined" ? localStorage.getItem(SKIN_STORAGE) : null);
}

function readSavedTimezone(): string {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(TZ_STORAGE) : null;
  if (saved) return saved;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  } catch {
    return "Europe/Madrid";
  }
}

function readSavedSchedule(): ThemeSchedule {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SCHEDULE_STORAGE) : null;
    if (!raw) return DEFAULT_SCHEDULE;
    const parsed = JSON.parse(raw) as Partial<ThemeSchedule>;
    return {
      enabled: parsed.enabled === true,
      startMin: clampMinuteOfDay(parsed.startMin, DEFAULT_DARK_START_MIN),
      endMin: clampMinuteOfDay(parsed.endMin, DEFAULT_DARK_END_MIN),
    };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

function persistSchedule(schedule: ThemeSchedule) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SCHEDULE_STORAGE, JSON.stringify(schedule));
}

function syncThemeColor() {
  if (typeof document === "undefined") return;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!raw) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", `rgb(${raw.split(/\s+/).join(", ")})`);
}

function resolveAppearance(t: Theme, schedule: ThemeSchedule, timezone: string): "light" | "dark" {
  if (schedule.enabled) {
    return isDarkDuringSchedule(minutesInTimeZone(timezone), schedule.startMin, schedule.endMin) ? "dark" : "light";
  }
  if (t === "SYSTEM") return resolveSystem();
  if (t === "LIGHT") return "light";
  if (t === "DARK") return "dark";
  const _never: never = t;
  return _never;
}

function paintAppearance(t: Theme, skin: SkinId, schedule: ThemeSchedule, timezone: string): "light" | "dark" {
  const r = resolveAppearance(t, schedule, timezone);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", r);
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem(STORAGE, t);
    localStorage.setItem(SKIN_STORAGE, skin);
    localStorage.setItem(TZ_STORAGE, timezone);
    persistSchedule(schedule);
    paintWallpaper(parseWallpaper(localStorage.getItem(WALLPAPER_STORAGE)));
    syncThemeColor();
  }
  return r;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readSavedTheme);
  const [skin, setSkinState] = useState<SkinId>(readSavedSkin);
  const [schedule, setScheduleState] = useState<ThemeSchedule>(readSavedSchedule);
  const [timezone, setTimezoneState] = useState<string>(readSavedTimezone);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    paintAppearance(readSavedTheme(), readSavedSkin(), readSavedSchedule(), readSavedTimezone()),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme !== "SYSTEM" || schedule.enabled) return;
      setResolved(paintAppearance("SYSTEM", skin, schedule, timezone));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, skin, schedule, timezone]);

  useEffect(() => {
    if (!schedule.enabled) return;
    let timer = 0;
    const arm = () => {
      setResolved(paintAppearance(theme, skin, schedule, timezone));
      const wait = Math.min(msUntilScheduleBoundary(schedule.startMin, schedule.endMin, timezone), 60 * 60 * 1000);
      timer = window.setTimeout(arm, Math.max(wait, 1000));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [schedule, theme, skin, timezone]);

  const setTheme = (t: Theme) => {
    const nextSchedule = { ...schedule, enabled: false };
    setScheduleState(nextSchedule);
    setResolved(paintAppearance(t, skin, nextSchedule, timezone));
    setThemeState(t);
  };

  const setSkin = (s: SkinId) => {
    setResolved(paintAppearance(theme, s, schedule, timezone));
    setSkinState(s);
  };

  const setSchedule = (next: ThemeSchedule) => {
    const normalized: ThemeSchedule = {
      enabled: next.enabled,
      startMin: clampMinuteOfDay(next.startMin, DEFAULT_DARK_START_MIN),
      endMin: clampMinuteOfDay(next.endMin, DEFAULT_DARK_END_MIN),
    };
    setScheduleState(normalized);
    setResolved(paintAppearance(theme, skin, normalized, timezone));
  };

  const hydrate = useCallback((nextTheme?: Theme | string | null, nextSkin?: string | null, nextSchedule?: Partial<ThemeSchedule> | null, nextTimezone?: string | null) => {
    const t = parseTheme(nextTheme) ?? readSavedTheme();
    const s = parseSkin(nextSkin);
    const sched: ThemeSchedule = {
      enabled: nextSchedule?.enabled === true,
      startMin: clampMinuteOfDay(nextSchedule?.startMin, readSavedSchedule().startMin),
      endMin: clampMinuteOfDay(nextSchedule?.endMin, readSavedSchedule().endMin),
    };
    const tz = nextTimezone?.trim() || readSavedTimezone();
    setThemeState(t);
    setSkinState(s);
    setScheduleState(sched);
    setTimezoneState(tz);
    setResolved(paintAppearance(t, s, sched, tz));
  }, []);

  return (
    <Ctx.Provider value={{ theme, skin, resolved, schedule, timezone, setTheme, setSkin, setSchedule, hydrate }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}

export function resolveTheme(t: Theme, schedule?: ThemeSchedule, timezone = "Europe/Madrid"): "light" | "dark" {
  return resolveAppearance(t, schedule ?? DEFAULT_SCHEDULE, timezone);
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
  return "rgb(248, 248, 246)";
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
  // Every card, row and badge animates its colours on a theme change. With a
  // long list on screen that is thousands of simultaneous transitions on top
  // of the wave; suppressing them for the swap keeps the effect and drops the
  // stutter. Removing the class later cannot restart a transition that never
  // began, so two frames are enough.
  document.documentElement.classList.add("dayly-theme-swap");
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
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove("dayly-theme-swap");
  }));

  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    cover.remove();
    document.documentElement.classList.remove("dayly-theme-swap");
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
  const { setTheme, theme, schedule, resolved } = useTheme();
  return (next: Theme, e?: WaveEvent) => {
    if ((next === theme && !schedule.enabled) || waving) return;
    if (resolveTheme(next) === resolved) {
      setTheme(next);
      return;
    }
    runWave(() => setTheme(next), e);
  };
}

export function useScheduleWave() {
  const { setSchedule, schedule, resolved, timezone } = useTheme();
  return (next: ThemeSchedule, e?: WaveEvent) => {
    if (waving) return;
    const same =
      next.enabled === schedule.enabled &&
      next.startMin === schedule.startMin &&
      next.endMin === schedule.endMin;
    if (same) return;
    const nextResolved = resolveAppearance("LIGHT", next, timezone);
    if (nextResolved === resolved) {
      setSchedule(next);
      return;
    }
    runWave(() => setSchedule(next), e);
  };
}

export function useSkinWave() {
  const { setSkin, skin } = useTheme();
  return (next: SkinId, e?: WaveEvent) => {
    if (next === skin || waving) return;
    runWave(() => setSkin(next), e);
  };
}
