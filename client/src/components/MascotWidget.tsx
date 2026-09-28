import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { X, Send, RotateCcw, Settings, PanelRightOpen, PanelRightClose } from "lucide-react";
import { http, ApiError, streamMascotChat, type MascotRadioAction } from "@/lib/api";
import { isRadioOnlyCommand, radioIntentFromText, radioReplyFromIntent, useOptionalRadio } from "@/components/RadioPlayer";
import { MascotSprite } from "@/components/MascotSprites";
import { mascotProfile } from "@/lib/mascotCharacters";
import { APP_NAME } from "@brand";

type MascotSettings = {
  enabled: boolean;
  character?: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  modelsUrl: string | null;
  hasKey: boolean;
};
type MascotUsage = { status: "available" | "unsupported" | "unavailable"; remaining?: number; currency?: string; message?: string };

type ChatMsg = { role: "user" | "assistant"; content: string };
type MascotPlacement = "floating" | "sidebar";

const POS_KEY = "dayly.mascot.pos.v3";
const CHAT_KEY = "dayly.mascot.chat";
const SESSION_KEY = "dayly.mascot.session";
const SIZE_KEY = "dayly.mascot.size.v1";
const SIZE_MIN = 72;
const SIZE_MAX = 288;
const DOCK_DEFAULT = 400;
const DOCK_MIN = 280;
const DOCK_MAX = 640;
const POP_MS = 200;

function newChatSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `kalendiario-${Date.now().toString(36)}`;
}

function loadChatSessionId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY)?.trim() ?? "";
    if (/^[A-Za-z0-9_.:-]{8,128}$/.test(raw)) return raw;
  } catch { /* ignore */ }
  const id = newChatSessionId();
  try { localStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
  return id;
}

function resetChatSessionId(): string {
  const id = newChatSessionId();
  try { localStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
  return id;
}

function clampSize(n: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
}

function loadSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    if (!Number.isFinite(n)) return SIZE_MAX;
    return clampSize(n);
  } catch {
    return SIZE_MAX;
  }
}

function defaultPos(size: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw >= 768) {
    return { x: vw - 28 - 56 - 16 - size, y: vh - 28 - size };
  }
  return { x: vw - 16 - size, y: vh - 88 - size };
}

function clampPos(p: { x: number; y: number }, size: number): { x: number; y: number } {
  const maxX = Math.max(8, window.innerWidth - size - 8);
  const maxY = Math.max(8, window.innerHeight - size - 8);
  return { x: Math.min(maxX, Math.max(8, p.x)), y: Math.min(maxY, Math.max(8, p.y)) };
}

function loadPos(size: number): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return clampPos(defaultPos(size), size);
    const p = JSON.parse(raw) as { x: number; y: number };
    if (typeof p.x !== "number" || typeof p.y !== "number") return clampPos(defaultPos(size), size);
    return clampPos(p, size);
  } catch {
    return clampPos(defaultPos(size), size);
  }
}

function loadChat(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ChatMsg[];
    return Array.isArray(arr) ? arr.slice(-20) : [];
  } catch {
    return [];
  }
}

