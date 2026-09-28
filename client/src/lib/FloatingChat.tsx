import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { useAuth } from "@/lib/auth";
import {
  closeNativeChatBubble,
  getNativeChatBubbleState,
  hideNativeChatBubble,
  isNativeShell,
  openNativeChatBubble,
  readNativeChatBubblePosition,
  type NativeChatBubbleBounds,
  type NativeChatBubbleState,
  watchNativeChatBubbleState,
} from "@/lib/nativeShell";
import { isParkedInTray, watchTrayState } from "@/lib/trayState";

/** Shared with ChatSidebarWidget so both compact surfaces reopen the same chat. */
export const FLOATING_CHAT_SELECTION_KEY = "dayly.chat.sidebar.conversation";
export const FLOATING_CHAT_SELECTION_EVENT = "dayly-floating-chat-selection";

export type FloatingChatNativeSurface = "web" | "opening" | "native";
export type FloatingChatHiddenReason = "hide" | "tray" | null;

export type FloatingChatNativeSnapshot = {
  active: boolean;
  expanded: boolean;
  surface: FloatingChatNativeSurface;
  visible: boolean;
  hiddenReason: FloatingChatHiddenReason;
};

/** Pure state contract for shell events; close is the only user deactivation. */
export function reduceFloatingChatNativeState(
  current: FloatingChatNativeSnapshot,
  event: Pick<NativeChatBubbleState, "visible" | "reason">,
): FloatingChatNativeSnapshot {
  switch (event.reason) {
    case "close":
      return { ...current, active: false, expanded: false, surface: "web", visible: false, hiddenReason: null };
    case "hide":
      return { ...current, expanded: false, surface: "native", visible: false, hiddenReason: "hide" };
    case "tray":
      return { ...current, expanded: false, surface: "native", visible: false, hiddenReason: "tray" };
    case "open":
    case "resize":
      return {
        ...current,
        surface: "native",
        visible: event.visible,
        hiddenReason: event.visible ? null : current.hiddenReason,
      };
    default:
      return { ...current, surface: "native", visible: event.visible };
  }
}

export function shouldIgnoreStaleFloatingChatClose(
  active: boolean,
  currentNativeState: Pick<NativeChatBubbleState, "visible"> | null,
): boolean {
  return active && currentNativeState?.visible === true;
}

export function releaseFloatingChatHiddenReason(
  reason: FloatingChatHiddenReason,
  trayParked: boolean,
  locked: boolean,
): FloatingChatHiddenReason {
  return trayParked || locked ? reason : null;
}

export type FloatingChatContextValue = {
  active: boolean;
  expanded: boolean;
  locked: boolean;
  selectedKey: string;
  nativeSurface: FloatingChatNativeSurface;
  /** Show the bubble with a conversation selected, without opening its panel. */
  activate: (key: string) => void;
  /** Select a conversation and toggle the panel open state. */
  toggle: (key: string) => void;
  /** Select and persist a conversation without changing visibility. */
  select: (key: string) => void;
  /** Keep the bubble active while hiding its panel. */
  collapse: () => void;
  /** Remove the bubble and hide its panel. */
  deactivate: () => void;
  /** Locking also closes the panel so messages and the composer unmount. */
  setLocked: (locked: boolean) => void;
};

export type FloatingChatProviderProps = PropsWithChildren;

const FloatingChatContext = createContext<FloatingChatContextValue | null>(null);

function readStoredSelection(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(FLOATING_CHAT_SELECTION_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeSelection(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FLOATING_CHAT_SELECTION_KEY, key);
    window.dispatchEvent(new CustomEvent(FLOATING_CHAT_SELECTION_EVENT, { detail: key }));
  } catch {
    // Private browsing and restricted storage must not stop the chat opening.
  }
}

async function openNativeBubbleWithStoredBounds(): Promise<boolean> {
  const stored = readNativeChatBubblePosition();
  const bounds: NativeChatBubbleBounds | undefined = stored ? {
    left: stored.mode === "panel" ? stored.left + stored.width - 72 : stored.left,
    top: stored.mode === "panel" ? stored.top + stored.height - 72 : stored.top,
    width: 72,
    height: 72,
  } : undefined;
  if (bounds && [bounds.left, bounds.top].some((value) => !Number.isFinite(value) || Math.abs(value) > 100_000)) {
    return openNativeChatBubble("bubble");
  }
  const opened = await openNativeChatBubble("bubble", bounds);
  // A stale position must not turn a supported shell into the web fallback.
  return opened || !bounds ? opened : openNativeChatBubble("bubble");
}

