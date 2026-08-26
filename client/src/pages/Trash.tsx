import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, RotateCcw, ListTodo, CalendarDays, StickyNote, PanelsTopLeft, Target, X } from "lucide-react";
import { api, http } from "@/lib/api";
import { Spinner, EmptyState, useToast, ConfirmDialog, PageHeader } from "@/components/ui";
import { relativeDay } from "@/lib/dates";
import type { TrashType } from "@attachment-policy";

const GROUPS: { list: string; type: TrashType; icon: typeof ListTodo; label: string }[] = [
  { list: "tasks", type: "task", icon: ListTodo, label: "Tareas" },
  { list: "events", type: "event", icon: CalendarDays, label: "Eventos" },
  { list: "notes", type: "note", icon: StickyNote, label: "Notas" },
  { list: "projects", type: "project", icon: PanelsTopLeft, label: "Proyectos" },
  { list: "goals", type: "goal", icon: Target, label: "Objetivos" },
];

function queriesAfterRestore(type: TrashType): string[] {
  switch (type) {
    case "task": return ["tasks", "dashboard", "myday", "calendar", "project", "stats", "search"];
    case "event": return ["calendar", "dashboard", "myday", "search"];
    case "note": return ["notes", "search"];
    case "project": return ["projects", "projects-lite", "project", "tasks", "goals", "search"];
    case "goal": return ["goals", "search"];
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

export function Trash() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [confirm, setConfirm] = useState<{ type: TrashType; id: string; title: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["trash"], queryFn: () => http.get<Record<string, { id: string; title?: string; name?: string; deletedAt: string }[]>>("/api/trash") });

  const refreshLists = async (type: TrashType) => {
    await qc.invalidateQueries({ queryKey: ["trash"] });
    await Promise.all(queriesAfterRestore(type).map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };

  const restore = async (type: TrashType, id: string) => {
    try {
      await http.post("/api/trash/restore", { type, id });
      await refreshLists(type);
      push("success", "Restaurado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "Error");
    }
  };
  const permanent = async (type: TrashType, id: string) => {
    try {
      await api("/api/trash/permanent", { method: "DELETE", body: JSON.stringify({ type, id }) });
      qc.invalidateQueries({ queryKey: ["trash"] });
      push("success", "Eliminado para siempre");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "Error");
    }
    setConfirm(null);
  };

  return (
    <div className="page-shell">
      <PageHeader title="Papelera" />
      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        GROUPS.every((g) => (data?.[g.list] ?? []).length === 0) ? (
          <EmptyState icon={<Trash2 className="w-6 h-6" />} title="La papelera está vacía" hint="Los elementos que elimines podrás restaurarlos aquí." />
        ) : (
          <div className="space-y-5">
            {GROUPS.map((g) => {
              const items = data?.[g.list] ?? [];
              if (items.length === 0) return null;
              return (
                <section key={g.list}>
                  <h2 className="text-sm font-semibold text-muted mb-2 flex items-center gap-2"><g.icon className="w-4 h-4" />{g.label} ({items.length})</h2>
                  <div className="card divide-y divide-border/60">
                    {items.map((it) => (
                      <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex-1 text-sm text-text truncate">{it.title ?? it.name}</span>
                        <span className="text-xs text-faint shrink-0">{relativeDay(it.deletedAt)}</span>
                        <button onClick={() => restore(g.type, it.id)} title="Restaurar" className="btn-ghost !p-2 text-ok"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={() => setConfirm({ type: g.type, id: it.id, title: it.title ?? it.name ?? "" })} title="Eliminar para siempre" className="btn-ghost !p-2 text-faint hover:text-danger"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title="Eliminar definitivamente" message={`Se borrará «${confirm?.title}» para siempre. Esta acción no se puede deshacer.`} onConfirm={() => confirm && permanent(confirm.type, confirm.id)} />
    </div>
  );
}
