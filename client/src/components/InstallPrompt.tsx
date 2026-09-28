import { useCallback, useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/icons";
import { APP_NAME } from "@brand";
import { Button } from "@/components/ui";

const DISMISS_KEY = "dayly.install.dismissed";
const DISMISS_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore quota */
  }
}

/** Suggests installing Dayly as a PWA (Chrome prompt or iOS instructions). */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"native" | "ios">("native");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (import.meta.env.VITE_APP_DEMO === "1") return;
    if (isStandalone() || isDismissedRecently()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("native");
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    if (isIosSafari() && !isStandalone()) {
      setMode("ios");
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = useCallback(() => {
    rememberDismiss();
    setVisible(false);
    setDeferred(null);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setVisible(false);
        setDeferred(null);
        return;
      }
      dismiss();
    } catch {
      dismiss();
    } finally {
      setBusy(false);
    }
  }, [deferred, dismiss]);

  if (!visible) return null;

  return (
    <div
      className={clsx(
        "fixed z-[85] left-4 right-4 md:left-auto md:right-5 md:w-[min(24rem,calc(100vw-2rem))]",
        "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-5",
      )}
      role="region"
      aria-label="Instalar aplicación"
    >
      <div className="card flex items-start gap-3 px-4 py-3 shadow-pop animate-slide-up border border-border/80">
        <BrandLogo className="w-10 h-10 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">Instalar {APP_NAME}</p>
          {mode === "native" ? (
            <p className="text-xs text-muted mt-0.5">Ábrela a pantalla completa, como una app, desde tu escritorio o inicio.</p>
          ) : (
            <p className="text-xs text-muted mt-0.5 flex items-start gap-1.5">
              <Share className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Pulsa Compartir y elige «Añadir a pantalla de inicio» para usarla a pantalla completa.
            </p>
          )}
          {mode === "native" && (
            <Button type="button" className="mt-3 w-full" disabled={busy || !deferred} onClick={() => void install()}>
              <Download className="w-4 h-4" />
              {busy ? "Instalando…" : "Instalar"}
            </Button>
          )}
        </div>
        <button type="button" onClick={dismiss} className="text-faint hover:text-text shrink-0" aria-label="Cerrar">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
