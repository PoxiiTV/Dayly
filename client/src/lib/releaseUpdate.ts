import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@brand";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";

export interface ReleaseUpdateState {
  availableVersion: string | null;
  updating: boolean;
  onUpdate: () => void;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
    return match ? match.slice(1).map(Number) : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

/**
 * Reload the application shell without touching user preferences, sessions or
 * the dedicated Web Push worker. A unique navigation URL plus empty app caches
 * gives the same practical result as a browser hard refresh.
 */
export async function hardRefreshToRelease(version: string): Promise<void> {
  if (typeof window === "undefined") return;

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations
        .filter((registration) => !new URL(registration.scope).pathname.endsWith("/push-sw/"))
        .map((registration) => registration.unregister()));
    } catch {
      // A cache-busted navigation still gives the browser a network fallback.
    }
  }

  if ("caches" in window) {
    try {
      const names = await window.caches.keys();
      await Promise.allSettled(names.map((name) => window.caches.delete(name)));
    } catch {
      // Cache Storage is optional and can be unavailable in private browsing.
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("dayly-version", version);
  url.searchParams.set("dayly-refresh", String(Date.now()));
  window.location.replace(url.toString());
}

export function useReleaseUpdate(): ReleaseUpdateState {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (IS_DEMO || checking.current) return;
    checking.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`/api/health?client=${encodeURIComponent(APP_VERSION)}&_ts=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = await response.json() as { version?: unknown };
      const serverVersion = typeof payload.version === "string" ? payload.version : null;
      setAvailableVersion(serverVersion && compareVersions(serverVersion, APP_VERSION) > 0 ? serverVersion : null);
    } catch {
      // Release checks are best-effort and must not affect normal app use.
    } finally {
      window.clearTimeout(timeout);
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onFocus = () => void check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  const onUpdate = useCallback(() => {
    if (!availableVersion || updating) return;
    setUpdating(true);
    void hardRefreshToRelease(availableVersion).catch(() => setUpdating(false));
  }, [availableVersion, updating]);

  return { availableVersion, updating, onUpdate };
}
