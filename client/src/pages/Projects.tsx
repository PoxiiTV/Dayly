import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, PanelsTopLeft, MoreHorizontal } from "lucide-react";
import { http } from "@/lib/api";
import type { Project, ProjectStatus } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, Segmented, useToast, ConfirmDialog } from "@/components/ui";
import { ProgressBar, TaskItem } from "@/components/tasks";
import { relativeDay } from "@/lib/dates";

const STATUS: { value: ProjectStatus; label: string }[] = [
  { value: "PLANNING", label: "Planificación" }, { value: "ACTIVE", label: "Activo" }, { value: "PAUSED", label: "En pausa" }, { value: "COMPLETED", label: "Completado" }, { value: "ARCHIVED", label: "Archivado" },
];
const STATUS_COLOR: Record<string, string> = { ACTIVE: "bg-accent", PLANNING: "bg-warn", PAUSED: "bg-faint", COMPLETED: "bg-ok", ARCHIVED: "bg-border" };

export function Projects() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");

  const { data, isLoading } = useQuery({ queryKey: ["projects", status], queryFn: () => http.get<{ projects: Project[] }>("/api/projects", { status: status || undefined }) });
  const projects = data?.projects ?? [];

  const create = async () => {
    if (!name.trim()) return;
    try { await http.post("/api/projects", { name: name.trim(), color }); setCreateOpen(false); setName(""); qc.invalidateQueries({ queryKey: ["projects"] }); push("success", "Proyecto creado"); } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-text tracking-tight">Proyectos</h1>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo proyecto</Button>
      </div>

      <div className="flex items-center gap-2 mb-5 overflow-x-auto no-scrollbar">
        <Segmented options={[{ value: "", label: "Todos" }, ...STATUS.map((s) => ({ value: s.value, label: s.label }))]} value={status as "ACTIVE"} onChange={setStatus} />
      </div>

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        projects.length === 0 ? <EmptyState icon={<PanelsTopLeft className="w-6 h-6" />} title="Sin proyectos" action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear proyecto</Button>} /> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="card p-5 text-left hover:shadow-pop transition-all group">
              <div className="flex items-center justify-between mb-3">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold text-sm" style={{ background: p.color ?? "#6366f1" }}>{p.name[0]}</span>
                <span className={"text-[10px] px-2 py-0.5 rounded-full " + (p.status === "ACTIVE" ? "bg-accent-soft text-accent-strong" : "bg-surface border border-border text-muted")}>{STATUS.find((s) => s.value === p.status)?.label}</span>
              </div>
              <h3 className="font-semibold text-text truncate group-hover:text-accent transition-colors">{p.name}</h3>
              {p.description && <p className="text-xs text-muted mt-1 line-clamp-2">{p.description}</p>}
              <div className="mt-4">
                <div className="flex justify-between mb-1.5 text-[11px] text-muted"><span>{p.progress ?? 0}%</span>{p.dueDate && <span>Fin: {relativeDay(p.dueDate)}</span>}</div>
                <ProgressBar value={p.progress ?? 0} color={p.color ?? undefined} />
              </div>
            </button>
          ))}
        </div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo proyecto" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <div className="space-y-4">
          <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Renovar web" autoFocus />
          <div><label className="label">Color</label>
            <div className="flex gap-2">
              {["#6366f1", "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"].map((c) => (
                <button key={c} onClick={() => setColor(c)} className={"w-8 h-8 rounded-full transition-transform " + (color === c ? "ring-2 ring-offset-2 ring-text scale-110" : "hover:scale-105")} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}