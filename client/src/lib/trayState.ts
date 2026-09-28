import { listenNativeEvent } from "@/lib/nativeShell";

/** Emitted by the shell when the window is parked in the tray, or comes back. */
const TRAY_STATE_EVENT = "dayly-tray-state";

let parked = false;
type TrayListener = (parked: boolean) => void;
const listeners = new Set<TrayListener>();
let watcherCount = 0;
let nativeStop: (() => void) | null = null;
let startupToken = 0;

/**
 * True while the window lives next to the clock.
 *
 * Parked means the visual app stays out of the way. Task alerts are handled by
 * AlertEngine through the system channel while the shell is hidden; chat and
 * other visual nudges remain quiet until the window comes back.
 */
export function isParkedInTray(): boolean {
  return parked;
}

/** Starts following the shell's tray state. Returns the unsubscribe. */
export function watchTrayState(onChange?: TrayListener): () => void {
  let active = true;
  watcherCount += 1;
  if (onChange) {
    listeners.add(onChange);
    onChange(parked);
  }
  if (watcherCount === 1) {
    const token = ++startupToken;
    void listenNativeEvent<boolean>(TRAY_STATE_EVENT, (hidden) => {
      parked = hidden === true;
      listeners.forEach((listener) => listener(parked));
    }).then((off) => {
      if (!active || token !== startupToken || watcherCount === 0) off();
      else nativeStop = off;
    });
  }
  return () => {
    if (!active) return;
    active = false;
    watcherCount = Math.max(0, watcherCount - 1);
    if (onChange) listeners.delete(onChange);
    if (watcherCount === 0) {
      startupToken += 1;
      nativeStop?.();
      nativeStop = null;
      parked = false;
    }
  };
}
