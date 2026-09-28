import { useEffect, useState, useSyncExternalStore } from "react";

const STORAGE = "dayly.urgentPulse";
const EVENT = "dayly:urgent-pulse";
export const URGENT_PULSE_WINDOW_MS = 2 * 60 * 60 * 1000;

function readPref(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE) === "on";
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

/** Appearance setting «Avisar de urgentes que vencen pronto» (off unless turned on). */
export function useUrgentPulsePref(): boolean {
  return useSyncExternalStore(subscribe, readPref, () => false);
}

export function setUrgentPulsePref(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE, "on");
    else localStorage.removeItem(STORAGE);
  } catch {
    // Restricted storage keeps the current session value only.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Urgent, still open and due within the next two hours (not already late). */
export function isUrgentSoon(
  task: { priority: string; status: string; completedAt?: string | null },
  deadlineMs: number | null,
  now: number,
): boolean {
  if (task.priority !== "URGENT" || task.status === "COMPLETED" || task.status === "CANCELLED" || task.completedAt) return false;
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return false;
  const left = deadlineMs - now;
  return left >= 0 && left <= URGENT_PULSE_WINDOW_MS;
}

/** Current time, refreshed every minute while `active`, so the frame turns on and off by itself. */
export function useMinuteNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
