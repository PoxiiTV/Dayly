import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { App } from "./App";
import { ToastProvider } from "@/components/ui";
import { ThemeProvider } from "@/lib/theme";
import { ContentWidthProvider } from "@/lib/contentWidth";
// Side effect: stamps the saved chat shape before the first render.
import "@/lib/chatLayout";
// Side effect: applies the saved background intensity before the first paint.
import "@/lib/backgroundVisibility";
import { AuthProvider } from "@/lib/auth";
import { APP_VERSION } from "@brand";
import { hardRefreshToRelease } from "@/lib/releaseUpdate";

const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";
const Router = IS_DEMO ? HashRouter : BrowserRouter;

async function ensureFreshRelease(): Promise<boolean> {
  if (IS_DEMO || typeof window === "undefined") return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`/api/health?client=${encodeURIComponent(APP_VERSION)}&_ts=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json() as { version?: unknown };
    if (typeof payload.version !== "string" || payload.version === APP_VERSION) {
      sessionStorage.removeItem(`dayly.release-refresh.${APP_VERSION}`);
      sessionStorage.removeItem("dayly.release-reload");
      return false;
    }

    const attemptKey = `dayly.release-refresh.${payload.version}`;
    const attempts = Number(sessionStorage.getItem(attemptKey) ?? "0");
    if (attempts >= 2) return false;
    sessionStorage.setItem(attemptKey, String(attempts + 1));
    await hardRefreshToRelease(payload.version);
    return true;
  } catch {
    // Offline/API-unavailable starts should keep working with the current shell.
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

function clearReleaseRefreshQuery(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("dayly-version") && !url.searchParams.has("dayly-refresh")) return;
  url.searchParams.delete("dayly-version");
  url.searchParams.delete("dayly-refresh");
  window.history.replaceState(window.history.state, "", url.toString());
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

async function bootstrap(): Promise<void> {
  if (await ensureFreshRelease()) return;
  clearReleaseRefreshQuery();

  if (IS_DEMO && "serviceWorker" in navigator) {
    void navigator.serviceWorker.getRegistrations().then((regs) =>
      regs.forEach((registration) => registration.unregister()),
    );
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router>
          <ThemeProvider>
            <ContentWidthProvider>
              <ToastProvider>
                <AuthProvider>
                  <App />
                </AuthProvider>
              </ToastProvider>
            </ContentWidthProvider>
          </ThemeProvider>
        </Router>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
