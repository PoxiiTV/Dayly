import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { ChevronDown, LockKeyhole, MessageCircle, Minus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useFloatingChat } from "@/lib/FloatingChat";
import { conversationKey, useChatConversations, useChatIdentity } from "@/lib/chatConversations";
import { ChatThread } from "@/components/chat/ChatThread";
import { Avatar } from "@/components/ui";

export const FLOATING_CHAT_POSITION_KEY = "dayly.chat.floating.position";

const BUBBLE_SIZE = 64;
const EDGE_GUTTER = 8;
const DRAG_THRESHOLD = 8;

export type FloatingChatPosition = {
  left: number;
  top: number;
};

export type FloatingChatBubbleProps = {
  /** Called by the future PIN/auth integration instead of opening chat. */
  onLockedActivate?: () => void;
  className?: string;
};

type Viewport = {
  width: number;
  height: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: FloatingChatPosition;
  dragging: boolean;
};

function getViewport(): Viewport {
  if (typeof window === "undefined") return { width: 360, height: 640 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function defaultPosition(viewport: Viewport): FloatingChatPosition {
  return {
    left: Math.max(EDGE_GUTTER, viewport.width - BUBBLE_SIZE - 24),
    top: Math.max(EDGE_GUTTER, viewport.height - BUBBLE_SIZE - 24),
  };
}

function clampPosition(position: FloatingChatPosition, viewport: Viewport): FloatingChatPosition {
  const maxLeft = Math.max(EDGE_GUTTER, viewport.width - BUBBLE_SIZE - EDGE_GUTTER);
  const maxTop = Math.max(EDGE_GUTTER, viewport.height - BUBBLE_SIZE - EDGE_GUTTER);
  return {
    left: Math.min(maxLeft, Math.max(EDGE_GUTTER, Math.round(position.left))),
    top: Math.min(maxTop, Math.max(EDGE_GUTTER, Math.round(position.top))),
  };
}

function readStoredPosition(): FloatingChatPosition {
  const fallback = defaultPosition(getViewport());
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(FLOATING_CHAT_POSITION_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FloatingChatPosition>;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return fallback;
    return { left: parsed.left as number, top: parsed.top as number };
  } catch {
    return fallback;
  }
}

function storePosition(position: FloatingChatPosition): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FLOATING_CHAT_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Private browsing and restricted storage must not disable the bubble.
  }
}

function countLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function FloatingChatBubble({ onLockedActivate, className }: FloatingChatBubbleProps) {
  const { user } = useAuth();
  const { active, expanded, locked, nativeSurface, selectedKey, toggle, select, collapse, deactivate } = useFloatingChat();
  const { conversations, isLoading } = useChatConversations();
  const identity = useChatIdentity();
  const [viewport, setViewport] = useState<Viewport>(getViewport);
  const [position, setPosition] = useState<FloatingChatPosition>(readStoredPosition);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const conversationSelectRef = useRef<HTMLSelectElement | null>(null);
  const wasExpandedRef = useRef(false);

  const selected = useMemo(
    () => conversations.find((conversation) => conversationKey(conversation) === selectedKey) ?? conversations[0] ?? null,
    [conversations, selectedKey],
  );
  const selectedConversationKey = selected ? conversationKey(selected) : "";
  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);

  useEffect(() => {
    if (!conversations.length) return;
    const selectionStillExists = conversations.some((conversation) => conversationKey(conversation) === selectedKey);
    if (!selectionStillExists) select(conversationKey(conversations[0]));
  }, [conversations, selectedKey, select]);

  useEffect(() => {
    const onResize = () => setViewport(getViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setPosition((previous) => {
      const next = clampPosition(previous, viewport);
      if (next.left === previous.left && next.top === previous.top) return previous;
      storePosition(next);
      return next;
    });
  }, [viewport]);

  useEffect(() => {
    if (!expanded || locked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      collapse();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [collapse, expanded, locked]);

  useEffect(() => {
    if (wasExpandedRef.current && !expanded && active) {
      window.requestAnimationFrame(() => bubbleRef.current?.focus({ preventScroll: true }));
    }
    wasExpandedRef.current = expanded;
  }, [active, expanded]);

  useEffect(() => {
    if (!expanded || locked) return;
    window.requestAnimationFrame(() => conversationSelectRef.current?.focus({ preventScroll: true }));
  }, [expanded, locked]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      dragging: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    drag.dragging = true;
    setDragging(true);
    event.preventDefault();
    setPosition(clampPosition({
      left: drag.startPosition.left + deltaX,
      top: drag.startPosition.top + deltaY,
    }, viewport));
  };

  /** Arrow keys provide a single-pointer-free alternative to dragging. */
  const onBubbleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 32 : 8;
    const next = { ...position };
    if (event.key === "ArrowLeft") next.left -= step;
    else if (event.key === "ArrowRight") next.left += step;
    else if (event.key === "ArrowUp") next.top -= step;
    else if (event.key === "ArrowDown") next.top += step;
    else return;

    event.preventDefault();
    const clamped = clampPosition(next, viewport);
    setPosition(clamped);
    storePosition(clamped);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      setPosition((previous) => {
        const next = clampPosition(previous, viewport);
        storePosition(next);
        return next;
      });
      suppressClickRef.current = true;
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onBubbleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (locked) {
      onLockedActivate?.();
      return;
    }
    toggle(selectedConversationKey || selectedKey);
  };

  if (!active || nativeSurface !== "web" || locked || !user || typeof document === "undefined") return null;

  const panelWidth = Math.min(360, Math.max(0, viewport.width - EDGE_GUTTER * 2));
  const panelHeight = Math.min(520, Math.max(0, viewport.height - EDGE_GUTTER * 2));
  const panelOnRight = position.left + BUBBLE_SIZE / 2 >= viewport.width / 2;
  const panelLeft = panelOnRight
    ? Math.max(EDGE_GUTTER, viewport.width - panelWidth - EDGE_GUTTER)
    : Math.min(Math.max(EDGE_GUTTER, position.left), Math.max(EDGE_GUTTER, viewport.width - panelWidth - EDGE_GUTTER));
  const panelTop = Math.min(
    Math.max(EDGE_GUTTER, position.top),
    Math.max(EDGE_GUTTER, viewport.height - panelHeight - EDGE_GUTTER),
  );

  const rootStyle: CSSProperties = expanded && !locked
    ? { left: panelLeft, top: panelTop, zIndex: 119 }
    : { left: position.left, top: position.top, zIndex: 119 };

  const bubble = (
    <button
      type="button"
      ref={bubbleRef}
      onClick={onBubbleClick}
      onKeyDown={onBubbleKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onDragStart={(event) => event.preventDefault()}
      className={clsx(
        "relative grid h-16 w-16 touch-none select-none place-items-center rounded-full border border-border bg-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "motion-safe:transition-transform motion-safe:duration-200 motion-reduce:transition-none",
        dragging ? "cursor-grabbing" : "cursor-grab motion-safe:hover:scale-[1.03]",
        className,
      )}
      aria-expanded={!locked && expanded}
      aria-haspopup="dialog"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      aria-label={locked
        ? "Chat bloqueado"
        : unreadTotal > 0
          ? `Abrir chat flotante, ${unreadTotal} sin leer`
          : "Abrir chat flotante"}
      title={locked ? "Chat bloqueado" : "Chat flotante"}
    >
      {selected ? (
        <Avatar name={selected.title} src={selected.avatarUrl} size={48} />
      ) : (
        <MessageCircle className="h-7 w-7 text-muted" aria-hidden="true" />
      )}
      {unreadTotal > 0 && (
        <span
          className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-bg"
          aria-hidden="true"
        >
          {countLabel(unreadTotal)}
        </span>
      )}
      {locked && (
        <span className="absolute bottom-0 right-0 grid h-6 w-6 place-items-center rounded-full bg-surface text-muted ring-2 ring-bg" aria-hidden="true">
          <LockKeyhole className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );

  const panel = !locked && expanded ? (
    <section
      id="floating-chat-panel"
      role="dialog"
      aria-label="Chat flotante"
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-pop motion-reduce:transition-none"
      style={{
        width: "min(360px, calc(100vw - 16px))",
        height: "min(520px, calc(100dvh - 16px))",
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100dvh - 16px)",
      }}
    >
      <header className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border bg-elevated px-2.5 py-2">
        <Avatar name={selected?.title ?? "Chat"} src={selected?.avatarUrl} size={30} />
        <div className="relative min-w-0 flex-1">
          <label htmlFor="floating-chat-conversation" className="sr-only">Elegir conversación</label>
          <select
            id="floating-chat-conversation"
            ref={conversationSelectRef}
            value={selectedConversationKey}
            onChange={(event) => select(event.target.value)}
            disabled={isLoading || conversations.length === 0}
            className="h-9 w-full appearance-none truncate rounded-lg border border-border bg-surface px-2 pr-7 text-sm text-text outline-none transition-colors hover:border-accent/60 focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60 motion-reduce:transition-none"
            aria-label="Elegir conversación"
          >
            {!conversations.length && <option value="">{isLoading ? "Cargando chats…" : "Sin conversaciones"}</option>}
            {conversations.map((conversation) => {
              const key = conversationKey(conversation);
              return <option key={key} value={key}>{conversation.title}</option>;
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
        </div>
        <button
          type="button"
          onClick={collapse}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          aria-label="Minimizar chat flotante"
          title="Minimizar"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={deactivate}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
          aria-label="Cerrar chat flotante"
          title="Cerrar"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      {selected ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatThread
            conv={selected}
            meId={user?.id ?? ""}
            compactComposer
            gifsAvailable={identity.data?.gifsAvailable ?? false}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-4 text-center text-sm text-muted">
          {isLoading ? "Cargando conversaciones…" : "No hay conversaciones todavía."}
        </div>
      )}
    </section>
  ) : bubble;

  return createPortal(
    <div
      className={clsx(
        "fixed pointer-events-auto",
        !expanded && !dragging && "motion-safe:transition-[left,top] motion-safe:duration-200 motion-reduce:transition-none",
      )}
      style={rootStyle}
    >
      {panel}
    </div>,
    document.body,
  );
}
