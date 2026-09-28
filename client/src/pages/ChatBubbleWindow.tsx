import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ChevronDown, LockKeyhole, MessageCircle, Minus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  closeNativeChatBubble,
  getNativeChatBubbleState,
  getNativeWindowLabel,
  isNativeChatBubbleWindow,
  isNativeShell,
  moveNativeChatBubble,
  readNativeChatBubblePosition,
  resizeNativeChatBubble,
  persistNativeChatBubblePosition,
  restoreMainForPin,
  showNativeChatBubbleMenu,
  startNativeChatBubbleDragging,
  watchNativeWindowMoved,
  type NativeChatBubbleBounds,
  type NativeChatBubbleMode,
  type NativeChatBubbleState,
  watchNativeChatBubbleState,
} from "@/lib/nativeShell";
import {
  conversationKey,
  useChatConversations,
  useChatIdentity,
  useStoredChatConversationSelection,
} from "@/lib/chatConversations";
import { FLOATING_CHAT_SELECTION_KEY } from "@/lib/FloatingChat";
import type { Conversation } from "@/lib/chatConversation";
import { ChatThread } from "@/components/chat/ChatThread";
import { NickText, SubnickText } from "@/components/NickText";
import { Avatar, Button, Spinner } from "@/components/ui";

const BUBBLE_SIZE = 72;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 620;
export const NATIVE_CHAT_BUBBLE_DRAG_THRESHOLD = 8;

export function isPrimaryNativeChatBubblePointer(pointerType: string, button: number): boolean {
  return pointerType !== "mouse" || button === 0;
}

export function hasNativeChatBubbleDragThreshold(startX: number, startY: number, clientX: number, clientY: number): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= NATIVE_CHAT_BUBBLE_DRAG_THRESHOLD;
}

export function getNativeChatBubbleDragPosition(
  originLeft: number,
  originTop: number,
  startScreenX: number,
  startScreenY: number,
  screenX: number,
  screenY: number,
): Pick<NativeChatBubbleBounds, "left" | "top"> {
  return {
    left: Math.round(originLeft + screenX - startScreenX),
    top: Math.round(originTop + screenY - startScreenY),
  };
}

export type NativeChatBubbleMovePosition = Pick<NativeChatBubbleBounds, "left" | "top">;

export function getNativeChatBubbleDragOrigin(
  remembered: NativeChatBubbleMovePosition | null,
  currentBounds: NativeChatBubbleBounds,
): NativeChatBubbleMovePosition {
  return remembered ?? { left: currentBounds.left, top: currentBounds.top };
}

/** One native IPC at a time; pointer moves coalesce to the latest position. */
export function createNativeChatBubbleMoveQueue(
  move: (position: NativeChatBubbleMovePosition) => Promise<boolean>,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void = () => {},
) {
  let pending: NativeChatBubbleMovePosition | null = null;
  let frameId: number | null = null;
  let inFlight = false;
  let failed = false;
  let finishing = false;
  const finishWaiters: Array<(ok: boolean) => void> = [];

  const settle = (ok: boolean) => {
    if (ok && (inFlight || pending || frameId !== null)) return;
    finishing = false;
    finishWaiters.splice(0).forEach((resolve) => resolve(ok));
  };

  const schedule = () => {
    if (frameId !== null || inFlight || failed || !pending) return;
    frameId = requestFrame(flush);
  };

  const flush = () => {
    frameId = null;
    if (inFlight || failed || !pending) return;
    const next = pending;
    pending = null;
    inFlight = true;
    void Promise.resolve(move(next)).then((ok) => {
      inFlight = false;
      if (!ok) {
        failed = true;
        pending = null;
        settle(false);
        return;
      }
      if (finishing && pending) flush();
      else {
        schedule();
        settle(true);
      }
    }, () => {
      inFlight = false;
      failed = true;
      pending = null;
      settle(false);
    });
  };

  return {
    queue(position: NativeChatBubbleMovePosition) {
      pending = position;
      schedule();
    },
    resetFailure() {
      failed = false;
      schedule();
    },
    finish(position: NativeChatBubbleMovePosition): Promise<boolean> {
      pending = position;
      finishing = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      return new Promise((resolve) => {
        finishWaiters.push(resolve);
        if (failed) settle(false);
        else if (!inFlight) flush();
      });
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      pending = null;
      settle(false);
    },
  };
}

