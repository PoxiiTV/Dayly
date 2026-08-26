import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { X, Send, RotateCcw, Settings } from "lucide-react";
import { http, ApiError, streamMascotChat } from "@/lib/api";

type MascotSettings = {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string | null;
  modelsUrl: string | null;
  hasKey: boolean;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const POS_KEY = "dayly.mascot.pos.v3";
const CHAT_KEY = "dayly.mascot.chat";
const SIZE_KEY = "dayly.mascot.size.v1";
const SIZE_MIN = 72;
const SIZE_MAX = 288;
const POP_MS = 200;
const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";

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

export function MascotWidget() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["mascot-settings"],
    queryFn: () => http.get<{ settings: MascotSettings }>("/api/mascot/settings"),
  });
  const settings = data?.settings;
  const enabled = Boolean(settings?.enabled);
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
  const chatGen = useRef(0);
  const [sizePanelPos, setSizePanelPos] = useState<{ top: number; left: number } | null>(null);

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
    setMessages([]);
    setDraft("");
    setError(null);
    setMood("idle");
    setResolvedModel(null);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || mood === "thinking") return;
    if (text.toLowerCase() === "/new") {
      clearChat();
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
      });
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
      if (!gotDelta) setMood("talking");
      window.setTimeout(() => {
        if (seq === chatGen.current) setMood("idle");
      }, 1200);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["myday"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["notes"] });
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

  return (
    <div
      ref={rootRef}
      className={clsx("fixed z-[55] pointer-events-none", leaving ? "mascot-pop-out" : "mascot-pop-in")}
      style={{ left: pos.x, top: pos.y, width: size, height: size }}
    >
      {open && (
        <div
          className={clsx(
            "pointer-events-auto absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-elevated shadow-pop flex flex-col overflow-hidden",
            panelLeft ? "right-0" : "left-0",
            panelUp ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]",
          )}
          role="dialog"
          aria-label="Chat de la mascota"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <p className="text-sm font-semibold text-text flex-1">Calen</p>
            {resolvedModel && <span className="text-[10px] text-faint truncate max-w-[9rem]">{resolvedModel}</span>}
            {!IS_DEMO && (
              <button
                type="button"
                className="btn-ghost !p-1"
                aria-label="Nuevo chat"
                title="Nuevo chat"
                onClick={clearChat}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button type="button" className="btn-ghost !p-1" aria-label="Cerrar chat" onClick={() => setOpen(false)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {IS_DEMO ? (
            <div className="px-3 py-4">
              <div className="rounded-xl bg-accent-soft/50 border border-border px-3 py-3">
                <p className="text-sm font-medium text-text">Calen no está disponible en la demo</p>
                <p className="text-xs text-muted mt-1.5 leading-relaxed">
                  Aquí no hay servidor ni modelo de IA. En la app real Calen crea tareas, eventos y notas de verdad,
                  dice el tiempo, cuenta los partidos y responde en tu zona horaria.
                </p>
              </div>
              <p className="text-xs text-muted mt-3">
                Puedes arrastrarla, cambiarle el tamaño (clic derecho) y verla moverse.
              </p>
            </div>
          ) : (
            <>
          <div ref={listRef} className="max-h-[min(50vh,22rem)] overflow-y-auto px-3 py-2 space-y-2">
            {!settings?.hasKey && (
              <p className="text-sm text-muted">
                Configúrame en{" "}
                <Link to="/settings#mascot" className="text-accent-strong font-medium underline">Ajustes</Link>
                {" "}para poder hablar.
              </p>
            )}
            {settings?.hasKey && messages.length === 0 && (
              <p className="text-sm text-muted">¿Agenda, clima, receta, ejercicio o un partido? Dime.</p>
            )}
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={clsx(
                  "text-sm rounded-xl px-3 py-2 whitespace-pre-wrap",
                  m.role === "user" ? "bg-accent-soft text-text ml-6" : "bg-surface text-text mr-6 border border-border",
                )}
              >
                {m.content}
              </div>
            ))}
            {mood === "thinking" && <p className="text-xs text-faint px-1">pensando…</p>}
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
          {settings?.hasKey && (
            <form
              className="flex items-center gap-1 p-2 border-t border-border"
              onSubmit={(e) => { e.preventDefault(); void send(); }}
            >
              <input
                className="input !h-9 flex-1"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje…"
                maxLength={4000}
                aria-label="Mensaje para la mascota"
              />
              <button type="submit" className="btn-primary !h-9 !w-9 !p-0" aria-label="Enviar" disabled={mood === "thinking"}>
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
            </>
          )}
        </div>
      )}
      {sizeOpen && sizePanelPos && createPortal(
        <div
          ref={sizePanelRef}
          className="fixed z-[60] w-[min(14rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-elevated shadow-pop px-3 py-2.5 pointer-events-auto"
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
          <Link
            to="/settings#mascot"
            className="mt-2.5 pt-2.5 border-t border-border flex items-center gap-2 text-sm text-text hover:text-accent-strong"
            onClick={() => setSizeOpen(false)}
          >
            <Settings className="w-4 h-4" />
            Ajustes de Calen
          </Link>
        </div>,
        document.body,
      )}
      <button
        type="button"
        className="pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
        aria-label="Calen, mascota de Dayly"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
      >
        <KawaiiCalendar mood={mood} />
      </button>
    </div>
  );
}

function KawaiiCalendar({ mood }: { mood: "idle" | "thinking" | "talking" }) {
  return (
    <svg viewBox="0 0 72 72" className={clsx("w-full h-full drop-shadow-md", "mascot-idle")} aria-hidden>
      <rect x="8" y="14" width="56" height="50" rx="12" fill="#ffffff" stroke="#e4e4e7" strokeWidth="2" />
      <rect x="8" y="14" width="56" height="16" rx="12" fill="#f87171" />
      <rect x="8" y="22" width="56" height="8" fill="#f87171" />
      <circle cx="24" cy="14" r="4" fill="#fecaca" />
      <circle cx="48" cy="14" r="4" fill="#fecaca" />
      <text x="36" y="26" textAnchor="middle" fontSize="6.5" fill="white" fontWeight="700" letterSpacing="0.4">CALEN</text>
      <circle cx="28" cy="44" r="4.2" fill="#27272a" />
      <circle cx="44" cy="44" r="4.2" fill="#27272a" />
      <circle cx="29.2" cy="42.6" r="1.3" fill="white" />
      <circle cx="45.2" cy="42.6" r="1.3" fill="white" />
      <ellipse cx="24" cy="50" rx="4" ry="2.2" fill="#fda4af" opacity="0.8" />
      <ellipse cx="48" cy="50" rx="4" ry="2.2" fill="#fda4af" opacity="0.8" />
      {mood === "thinking" ? (
        <g>
          <circle className="mascot-think-dot" cx="28" cy="58" r="1.8" fill="#71717a" />
          <circle className="mascot-think-dot" cx="36" cy="58" r="1.8" fill="#71717a" style={{ animationDelay: "0.15s" }} />
          <circle className="mascot-think-dot" cx="44" cy="58" r="1.8" fill="#71717a" style={{ animationDelay: "0.3s" }} />
        </g>
      ) : (
        <ellipse cx="36" cy="56" rx="6" ry={mood === "talking" ? 3.2 : 2} fill="#27272a" className={clsx(mood === "talking" && "mascot-talk")} />
      )}
      <path d="M6 32c-4 6 1 10 4 6" fill="#86efac" />
      <path d="M66 36c4 6-1 10-4 6" fill="#86efac" />
    </svg>
  );
}
