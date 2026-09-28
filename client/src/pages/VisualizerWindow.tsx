import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { Visualizer, type VisualizerHandle } from "@/components/Visualizer";
import { closeNativeVisualizerWindow } from "@/lib/nativeShell";

/**
 * Full-screen visualizer, meant for the wrapper's second window: drag it to
 * another monitor and it keeps painting whatever the machine is playing.
 *
 * The way out never depends on the canvas working: the close button and Escape
 * go straight to the wrapper, so a broken render can still be dismissed.
 */
export function VisualizerWindow() {
  const [handle, setHandle] = useState<VisualizerHandle | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const close = useCallback(() => {
    void closeNativeVisualizerWindow().catch(() => window.close());
  }, []);

  // The chrome only hides once everything is actually working.
  const canHideChrome = handle?.status === "running";

  useEffect(() => {
    if (!chromeVisible || !canHideChrome) return;
    const timer = window.setTimeout(() => setChromeVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [chromeVisible, canHideChrome, handle?.presetName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        handle?.next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle, close]);

  const message = handle?.status === "starting" ? "Preparando el visualizador…" : handle?.error ?? null;

  return (
    <div className="fixed inset-0 bg-black text-white" onMouseMove={() => setChromeVisible(true)}>
      <Visualizer onHandle={setHandle} onCloseRequest={close} />

      <button
        type="button"
        onClick={close}
        aria-label="Cerrar el visualizador"
        title="Cerrar (Esc)"
        className={clsx(
          "absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full",
          "bg-black/60 text-white/80 transition hover:bg-black/80 hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
          chromeVisible ? "opacity-100" : "opacity-0 hover:opacity-100",
        )}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      {message && (
        <div
          role={handle?.status === "error" || handle?.status === "silent" ? "alert" : "status"}
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center"
        >
          <p className="mx-auto max-w-md text-sm text-white/80 drop-shadow">{message}</p>
        </div>
      )}

      <div
        aria-hidden={!chromeVisible}
        className={clsx(
          "pointer-events-none absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4",
          "bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-10 transition-opacity duration-500",
          chromeVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="truncate text-xs text-white/70">{handle?.presetName ?? ""}</p>
        <p className="shrink-0 text-[11px] text-white/40">Espacio: otro efecto · Esc: cerrar</p>
      </div>
    </div>
  );
}