type ChatBubbleAccess = "checking" | "allowed" | "denied";

export type NativeChatBubbleViewport = {
  width: number;
  height: number;
  screenX: number;
  screenY: number;
  availableWidth?: number;
  availableHeight?: number;
  availableLeft?: number;
  availableTop?: number;
};

function screenArea(viewport: NativeChatBubbleViewport) {
  return {
    left: viewport.availableLeft ?? 0,
    top: viewport.availableTop ?? 0,
    width: Math.max(PANEL_WIDTH + 16, viewport.availableWidth ?? viewport.width),
    height: Math.max(PANEL_HEIGHT + 16, viewport.availableHeight ?? viewport.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function clampNativeChatBubbleBounds(mode: NativeChatBubbleMode, bounds: NativeChatBubbleBounds, viewport: NativeChatBubbleViewport): NativeChatBubbleBounds {
  const area = screenArea(viewport);
  const margin = 8;
  return {
    ...bounds,
    left: clamp(bounds.left, area.left + margin, area.left + area.width - bounds.width - margin),
    top: clamp(bounds.top, area.top + margin, area.top + area.height - bounds.height - margin),
    width: mode === "bubble" ? BUBBLE_SIZE : bounds.width,
    height: mode === "bubble" ? BUBBLE_SIZE : bounds.height,
  };
}

/** Bounds used by both the compact bubble and its native panel. */
export function getNativeChatBubbleBounds(
  mode: NativeChatBubbleMode,
  viewport: NativeChatBubbleViewport = readViewport(),
): NativeChatBubbleBounds {
  const area = screenArea(viewport);
  const currentWidth = Math.max(BUBBLE_SIZE, viewport.width);
  const currentHeight = Math.max(BUBBLE_SIZE, viewport.height);
  if (mode === "bubble") {
    return clampNativeChatBubbleBounds(mode, {
      left: Math.round(viewport.screenX + currentWidth - BUBBLE_SIZE),
      top: Math.round(viewport.screenY + currentHeight - BUBBLE_SIZE),
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    }, viewport);
  }

  const width = Math.min(PANEL_WIDTH, Math.max(280, area.width - 16));
  const height = Math.min(PANEL_HEIGHT, Math.max(240, area.height - 16));
  const bubbleLeft = viewport.screenX;
  const bubbleRight = viewport.screenX + currentWidth;
  const bubbleBottom = viewport.screenY + currentHeight;
  // Like chat heads: the panel grows away from the nearest screen edge.
  const onLeftHalf = bubbleLeft + currentWidth / 2 < area.left + area.width / 2;
  const minLeft = area.left + 8;
  const maxLeft = area.left + area.width - width - 8;
  const minTop = area.top + 8;
  const maxTop = area.top + area.height - height - 8;
  const above = bubbleBottom - height - 8;
  const below = bubbleBottom + 8;
  return clampNativeChatBubbleBounds(mode, {
    left: Math.round(clamp(onLeftHalf ? bubbleLeft : bubbleRight - width, minLeft, maxLeft)),
    top: Math.round(above >= minTop ? above : below <= maxTop ? below : minTop),
    width,
    height,
  }, viewport);
}

function readViewport(): NativeChatBubbleViewport {
  if (typeof window === "undefined") return { width: 1280, height: 800, screenX: 0, screenY: 0 };
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
    screenX: Number.isFinite(window.screenX) ? window.screenX : 0,
    screenY: Number.isFinite(window.screenY) ? window.screenY : 0,
    availableWidth: Number.isFinite(screen.availWidth) && screen.availWidth > 0 ? screen.availWidth : window.innerWidth,
    availableHeight: Number.isFinite(screen.availHeight) && screen.availHeight > 0 ? screen.availHeight : window.innerHeight,
    availableLeft: Number.isFinite(screen.availLeft) ? screen.availLeft : 0,
    availableTop: Number.isFinite(screen.availTop) ? screen.availTop : 0,
  };
}

function readCurrentNativeChatBubbleBounds(mode: NativeChatBubbleMode): NativeChatBubbleBounds {
  const viewport = readViewport();
  return {
    left: viewport.screenX,
    top: viewport.screenY,
    width: mode === "bubble" ? BUBBLE_SIZE : Math.max(280, viewport.width),
    height: mode === "bubble" ? BUBBLE_SIZE : Math.max(240, viewport.height),
  };
}

function countLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function ConversationTitle({ conversation, className }: { conversation: Conversation; className?: string }) {
  if (conversation.kind === "direct" && conversation.link?.user) {
    const person = conversation.link.user;
    return (
      <NickText
        name={person.name}
        nick={person.nick}
        color={person.nickColor}
        bold={person.nickBold}
        segments={person.nickSegments}
        className={className}
      />
    );
  }
  return (
    <NickText
      name={conversation.title}
      color={conversation.titleColor}
      bold={conversation.titleBold}
      segments={conversation.titleSegments}
      className={className}
    />
  );
}

function SafeBubbleSurface({ checking, onRestore }: { checking: boolean; onRestore?: () => void }) {
  return (
    <main className="grid h-screen w-screen place-items-center overflow-hidden bg-transparent p-2 text-text">
      <section
        aria-live="polite"
        className="flex max-w-[19rem] flex-col items-center gap-2 rounded-2xl border border-border bg-surface/95 px-4 py-3 text-center shadow-pop"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-strong" aria-hidden="true">
          {checking ? <Spinner size={22} /> : <LockKeyhole className="h-5 w-5" />}
        </span>
        <p className="text-sm font-semibold">{checking ? "Preparando chat seguro…" : "Chat flotante bloqueado"}</p>
        <p className="text-xs text-muted">
          {checking ? "No se muestra ningún mensaje hasta confirmar la ventana nativa." : "La ventana principal controla el desbloqueo y el PIN."}
        </p>
        {onRestore && (
          <Button size="sm" variant="secondary" onClick={onRestore}>
            Volver a Kalendiario
          </Button>
        )}
      </section>
    </main>
  );
}

function BubbleSurface({
  conversation,
  unreadTotal,
  positionRef,
  onOpen,
}: {
  conversation: Conversation | null;
  unreadTotal: number;
  /** Last known logical window position, kept current by native move events. */
  positionRef: { current: NativeChatBubbleMovePosition | null };
  onOpen: (bounds: NativeChatBubbleBounds) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    originLeft: number;
    originTop: number;
    /** pending: waiting for the OS drag; native: the OS moves the window; manual: IPC fallback. */
    phase: "idle" | "pending" | "native" | "manual";
    lastPosition: NativeChatBubbleMovePosition;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const settlingRef = useRef<Promise<void> | null>(null);
  const moveQueueRef = useRef<ReturnType<typeof createNativeChatBubbleMoveQueue> | null>(null);

  const readAuthoritativeBounds = () => {
    const currentBounds = readCurrentNativeChatBubbleBounds("bubble");
    const stored = readNativeChatBubblePosition();
    const position = getNativeChatBubbleDragOrigin(
      positionRef.current ?? (stored?.mode === "bubble" ? stored : null),
      currentBounds,
    );
    return { ...currentBounds, ...position, width: BUBBLE_SIZE, height: BUBBLE_SIZE };
  };

  const queueNativeMove = useCallback((position: NativeChatBubbleMovePosition) => {
    if (!moveQueueRef.current) {
      moveQueueRef.current = createNativeChatBubbleMoveQueue(
        (next) => moveNativeChatBubble(next.left, next.top),
        (callback) => window.requestAnimationFrame(() => callback()),
        (id) => window.cancelAnimationFrame(id),
      );
    }
    moveQueueRef.current.queue(position);
  }, []);

  useEffect(() => () => {
    moveQueueRef.current?.cancel();
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isPrimaryNativeChatBubblePointer(event.pointerType, event.button)) return;
    suppressClickRef.current = false;
    moveQueueRef.current?.resetFailure();
    const bounds = readAuthoritativeBounds();
    const origin = { left: bounds.left, top: bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      originLeft: origin.left,
      originTop: origin.top,
      phase: "idle",
      lastPosition: origin,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.phase === "native") return;
    drag.lastPosition = getNativeChatBubbleDragPosition(
      drag.originLeft,
      drag.originTop,
      drag.startScreenX,
      drag.startScreenY,
      event.screenX,
      event.screenY,
    );
    if (drag.phase === "idle") {
      if (!hasNativeChatBubbleDragThreshold(drag.startScreenX, drag.startScreenY, event.screenX, event.screenY)) return;
      drag.phase = "pending";
      suppressClickRef.current = true;
      // The OS move loop follows the cursor exactly, like chat heads; the
      // window position is then tracked through native move events.
      void startNativeChatBubbleDragging().then((ok) => {
        if (dragRef.current !== drag) return;
        if (ok) {
          drag.phase = "native";
          dragRef.current = null;
          return;
        }
        drag.phase = "manual";
        positionRef.current = drag.lastPosition;
        queueNativeMove(drag.lastPosition);
      });
    }
    event.preventDefault();
    if (drag.phase !== "manual") return;
    positionRef.current = drag.lastPosition;
    queueNativeMove(drag.lastPosition);
  };

  const onContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void showNativeChatBubbleMenu();
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.phase !== "manual") return;
    const finalPosition = event.type === "pointercancel" ? drag.lastPosition : getNativeChatBubbleDragPosition(
      drag.originLeft,
      drag.originTop,
      drag.startScreenX,
      drag.startScreenY,
      event.screenX,
      event.screenY,
    );
    positionRef.current = finalPosition;
    const settling = moveQueueRef.current?.finish(finalPosition).then((ok) => {
      if (ok) persistNativeChatBubblePosition("bubble", { ...finalPosition, width: BUBBLE_SIZE, height: BUBBLE_SIZE });
    });
    settlingRef.current = settling ?? null;
    void settling?.then(() => {
      if (settlingRef.current === settling) settlingRef.current = null;
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const delta = event.shiftKey ? 32 : 16;
    const next = readAuthoritativeBounds();
    if (event.key === "ArrowLeft") next.left -= delta;
    else if (event.key === "ArrowRight") next.left += delta;
    else if (event.key === "ArrowUp") next.top -= delta;
    else if (event.key === "ArrowDown") next.top += delta;
    else return;
    event.preventDefault();
    const target = clampNativeChatBubbleBounds("bubble", next, readViewport());
    positionRef.current = { left: target.left, top: target.top };
    void resizeNativeChatBubble("bubble", target).then((ok) => {
      if (ok) persistNativeChatBubblePosition("bubble", target);
    });
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const open = () => onOpen(readAuthoritativeBounds());
    if (settlingRef.current) void settlingRef.current.then(open);
    else open();
  };

  return (
    <main className="grid h-screen w-screen place-items-center overflow-hidden bg-transparent">
      <button
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className="relative grid h-[58px] w-[58px] cursor-pointer touch-none select-none place-items-center rounded-full shadow-[0_2px_5px_rgba(0,0,0,0.28)] ring-2 ring-white motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:scale-105 motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-accent motion-reduce:transition-none"
        aria-label={unreadTotal > 0 ? `Abrir chat, ${unreadTotal} sin leer` : "Abrir chat"}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        title="Abrir chat"
      >
        {conversation ? (
          <Avatar name={conversation.title} src={conversation.avatarUrl} size={58} className="pointer-events-none" />
        ) : (
          <span
            className="pointer-events-none grid h-full w-full place-items-center rounded-full text-white"
            style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-strong)))" }}
          >
            <MessageCircle className="h-7 w-7" aria-hidden="true" />
          </span>
        )}
        {unreadTotal > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white">
            {countLabel(unreadTotal)}
          </span>
        )}
      </button>
    </main>
  );
}

