import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, ListTodo, CalendarDays, StickyNote, PanelsTopLeft, Target, Repeat } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useToast, usePresence } from "@/components/ui";

interface Result { id: string; title: string; route: string; group: string; meta?: string; color?: string; }
const ICONS: Record<string, any> = { task: ListTodo, event: CalendarDays, note: StickyNote, project: PanelsTopLeft, goal: Target, habit: Repeat };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const { present, leaving } = usePresence(open);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
            if (group === "habits") { route = `/habits#${r.id}`; }
            flat.push({ id: r.id, title: r.title ?? r.name, route, group: group.slice(0, -1), color: r.color });
          });
        }
        setResults(flat); setIdx(0);
      } catch (e) { push("error", "No se pudo buscar."); }
      finally { if (on) setBusy(false); }
    }, 220);
    return () => { on = false; clearTimeout(t); };
  }, [q, open]);

  // keyboard nav
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); const r = results[idx]; if (r) { navigate(r.route); onClose(); } }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, idx, navigate, onClose]);

  if (!present) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <div className={clsx("absolute inset-0 bg-black/45 backdrop-blur-[2px]", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div className={clsx("relative w-full max-w-xl bg-surface rounded-2xl shadow-pop overflow-hidden will-change-transform", leaving ? "animate-scale-out" : "animate-scale-in")} role="dialog" aria-label="Búsqueda global">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <Search className="w-5 h-5 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tareas, eventos, notas, proyectos…" className="flex-1 bg-transparent outline-none text-text text-base placeholder:text-faint" />
          {busy && <span className="text-xs text-faint animate-pulse">…</span>}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-surface border border-border text-[10px] text-faint"><CornerDownLeft className="w-3 h-3" />para abrir</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {!q.trim() ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Escribe para buscar en toda tu agenda 🔍</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted text-center">Sin resultados para «{q}»</p>
          ) : (
            <div className="space-y-0.5">
              {results.map((r, i) => {
                const Icon = ICONS[r.group] ?? Search;
                return (
                  <button key={r.group + r.id} onMouseEnter={() => setIdx(i)} onClick={() => { if (!r.route) { push("info", r.title); return; } navigate(r.route); onClose(); }}
                    className={clsx("w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", i === idx ? "bg-accent-soft" : "")}>
                    <Icon className="w-4.5 h-4.5 text-muted shrink-0" style={{ width: 18, height: 18 }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-text truncate">{r.title}</span>
                      <span className="block text-[11px] text-faint capitalize">{r.group}</span>
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