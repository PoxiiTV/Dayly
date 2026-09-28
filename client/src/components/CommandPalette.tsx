import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, ListTodo, CalendarDays, StickyNote, PanelsTopLeft, Target, Repeat, Plus } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useToast, usePresence } from "@/components/ui";
import { parseQuickAdd, parseLooksLikeCreate } from "@/lib/quickAddParse";
import { createFromQuickAdd } from "@/lib/quickAddCreate";
import { useItemToasts } from "@/lib/itemToasts";

interface Result { id: string; title: string; route: string; group: string; meta?: string; color?: string; }
const ICONS: Record<string, any> = { task: ListTodo, event: CalendarDays, note: StickyNote, project: PanelsTopLeft, goal: Target, habit: Repeat, create: Plus };
const KIND_LABEL: Record<string, string> = { task: "tarea", event: "evento", note: "nota", project: "proyecto", reminder: "recordatorio" };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const { present, leaving } = usePresence(open);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const createRow = useMemo((): Result | null => {
    if (!parseLooksLikeCreate(q)) return null;
    const parsed = parseQuickAdd(q);
    if (!parsed.title.trim()) return null;
    return {
      id: "create",
      title: `Crear ${KIND_LABEL[parsed.kind]}: ${parsed.title}`,
      route: "",
      group: "create",
      meta: parsed.hint || undefined,
    };
  }, [q]);

  const rows = useMemo(() => (createRow ? [createRow, ...results] : results), [createRow, results]);

  useEffect(() => {
    if (open) {
      setQ(""); setResults([]); setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) { setResults([]); return; }
    setBusy(true);
    let on = true;
    const t = setTimeout(async () => {
      try {
        const d = await http.get<Record<string, any[]>>("/api/search", { q: q.trim() });
        if (!on) return;
        const flat: Result[] = [];
        for (const [group, arr] of Object.entries(d)) {
          (arr ?? []).slice(0, 5).forEach((r: any) => {
            let route = "";
            if (group === "tasks") { route = `/tasks#${r.id}`; }
            if (group === "events") { route = `/calendar#${r.id}`; }
            if (group === "notes") { route = `/notes#${r.id}`; }
            if (group === "projects") { route = `/projects#${r.id}`; }
            if (group === "goals") { route = `/goals#${r.id}`; }
            if (group === "habits") { route = `/goals?tab=habits#${r.id}`; }
            flat.push({ id: r.id, title: r.title ?? r.name, route, group: group.slice(0, -1), color: r.color });
          });
        }
        setResults(flat); setIdx(0);
      } catch { push("error", "No se pudo buscar."); }
      finally { if (on) setBusy(false); }
    }, 220);
    return () => { on = false; clearTimeout(t); };
  }, [q, open]);

  const { afterQuickAdd } = useItemToasts();

  const runCreate = async () => {
    if (creating) return;
    const parsed = parseQuickAdd(q);
    if (!parsed.title.trim()) return;
    setCreating(true);
    try {
      const created = await createFromQuickAdd(parsed);
      // Closes first, so the notice is not covered by the palette.
      onClose();
      afterQuickAdd(created);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setCreating(false);
    }
  };

  const activate = (r: Result) => {
    if (r.group === "create") { void runCreate(); return; }
    if (!r.route) { push("info", r.title); return; }
    navigate(r.route);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(0, rows.length - 1))); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); const r = rows[idx]; if (r) activate(r); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, idx, navigate, onClose]);

  if (!present) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <div className={clsx("absolute inset-0 bg-black/45 backdrop-blur-[2px]", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div className={clsx("relative w-full max-w-xl bg-surface rounded-2xl shadow-pop overflow-hidden will-change-transform", leaving ? "animate-scale-out" : "animate-scale-in")} role="dialog" aria-label="Búsqueda global">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <Search className="w-5 h-5 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar o escribir «reunión mañana a las 10»…" className="flex-1 bg-transparent outline-none text-text text-base placeholder:text-faint" />
          {(busy || creating) && <span className="text-xs text-faint animate-pulse">…</span>}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-surface border border-border text-[10px] text-faint"><CornerDownLeft className="w-3 h-3" />para abrir</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {!q.trim() ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Busca o crea: «tarea urgente mañana» 🔍</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Sin resultados para «{q}»</p>
          ) : (
            <div className="space-y-0.5">
              {rows.map((r, i) => {
                const Icon = ICONS[r.group] ?? Search;
                return (
                  <button key={r.group + r.id} onMouseEnter={() => setIdx(i)} onClick={() => activate(r)}
                    className={clsx("w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", i === idx ? "bg-accent-soft" : "")}>
                    <Icon className="w-4.5 h-4.5 text-muted shrink-0" style={{ width: 18, height: 18 }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-text truncate">{r.title}</span>
                      <span className="block text-[11px] text-faint sentence-case">{r.meta ?? r.group}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