function ChatPanel({
  userId,
  conversation,
  conversations,
  selectedKey,
  isLoading,
  gifsAvailable,
  unreadTotal,
  error,
  onChoose,
  onMinimize,
  onClose,
}: {
  userId: string;
  conversation: Conversation | null;
  conversations: Conversation[];
  selectedKey: string;
  isLoading: boolean;
  gifsAvailable: boolean;
  unreadTotal: number;
  error: string;
  onChoose: (key: string) => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-transparent p-1 text-text">
      <section role="dialog" aria-label="Chat flotante" className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-pop">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-elevated px-2.5 py-2">
          <Avatar name={conversation?.title ?? "Chat"} src={conversation?.avatarUrl} size={32} />
          <div className="min-w-0 flex-1">
            <div className="relative">
              <label htmlFor="native-chat-bubble-conversation" className="sr-only">Elegir conversación</label>
              <select
                id="native-chat-bubble-conversation"
                value={selectedKey}
                onChange={(event) => onChoose(event.target.value)}
                disabled={isLoading || conversations.length === 0}
                className="h-9 w-full appearance-none truncate rounded-lg border border-border bg-surface px-2 pr-7 text-sm text-text outline-none transition-colors hover:border-accent/60 focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60 motion-reduce:transition-none"
                aria-label="Elegir conversación"
              >
                {!conversations.length && <option value="">{isLoading ? "Cargando chats…" : "Sin conversaciones"}</option>}
                {conversations.map((item) => {
                  const key = conversationKey(item);
                  return <option key={key} value={key}>{item.title}</option>;
                })}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            </div>
            {conversation && (
              <div className="mt-0.5 flex min-w-0 items-center gap-1 px-1 text-[11px] text-muted">
                <ConversationTitle conversation={conversation} className="truncate" />
                {conversation.subnick && <SubnickText subnick={conversation.subnick} className="truncate" />}
              </div>
            )}
          </div>
          {unreadTotal > 0 && <span className="grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-5 text-white" aria-label={`${unreadTotal} sin leer`}>{countLabel(unreadTotal)}</span>}
          <Button variant="ghost" size="sm" icon onClick={onMinimize} aria-label="Minimizar chat" title="Minimizar">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Cerrar chat" title="Cerrar">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        {conversation ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatThread conv={conversation} meId={userId} compactComposer gifsAvailable={gifsAvailable} />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-4 text-center text-sm text-muted">
            {isLoading ? <Spinner className="text-accent" /> : "No hay conversaciones todavía."}
          </div>
        )}
        {error && <p role="alert" className="shrink-0 border-t border-border px-3 py-2 text-xs text-danger">{error}</p>}
      </section>
    </main>
  );
}

