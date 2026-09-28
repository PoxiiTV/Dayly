import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Visualizer } from "@/components/Visualizer";
import { isNativeShell, supportsAudioCapture } from "@/lib/nativeShell";

const STORAGE_KEY = "dayly.visualizer.background";
const CHANGE_EVENT = "dayly:visualizer-background";

/** Per-device, not per-account: only the Windows wrapper can capture audio. */
export function isVisualizerBackgroundOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVisualizerBackground(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* A locked-down browser just keeps it off. */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useVisualizerBackground(): boolean {
  const [on, setOn] = useState(isVisualizerBackgroundOn);
  useEffect(() => {
    const sync = () => setOn(isVisualizerBackgroundOn());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

/** True where the visualizer can actually run: the wrapper, shell 1.0.6 or newer. */
export function canUseVisualizer(): boolean {
  return isNativeShell() && supportsAudioCapture();
}

/**
 * Paints the visualizer behind the whole app. It has to be a portal on
 * `document.body`: `#root` opens a stacking context at `z-index: 1`, so
 * nothing rendered inside it can sit under the interface.
 */
export function VisualizerBackground() {
  const on = useVisualizerBackground();
  if (!on || !canUseVisualizer() || typeof document === "undefined") return null;
  return createPortal(
    <div className="visualizer-backdrop" aria-hidden="true">
      <Visualizer />
    </div>,
    document.body,
  );
}