export function FloatingChatProvider({ children }: FloatingChatProviderProps) {
  const { user } = useAuth();
  const nativeEnvironment = isNativeShell();
  // Deliberately not persisted: a reload must never bring the floating surface
  // back on top of the application without an explicit activation.
  const [runtime, setRuntimeState] = useState<FloatingChatNativeSnapshot & { bridge: "unknown" | "supported" | "unsupported" }>(() => ({
    active: false,
    expanded: false,
    surface: nativeEnvironment ? "opening" : "web",
    visible: false,
    hiddenReason: null,
    bridge: nativeEnvironment ? "unknown" : "unsupported",
  }));
  const [locked, setLockedState] = useState(false);
  const [selectedKey, setSelectedKey] = useState(readStoredSelection);
  const [trayParked, setTrayParked] = useState(isParkedInTray);
  const runtimeRef = useRef(runtime);
  const openingRef = useRef(false);
  const hidingRef = useRef(false);
  const operationRef = useRef(0);
  const lockedRef = useRef(locked);
  const trayRef = useRef(trayParked);

  const setRuntime = useCallback((next: FloatingChatNativeSnapshot & { bridge: "unknown" | "supported" | "unsupported" } | ((current: FloatingChatNativeSnapshot & { bridge: "unknown" | "supported" | "unsupported" }) => FloatingChatNativeSnapshot & { bridge: "unknown" | "supported" | "unsupported" })) => {
    setRuntimeState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      runtimeRef.current = value;
      return value;
    });
  }, []);

  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => { trayRef.current = trayParked; }, [trayParked]);

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    storeSelection(key);
  }, []);

  const activate = useCallback((key: string) => {
    select(key);
    setRuntime((current) => ({
      ...current,
      active: true,
      expanded: false,
      surface: current.active && current.surface === "native" && current.visible
        ? "native"
        : current.bridge === "unsupported" || !nativeEnvironment ? "web" : "opening",
      visible: current.active && current.surface === "native" && current.visible,
      hiddenReason: null,
    }));
  }, [nativeEnvironment, select, setRuntime]);

  const toggle = useCallback((key: string) => {
    select(key);
    setRuntime((current) => ({
      ...current,
      active: true,
      surface: current.active && current.surface === "native" && current.visible
        ? "native"
        : current.bridge === "unsupported" || !nativeEnvironment ? "web" : "opening",
      visible: current.active && current.surface === "native" && current.visible,
      expanded: locked ? false : !current.expanded,
      hiddenReason: null,
    }));
  }, [locked, nativeEnvironment, select, setRuntime]);

  const collapse = useCallback(() => {
    setRuntime((current) => ({ ...current, expanded: false }));
  }, [setRuntime]);

  const deactivate = useCallback(() => {
    const shouldClose = runtimeRef.current.bridge === "supported" || runtimeRef.current.surface !== "web";
    operationRef.current += 1;
    if (shouldClose) void closeNativeChatBubble();
    setRuntime((current) => ({ ...current, active: false, expanded: false, surface: "web", visible: false, hiddenReason: null }));
  }, [setRuntime]);

  const setLocked = useCallback((nextLocked: boolean) => {
    lockedRef.current = nextLocked;
    setLockedState(nextLocked);
    setRuntime((current) => ({
      ...current,
      expanded: nextLocked ? false : current.expanded,
      hiddenReason: nextLocked && current.surface !== "web"
        ? "hide"
        : !nextLocked && !trayRef.current ? null : current.hiddenReason,
    }));
  }, [setRuntime]);

  useEffect(() => watchTrayState(setTrayParked), []);

  useEffect(() => {
    if (trayParked || locked) return;
    setRuntime((current) => {
      const hiddenReason = releaseFloatingChatHiddenReason(current.hiddenReason, trayParked, locked);
      return hiddenReason === current.hiddenReason ? current : { ...current, hiddenReason };
    });
  }, [locked, setRuntime, trayParked]);

  useEffect(() => {
    if (!nativeEnvironment) return;
    let disposed = false;
    let stop = () => {};
    void watchNativeChatBubbleState((event) => {
      if (event.reason === "close") {
        void getNativeChatBubbleState().then((actual) => {
          // A close event can arrive after a fast re-open. Ask the shell for
          // the current child before deactivating the new window.
          if (shouldIgnoreStaleFloatingChatClose(runtimeRef.current.active, actual)) return;
          const next = reduceFloatingChatNativeState(runtimeRef.current, event);
          const value = { ...next, bridge: "supported" as const };
          runtimeRef.current = value;
          setRuntimeState(value);
        });
        return;
      }
      const next = reduceFloatingChatNativeState(runtimeRef.current, event);
      const value = { ...next, bridge: "supported" as const };
      runtimeRef.current = value;
      setRuntimeState(value);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [nativeEnvironment]);

  useEffect(() => {
    if (!nativeEnvironment || !runtime.active || runtime.bridge === "unsupported") return;
    if (locked || trayParked || runtime.hiddenReason) return;
    if (runtime.surface === "native" && runtime.visible) return;
    if (openingRef.current) return;

    openingRef.current = true;
    const operation = ++operationRef.current;
    setRuntime((current) => ({ ...current, surface: "opening" }));
    void openNativeBubbleWithStoredBounds().then((opened) => {
      if (operation !== operationRef.current) {
        if (opened) void closeNativeChatBubble();
        return;
      }
      if (!opened) {
        setRuntime((current) => ({ ...current, surface: "web", visible: false, bridge: "unsupported" }));
        return;
      }
      if (!runtimeRef.current.active || lockedRef.current || trayRef.current || runtimeRef.current.hiddenReason) {
        setRuntime((current) => ({ ...current, surface: "native", visible: false, bridge: "supported" }));
        void hideNativeChatBubble();
        return;
      }
      setRuntime((current) => ({ ...current, surface: "native", visible: true, bridge: "supported" }));
    }).finally(() => {
      openingRef.current = false;
    });
  }, [locked, nativeEnvironment, runtime.active, runtime.bridge, runtime.hiddenReason, runtime.surface, runtime.visible, setRuntime, trayParked]);

  useEffect(() => {
    if (!nativeEnvironment || !runtime.active || runtime.bridge !== "supported") return;
    if (!locked && !trayParked && !runtime.hiddenReason) return;
    if (!runtime.visible || hidingRef.current) return;
    hidingRef.current = true;
    setRuntime((current) => ({ ...current, visible: false }));
    void hideNativeChatBubble().finally(() => {
      hidingRef.current = false;
    });
  }, [locked, nativeEnvironment, runtime.active, runtime.bridge, runtime.hiddenReason, runtime.visible, setRuntime, trayParked]);

  useEffect(() => {
    if (user) return;
    setSelectedKey("");
    try { window.localStorage.removeItem(FLOATING_CHAT_SELECTION_KEY); } catch { /* private mode */ }
  }, [user]);

  useEffect(() => () => {
    operationRef.current += 1;
    const current = runtimeRef.current;
    if (current.bridge === "supported" || current.surface !== "web") void closeNativeChatBubble();
    runtimeRef.current = { ...current, active: false, expanded: false, surface: "web", visible: false, hiddenReason: null };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FLOATING_CHAT_SELECTION_KEY) setSelectedKey(event.newValue ?? "");
    };
    const onSelection = (event: Event) => {
      const key = (event as CustomEvent<unknown>).detail;
      if (typeof key === "string") setSelectedKey(key);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(FLOATING_CHAT_SELECTION_EVENT, onSelection);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(FLOATING_CHAT_SELECTION_EVENT, onSelection);
    };
  }, []);

  const value = useMemo<FloatingChatContextValue>(() => ({
    active: runtime.active,
    expanded: runtime.expanded,
    locked,
    selectedKey,
    nativeSurface: runtime.surface,
    activate,
    toggle,
    select,
    collapse,
    deactivate,
    setLocked,
  }), [activate, collapse, deactivate, locked, runtime.active, runtime.expanded, runtime.surface, select, selectedKey, setLocked, toggle]);

  return <FloatingChatContext.Provider value={value}>{children}</FloatingChatContext.Provider>;
}

export function useFloatingChat(): FloatingChatContextValue {
  const context = useContext(FloatingChatContext);
  if (!context) throw new Error("useFloatingChat debe usarse dentro de FloatingChatProvider");
  return context;
}