function AuthorizedChatBubble({ userId, requestedMode }: { userId: string; requestedMode: NativeChatBubbleMode }) {
  const [state, setState] = useState<NativeChatBubbleState>({ visible: false, mode: requestedMode, reason: null });
  const [stateKnown, setStateKnown] = useState(false);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    let eventSeen = false;
    void (async () => {
      try {
        stop = await watchNativeChatBubbleState((next) => {
          if (!active) return;
          eventSeen = true;
          setState(next);
        });
      } catch {
        // The query below can still recover a state from a shell with a flaky event channel.
      }
      const initial = await getNativeChatBubbleState();
      if (!active || !initial) return;
      if (!eventSeen) setState(initial);
      // Query confirmation is required before mounting any chat content. This
      // also recovers when `open` was emitted before the listener mounted.
      setStateKnown(true);
    })().catch(() => {
      // An old shell cannot answer the query; fail closed and keep chat unmounted.
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  const restoreForPin = useCallback(() => {
    void restoreMainForPin();
  }, []);

  const locked = !stateKnown
    || !state.visible
    || state.closed === true
    || state.reason === "close"
    || state.reason === "tray";

  if (locked) return <SafeBubbleSurface checking={!stateKnown} onRestore={restoreForPin} />;

  return <VisibleChatBubble state={state} userId={userId} onClosed={() => setState((current) => ({ ...current, visible: false, reason: "close", closed: true }))} />;
}

function VisibleChatBubble({
  state,
  userId,
  onClosed,
}: {
  state: NativeChatBubbleState;
  userId: string;
  onClosed: () => void;
}) {
  const { conversations, isLoading } = useChatConversations();
  const identity = useChatIdentity();
  const { selected, selectedKey, choose } = useStoredChatConversationSelection(conversations, FLOATING_CHAT_SELECTION_KEY);
  const [mode, setMode] = useState<NativeChatBubbleMode>(state.mode);
  const [error, setError] = useState("");
  const bubbleBoundsRef = useRef<NativeChatBubbleBounds | null>(null);
  const bubblePositionRef = useRef<NativeChatBubbleMovePosition | null>(null);
  const modeRef = useRef<NativeChatBubbleMode>(state.mode);
  const unreadTotal = useMemo(() => conversations.reduce((total, item) => total + item.unreadCount, 0), [conversations]);
  const activeConversation = selected ?? conversations[0] ?? null;
  const activeKey = activeConversation ? conversationKey(activeConversation) : selectedKey;

  useEffect(() => setMode(state.mode), [state.mode]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // The OS owns the window while dragging, so its move events are the only
  // reliable source for where the bubble really is.
  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    let persistTimer: number | undefined;
    void watchNativeWindowMoved((position) => {
      if (modeRef.current !== "bubble") return;
      bubblePositionRef.current = position;
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        persistNativeChatBubblePosition("bubble", { ...position, width: BUBBLE_SIZE, height: BUBBLE_SIZE });
      }, 150);
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else void Promise.resolve().then(unlisten).catch(() => {});
    }, () => {
      // Shells without window events keep the manual position tracking.
    });
    return () => {
      active = false;
      window.clearTimeout(persistTimer);
      if (stop) void Promise.resolve().then(stop).catch(() => {});
    };
  }, []);

  const changeMode = useCallback(async (nextMode: NativeChatBubbleMode, bubbleBounds?: NativeChatBubbleBounds) => {
    setError("");
    if (nextMode === "panel") {
      const stored = readNativeChatBubblePosition();
      bubbleBoundsRef.current = bubbleBounds ?? (stored?.mode === "bubble" ? stored : readCurrentNativeChatBubbleBounds("bubble"));
      persistNativeChatBubblePosition("bubble", bubbleBoundsRef.current);
    }
    const stored = readNativeChatBubblePosition();
    const nextBounds = nextMode === "bubble"
      ? bubbleBoundsRef.current ?? (stored?.mode === "bubble" ? stored : getNativeChatBubbleBounds("bubble"))
      : getNativeChatBubbleBounds("panel", bubbleBoundsRef.current
        ? {
            ...readViewport(),
            width: bubbleBoundsRef.current.width,
            height: bubbleBoundsRef.current.height,
            screenX: bubbleBoundsRef.current.left,
            screenY: bubbleBoundsRef.current.top,
          }
        : readViewport());
    const previousMode = modeRef.current;
    // Moves caused by this resize belong to the target mode.
    modeRef.current = nextMode;
    const ok = await resizeNativeChatBubble(nextMode, nextBounds);
    if (ok) {
      if (nextMode === "bubble") {
        bubblePositionRef.current = { left: nextBounds.left, top: nextBounds.top };
        persistNativeChatBubblePosition("bubble", nextBounds);
      }
      setMode(nextMode);
    } else {
      modeRef.current = previousMode;
      setError("Esta versión de Kalendiario no puede cambiar el tamaño del chat flotante.");
    }
  }, []);

  const close = useCallback(async () => {
    setError("");
    const ok = await closeNativeChatBubble();
    if (ok) onClosed();
    else setError("No se pudo cerrar el chat flotante.");
  }, [onClosed]);

  if (mode === "bubble") {
    return <BubbleSurface conversation={activeConversation} unreadTotal={unreadTotal} positionRef={bubblePositionRef} onOpen={(bounds) => void changeMode("panel", bounds)} />;
  }

  return (
    <ChatPanel
      userId={userId}
      conversation={activeConversation}
      conversations={conversations}
      selectedKey={activeKey}
      isLoading={isLoading}
      gifsAvailable={identity.data?.gifsAvailable ?? false}
      unreadTotal={unreadTotal}
      error={error}
      onChoose={choose}
      onMinimize={() => void changeMode("bubble")}
      onClose={() => void close()}
    />
  );
}

/**
 * Dedicated native-only route. AuthGuard owns authentication; this second
 * guard prevents a browser URL or the main Tauri window from ever mounting
 * chat queries or message components.
 */
export function ChatBubbleWindow() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const requestedMode: NativeChatBubbleMode = params.get("mode") === "panel" ? "panel" : "bubble";
  const [access, setAccess] = useState<ChatBubbleAccess>("checking");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isNativeShell()) {
        if (active) setAccess("denied");
        return;
      }
      const label = await getNativeWindowLabel();
      const allowed = label === "chat-bubble" && await isNativeChatBubbleWindow();
      if (active) setAccess(allowed ? "allowed" : "denied");
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <SafeBubbleSurface checking />;
  if (!user) return <Navigate to="/login" replace />;
  if (access === "checking") return <SafeBubbleSurface checking />;
  if (access === "denied") return <Navigate to="/chat" replace />;
  return <AuthorizedChatBubble key={user.id} userId={user.id} requestedMode={requestedMode} />;
}