export function MascotWidget({ docked = false, dockWidth = DOCK_DEFAULT, placement = "floating", sidebarCollapsed = false, onDockChange, onDockWidthChange }: { docked?: boolean; dockWidth?: number; placement?: MascotPlacement; sidebarCollapsed?: boolean; onDockChange?: (docked: boolean) => void; onDockWidthChange?: (width: number) => void }) {
  const qc = useQueryClient();
  const radio = useOptionalRadio();
  const setStation = radio?.setStation ?? ((_id: string) => {});
  const play = radio?.play ?? ((_stationId?: string) => {});
  const pause = radio?.pause ?? (() => {});
  const { data } = useQuery({
    queryKey: ["mascot-settings"],
    queryFn: () => http.get<{ settings: MascotSettings }>("/api/mascot/settings"),
  });
  const settings = data?.settings;
  const enabled = Boolean(settings?.enabled);
  const character = mascotProfile(settings?.character);
  const { data: usage } = useQuery({
    queryKey: ["mascot-usage", settings?.provider],
    queryFn: () => http.get<MascotUsage>("/api/mascot/usage"),
    enabled: enabled && settings?.provider === "custom" && settings.hasKey,
    staleTime: 5 * 60 * 1000,
  });
  const [mounted, setMounted] = useState(enabled);
  const [leaving, setLeaving] = useState(false);
  const [size, setSize] = useState(loadSize);
  const [pos, setPos] = useState(() => loadPos(loadSize()));
  const [open, setOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [mood, setMood] = useState<"idle" | "thinking" | "talking">("idle");
  const [messages, setMessages] = useState<ChatMsg[]>(loadChat);
  const [draft, setDraft] = useState("");
  const [resolvedModel, setResolvedModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sizePanelRef = useRef<HTMLDivElement>(null);
  const sidebarLauncherRef = useRef<HTMLButtonElement>(null);
  const sidebarPopupRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);
  const chatGen = useRef(0);
  const sessionIdRef = useRef(loadChatSessionId());
  const previousPlacement = useRef(placement);
  const dockResize = useRef<{ startX: number; startWidth: number } | null>(null);
  const [sizePanelPos, setSizePanelPos] = useState<{ top: number; left: number } | null>(null);
  const [sidebarPopupPos, setSidebarPopupPos] = useState<{ top: number; left: number } | null>(null);
  const sidebarPlacement = placement === "sidebar";

  useEffect(() => {
    if (previousPlacement.current === placement) return;
    previousPlacement.current = placement;
    setOpen(false);
    setSidebarPopupPos(null);
  }, [placement]);

  const resizeDockStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onDockWidthChange) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dockResize.current = { startX: e.clientX, startWidth: dockWidth };
    document.documentElement.classList.add("mascot-dock-dragging");
  };
  const resizeDockMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dockResize.current;
    if (!start || !onDockWidthChange) return;
    onDockWidthChange(Math.min(DOCK_MAX, Math.max(DOCK_MIN, start.startWidth + start.startX - e.clientX)));
  };
  const resizeDockEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dockResize.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dockResize.current = null;
    document.documentElement.classList.remove("mascot-dock-dragging");
  };
  const resizeDockKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onDockWidthChange) return;
    if (e.key === "Home") { e.preventDefault(); onDockWidthChange(DOCK_MIN); }
    if (e.key === "End") { e.preventDefault(); onDockWidthChange(DOCK_MAX); }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? 16 : -16;
      onDockWidthChange(Math.min(DOCK_MAX, Math.max(DOCK_MIN, dockWidth + delta)));
    }
  };

  useEffect(() => {
    if (enabled) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    setOpen(false);
    setSizeOpen(false);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, POP_MS);
    return () => window.clearTimeout(t);
  }, [enabled, mounted]);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, size));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size]);

  useEffect(() => {
    setPos((p) => clampPos(p, size));
    localStorage.setItem(SIZE_KEY, String(size));
  }, [size]);

  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-20)));
  }, [messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => {
    if (!sizeOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || sizePanelRef.current?.contains(t)) return;
      setSizeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSizeOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sizeOpen]);

  useEffect(() => {
    if (!sidebarPlacement || !sidebarCollapsed || !open) return;
    const position = () => {
      const launcher = sidebarLauncherRef.current?.getBoundingClientRect();
      if (!launcher) return;
      const panelWidth = Math.min(352, Math.max(260, window.innerWidth - 96));
      const panelHeight = Math.min(360, Math.max(224, window.innerHeight - 16));
      setSidebarPopupPos({
        top: Math.min(Math.max(8, launcher.top), Math.max(8, window.innerHeight - panelHeight - 8)),
        left: Math.min(launcher.right + 8, Math.max(8, window.innerWidth - panelWidth - 8)),
      });
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (sidebarLauncherRef.current?.contains(target) || sidebarPopupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    position();
    window.addEventListener("resize", position);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sidebarCollapsed, sidebarPlacement, open]);

  useEffect(() => {
    if (!sidebarPlacement || !sidebarCollapsed || !open || !settings?.hasKey) return;
    const frame = window.requestAnimationFrame(() => draftInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, settings?.hasKey, sidebarCollapsed, sidebarPlacement, sidebarPopupPos]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const nx = e.clientX - d.dx;
    const ny = e.clientY - d.dy;
    if (!d.moved && Math.hypot(nx - pos.x, ny - pos.y) < 8) return;
    d.moved = true;
    setPos(clampPos({ x: nx, y: ny }, size));
  }, [pos, size]);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    if (sizeOpen) {
      setSizeOpen(false);
      return;
    }
    setOpen((v) => !v);
  }, [sizeOpen]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    setOpen(false);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const panelW = Math.min(224, window.innerWidth - 16);
    const panelH = 128;
    let left = r.left;
    let top = r.bottom + 10;
    if (left + panelW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelW - 8);
    if (left < 8) left = 8;
    if (top + panelH > window.innerHeight - 8) top = r.top - panelH - 10;
    if (top < 8) top = 8;
    setSizePanelPos({ top, left });
    setSizeOpen(true);
  }, []);

  const clearChat = () => {
    chatGen.current += 1;
    sessionIdRef.current = resetChatSessionId();
    setMessages([{ role: "assistant", content: character.welcome }]);
    setDraft("");
    setError(null);
    setMood("idle");
    setResolvedModel(null);
  };

  const applyRadioActions = useCallback((actions: MascotRadioAction[]) => {
    for (const action of actions) {
      switch (action.action) {
        case "play":
          play(action.stationId);
          break;
        case "pause":
          pause();
          break;
        case "set_station":
          if (action.stationId) setStation(action.stationId);
          break;
        default: {
          const _never: never = action.action;
          return _never;
        }
      }
    }
  }, [pause, play, setStation]);

  const send = async () => {
    const text = draft.trim();
    if (!text || mood === "thinking") return;
    if (text.toLowerCase() === "/new") {
      clearChat();
      return;
    }
    const radioIntent = radioIntentFromText(text);
    if (radioIntent && isRadioOnlyCommand(text)) {
      applyRadioActions([{ type: "radio", ...radioIntent }]);
      setDraft("");
      setError(null);
      setMood("talking");
      setMessages((current) => [...current, { role: "user" as const, content: text }, { role: "assistant" as const, content: radioReplyFromIntent(radioIntent) }].slice(-20));
      window.setTimeout(() => setMood("idle"), 800);
      return;
    }
    if (!settings?.hasKey) return;
    const seq = chatGen.current;
    const next = [...messages, { role: "user" as const, content: text }].slice(-20);
    setDraft("");
    setMessages([...next, { role: "assistant", content: "" }]);
    setError(null);
    setMood("thinking");
    try {
      if (radioIntent) applyRadioActions([{ type: "radio", ...radioIntent }]);
      let gotDelta = false;
      const res = await streamMascotChat(next, (chunk) => {
        if (seq !== chatGen.current) return;
        gotDelta = true;
        setMood("talking");
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (!last || last.role !== "assistant") return m;
          copy[copy.length - 1] = { role: "assistant", content: last.content + chunk };
          return copy;
        });
      }, sessionIdRef.current);
      if (seq !== chatGen.current) return;
      setResolvedModel(res.model);
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { role: "assistant", content: res.reply || last.content };
        }
        return copy.slice(-20);
      });
      if (!radioIntent) applyRadioActions(res.actions ?? []);
      if (!gotDelta) setMood("talking");
      window.setTimeout(() => {
        if (seq === chatGen.current) setMood("idle");
      }, 1200);
      await qc.invalidateQueries({ queryKey: ["reminders"] });
      await qc.refetchQueries({ queryKey: ["reminders"], type: "active" });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["myday"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["notes"] });
      void qc.invalidateQueries({ queryKey: ["habits"] });
      void qc.invalidateQueries({ queryKey: ["goals"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
      void qc.invalidateQueries({ queryKey: ["time"] });
    } catch (err) {
      if (seq !== chatGen.current) return;
      setMood("idle");
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) copy.pop();
        return copy;
      });
      setError(err instanceof ApiError ? err.message : "No pude hablar ahora.");
    }
  };

  if (!mounted) return null;

  const panelLeft = pos.x > window.innerWidth / 2;
  const panelUp = pos.y > window.innerHeight / 2;

  const chatPanel = (
    <div
      id={sidebarPlacement ? "mascot-sidebar-chat" : undefined}
      className={clsx(
        "mascot-chat-panel pointer-events-auto flex min-w-0 flex-col overflow-hidden",
        sidebarPlacement
          ? "h-56 w-full rounded-xl !border !border-border !shadow-soft"
          : docked
          ? "h-full w-full border-0 bg-elevated"
        : "absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-elevated shadow-pop",
        !sidebarPlacement && !docked && (panelLeft ? "right-0" : "left-0"),
        !sidebarPlacement && !docked && (panelUp ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]"),
      )}
      role={sidebarPlacement && !sidebarCollapsed ? "region" : "dialog"}
      aria-label="Chat de la mascota"
    >
      <div className={clsx("flex items-center gap-2 border-b border-border", sidebarPlacement ? "min-h-10 px-2.5 py-1.5" : "px-3 py-2")}>
        {sidebarPlacement && (
          <span className="h-6 w-6 shrink-0" aria-hidden="true">
            <MascotSprite id={character.id} mood={mood} />
          </span>
        )}
        <p className={clsx("flex-1 font-semibold text-text", sidebarPlacement ? "truncate text-xs" : "text-sm")}>{character.name}</p>
        {resolvedModel && <span className="text-[10px] text-faint truncate max-w-[9rem]">{resolvedModel}</span>}
        {settings?.provider === "custom" && usage?.status === "available" && (
          <span className="text-[10px] text-ok whitespace-nowrap" title="Saldo restante de la API">Saldo: {formatBalance(usage.remaining, usage.currency)}</span>
        )}
        {settings?.provider === "custom" && usage?.status === "unavailable" && (
          <span className="text-[10px] text-faint whitespace-nowrap" title={usage.message}>Saldo: —</span>
        )}
        <button
          type="button"
          className="btn-ghost btn-icon-sm"
          aria-label="Nuevo chat"
          title="Nuevo chat"
          onClick={clearChat}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        {!sidebarPlacement && onDockChange && (
          <button
            type="button"
            className="btn-ghost btn-icon-sm"
            aria-label={docked ? "Desanclar chat" : "Anclar chat a la derecha"}
            title={docked ? "Desanclar chat" : "Anclar chat a la derecha"}
            onClick={() => onDockChange(!docked)}
          >
            {docked ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        )}
        {(!sidebarPlacement || sidebarCollapsed) && <button
          type="button"
          className="btn-ghost btn-icon-sm"
          aria-label={docked ? "Cerrar panel" : "Cerrar chat"}
          onClick={() => { setOpen(false); if (docked) onDockChange?.(false); }}
        >
          <X className="w-4 h-4" />
        </button>}
      </div>
      <div ref={listRef} className={clsx("overflow-y-auto space-y-2", sidebarPlacement ? "min-h-0 flex-1 px-2.5 py-1.5" : "px-3 py-2", !sidebarPlacement && (docked ? "flex-1 min-h-0" : "max-h-[min(50vh,22rem)]"))}>
        {!settings?.hasKey && (
          <p className={clsx("text-muted", sidebarPlacement ? "text-xs leading-5" : "text-sm")}>
            Configúrame en{" "}
            <Link to="/settings#mascot" className="text-accent-strong font-medium underline">Ajustes</Link>
            {" "}para poder hablar.
          </p>
        )}
        {settings?.hasKey && messages.length === 0 && (
            <p className={clsx("text-muted", sidebarPlacement ? "text-xs leading-5" : "text-sm")}><RichText content={character.welcome} /></p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={clsx(
              "rounded-xl px-3 py-2 whitespace-pre-wrap",
              sidebarPlacement ? "text-xs leading-5" : "text-sm",
              m.role === "user" ? "bg-accent-soft text-text ml-6" : "bg-surface text-text mr-6 border border-border",
            )}
          >
            <RichText content={m.content} />
          </div>
        ))}
        {mood === "thinking" && <p className="text-xs text-faint px-1">pensando…</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      {settings?.hasKey && (
        <form
          className={clsx("flex items-center gap-1 border-t border-border", sidebarPlacement ? "p-1.5" : "p-2")}
          onSubmit={(e) => { e.preventDefault(); void send(); }}
        >
          <input
            ref={draftInputRef}
            className={clsx("input flex-1", sidebarPlacement ? "h-9" : "h-10")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe un mensaje…"
            maxLength={4000}
            aria-label="Mensaje para la mascota"
          />
          <button type="submit" className="btn-primary btn-icon" aria-label="Enviar" disabled={mood === "thinking"}>
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );

  if (sidebarPlacement) {
    if (!sidebarCollapsed) return <div className="mt-3 mb-1 w-full">{chatPanel}</div>;
    return (
      <div className="relative flex justify-center py-1.5">
        <button
          ref={sidebarLauncherRef}
          type="button"
          className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          aria-expanded={open}
          aria-controls="mascot-sidebar-chat"
          aria-label={`Abrir chat de ${character.name}`}
          title={`Chat de ${character.name}`}
          onClick={() => {
            if (open) { setOpen(false); return; }
            setOpen(true);
          }}
        >
          <span className="h-8 w-8" aria-hidden="true"><MascotSprite id={character.id} mood={mood} /></span>
        </button>
        {open && sidebarPopupPos && createPortal(
          <div
            ref={sidebarPopupRef}
            className="pointer-events-auto fixed z-[76] w-[min(22rem,calc(100vw-6rem))]"
            style={{ top: sidebarPopupPos.top, left: sidebarPopupPos.left }}
          >
            {chatPanel}
          </div>,
          document.body,
        )}
      </div>
    );
  }

  if (docked) {
    return createPortal(
      <aside id="mascot-dock" className="mascot-dock fixed inset-y-0 right-0 z-[76] border-l border-border bg-elevated shadow-pop" style={{ "--mascot-dock-width": `${dockWidth}px` } as React.CSSProperties}>
        {onDockWidthChange && (
          <div
            className="mascot-dock-splitter hidden md:block"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ancho del chat de Kalen"
            aria-valuemin={DOCK_MIN}
            aria-valuemax={DOCK_MAX}
            aria-valuenow={dockWidth}
            aria-controls="mascot-dock"
            tabIndex={0}
            onPointerDown={resizeDockStart}
            onPointerMove={resizeDockMove}
            onPointerUp={resizeDockEnd}
            onPointerCancel={resizeDockEnd}
            onDoubleClick={() => onDockWidthChange(DOCK_DEFAULT)}
            onKeyDown={resizeDockKey}
          />
        )}
        {chatPanel}
      </aside>,
      document.body,
    );
  }

  return createPortal((
    <div
      ref={rootRef}
      className={clsx("fixed z-[76] pointer-events-none", leaving ? "mascot-pop-out" : "mascot-pop-in")}
      style={{ left: pos.x, top: pos.y, width: size, height: size }}
    >
      {open && chatPanel}
      {sizeOpen && sizePanelPos && createPortal(
        <div
          ref={sizePanelRef}
          className="fixed z-[76] w-[min(14rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-elevated shadow-pop px-3 py-2.5 pointer-events-auto"
          style={{ top: sizePanelPos.top, left: sizePanelPos.left }}
          role="dialog"
          aria-label="Ajustes de la mascota"
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <p className="text-xs font-medium text-muted mb-2">Tamaño</p>
          <input
            type="range"
            className="mascot-size-range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={size}
            onChange={(e) => setSize(clampSize(Number(e.target.value)))}
            aria-label="Tamaño de la mascota"
          />
          {onDockChange && (
            <button
              type="button"
              className="mt-2.5 pt-2.5 border-t border-border w-full flex items-center gap-2 text-sm text-text hover:text-accent-strong"
              onClick={() => { onDockChange(true); setSizeOpen(false); setOpen(false); }}
            >
              <PanelRightOpen className="w-4 h-4" />
              Anclar a la derecha
            </button>
          )}
          <Link
            to="/settings#mascot"
            className={clsx("flex items-center gap-2 text-sm text-text hover:text-accent-strong", !onDockChange && "mt-2.5 pt-2.5 border-t border-border", onDockChange && "mt-2")}
            onClick={() => setSizeOpen(false)}
          >
            <Settings className="w-4 h-4" />
            Ajustes de {character.name}
          </Link>
        </div>,
        document.body,
      )}
      <button
        type="button"
        className="pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
        aria-label={`${character.name}, mascota de ${APP_NAME}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
      >
        <MascotSprite id={character.id} mood={mood} />
      </button>
    </div>
  ), document.body);
}

function RichText({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {lineIndex > 0 && <br />}
          {line.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
            part.startsWith("**") && part.endsWith("**")
              ? <strong key={index}>{part.slice(2, -2)}</strong>
              : <span key={index}>{part}</span>
          )}
        </span>
      ))}
    </>
  );
}

function formatBalance(value?: number, currency?: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 4 })}${currency ? ` ${currency}` : ""}`;
}
