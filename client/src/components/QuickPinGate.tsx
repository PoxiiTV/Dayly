import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Button, Input, Spinner, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ApiError, http } from "@/lib/api";
import { hideNativeBrowser } from "@/lib/nativeShell";
import { isParkedInTray, watchTrayState } from "@/lib/trayState";

function needsQuickPin(user: ReturnType<typeof useAuth>["user"]): boolean {
  return Boolean(user?.quickPinEnabled && user.quickPinConfigured);
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )];
}

export function QuickPinGate({ children, onLockedChange }: { children: ReactNode; onLockedChange?: (locked: boolean) => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { push } = useToast();
  const [locked, setLocked] = useState(() => needsQuickPin(user));
  const [trayParked, setTrayParked] = useState(isParkedInTray);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousTray = useRef(isParkedInTray());
  const previousUser = useRef(user ? { id: user.id, locked: needsQuickPin(user) } : null);

  useEffect(() => {
    onLockedChange?.(locked);
  }, [locked, onLockedChange]);

  const lock = useCallback(() => {
    setPin("");
    setError("");
    setLocked(true);
    void hideNativeBrowser();
  }, []);

  const focusPin = useCallback(() => {
    const input = dialogRef.current?.querySelector<HTMLInputElement>("input");
    if (!input) return false;
    input.focus({ preventScroll: true });
    return document.activeElement === input;
  }, []);

  useEffect(() => watchTrayState(setTrayParked), []);

  useEffect(() => {
    if (!user) {
      previousUser.current = null;
      setLocked(false);
      return;
    }
    const shouldLock = needsQuickPin(user);
    if (!previousUser.current || previousUser.current.id !== user.id) setLocked(shouldLock);
    else if (!shouldLock) setLocked(false);
    previousUser.current = { id: user.id, locked: shouldLock };
  }, [user?.id, user?.quickPinEnabled, user?.quickPinConfigured]);

  useEffect(() => {
    if (previousTray.current && !trayParked && needsQuickPin(user)) lock();
    previousTray.current = trayParked;
  }, [lock, trayParked, user?.id, user?.quickPinEnabled, user?.quickPinConfigured]);

  useEffect(() => {
    if (!locked) return;
    void hideNativeBrowser();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let frame = 0;
    const retryTimers: number[] = [];
    const clearScheduledFocus = () => {
      cancelAnimationFrame(frame);
      retryTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
    };
    const scheduleFocus = () => {
      clearScheduledFocus();
      frame = requestAnimationFrame(() => {
        focusPin();
        // Native show/set_focus and the WebView focus event are not always
        // settled in the same frame when returning from Ctrl+Space.
        [50, 180, 500, 900].forEach((delay) => {
          retryTimers.push(window.setTimeout(() => { focusPin(); }, delay));
        });
      });
    };
    scheduleFocus();
    const onWindowFocus = () => scheduleFocus();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleFocus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (items.length === 0) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) scheduleFocus();
    };
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      clearScheduledFocus();
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [focusPin, locked]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pin.length !== 4) {
      setError("Escribe los 4 dígitos del PIN.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/quick-pin/verify", { pin });
      setPin("");
      setLocked(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "No se pudo comprobar el PIN.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
      navigate("/login");
    } catch {
      push("error", "No se pudo cerrar la sesión.");
    }
  };

  return (
    <>
      <div aria-hidden={locked || undefined}>{children}</div>
      {locked && user && (
        <div data-quick-pin-lock className="fixed inset-0 z-[120] flex min-h-full items-center justify-center overflow-y-auto bg-bg/95 px-4 py-8 backdrop-blur-sm">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="quick-pin-title" aria-describedby="quick-pin-description" className="card w-full max-w-sm p-6 shadow-pop">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-strong">
                <ShieldCheck className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 id="quick-pin-title" className="text-xl font-bold text-text">PIN rápido</h1>
              <p id="quick-pin-description" className="mt-2 text-sm leading-relaxed text-muted">
                Introduce tu PIN para continuar en Kalendiario.
              </p>
            </div>
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              <Input
                label="PIN de 4 dígitos"
                type="password"
                value={pin}
                onChange={(event) => { setPin(event.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                autoComplete="one-time-code"
                placeholder="••••"
                error={error}
                autoFocus
              />
              <Button type="submit" className="min-h-11 w-full" disabled={busy || pin.length !== 4}>
                {busy ? <Spinner /> : <><KeyRound className="h-4 w-4" aria-hidden="true" />Desbloquear</>}
              </Button>
            </form>
            <Button type="button" variant="ghost" className="mt-3 min-h-11 w-full" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />Cerrar sesión
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
