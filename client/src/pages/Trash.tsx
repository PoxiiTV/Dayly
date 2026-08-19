import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, RotateCcw, ListTodo, CalendarDays, StickyNote, PanelsTopLeft, Target, X } from "lucide-react";
import { http } from "@/lib/api";
import { Spinner, EmptyState, Button, useToast, ConfirmDialog } from "@/components/ui";
import { relativeDay } from "@/lib/dates";

export function Trash() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [confirm, setConfirm] = useState<{ type: string; id: string; title: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["trash"], queryFn: () => http.get<Record<string, { id: string; title?: string; name?: string; deletedAt: string }[]>>("/api/trash") });

  const groups = [
    { key: "tasks", icon: ListTodo, label: "Tareas" },
    { key: "events", icon: CalendarDays, label: "Eventos" },
    { key: "notes", icon: StickyNote, label: "Notas" },
    { key: "projects", icon: PanelsTopLeft, label: "Proyectos" },
    { key: "goals", icon: Target, label: "Objetivos" },
  ];

  const restore = async (type: string, id: string) => {
    try { await http.post("/api/trash/restore", { type, id }); qc.invalidateQueries({ queryKey: ["trash"] }); push("success", "Restaurado"); } catch (e: any) { push("error", e.message); }
  };
  const permanent = async (type: string, id: string) => {
    try {
      const { api } = await import("@/lib/api");
      await api("/api/trash/permanent", { method: "DELETE", body: JSON.stringify({ type, id }) });
      qc.invalidateQueries({ queryKey: ["trash"] }); push("success", "Eliminado para siempre");
    } catch (e: any) { push("error", e.message); }
    setConfirm(null);
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-text tracking-tight mb-5">Papelera</h1>
      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        groups.every((g) => (data?.[g.key] ?? []).length === 0) ? (
          <EmptyState icon={<Trash2 className="w-6 h-6" />} title="La papelera está vacía" hint="Los elementos que elimines podrás restaurarlos aquí." />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const items = data?.[g.key] ?? [];
              if (items.length === 0) return null;
              return (
                <section key={g.key}>
                  <h2 className="text-sm font-semibold text-muted mb-2 flex items-center gap-2"><g.icon className="w-4 h-4" />{g.label} ({items.length})</h2>
                  <div className="card divide-y divide-border/60">
                    {items.map((it) => (
                      <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex-1 text-sm text-text truncate">{it.title ?? it.name}</span>
                        <span className="text-xs text-faint shrink-0">{relativeDay(it.deletedAt)}</span>
                        <button onClick={() => restore(g.key, it.id)} title="Restaurar" className="btn-ghost !p-2 text-ok"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={() => setConfirm({ type: g.key, id: it.id, title: it.title ?? it.name ?? "" })} title="Eliminar para siempre" className="btn-ghost !p-2 text-faint hover:text-danger"><X className="w-4 h-4" /></button>
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