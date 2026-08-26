import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, PanelsTopLeft } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, Segmented, useToast, PageHeader } from "@/components/ui";
import { ProgressBar } from "@/components/tasks";
import { relativeDay } from "@/lib/dates";
import { PROJECT_COLORS, PROJECT_STATUSES, projectStatusChipClass, projectStatusLabel } from "@/lib/projects";

export function Projects() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");

  const { data, isLoading } = useQuery({ queryKey: ["projects", status], queryFn: () => http.get<{ projects: Project[] }>("/api/projects", { status: status || undefined }) });
  const projects = (data?.projects ?? []).filter((p) => !status || p.status === status);

  const create = async () => {
    if (!name.trim()) return;
    try { await http.post("/api/projects", { name: name.trim(), color }); setCreateOpen(false); setName(""); qc.invalidateQueries({ queryKey: ["projects"] }); push("success", "Proyecto creado"); } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Proyectos"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo proyecto</Button>}
      />

      <div className="flex items-center gap-2 mb-5 overflow-x-auto no-scrollbar">
        <Segmented
          options={[{ value: "", label: "Todos" }, ...PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        projects.length === 0 ? <EmptyState icon={<PanelsTopLeft className="w-6 h-6" />} title="Sin proyectos" action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear proyecto</Button>} /> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => {
            const pending = p.pendingTasks?.length ?? 0;
            const total = p._count?.tasks ?? pending;
            return (
            <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="card p-5 text-left hover:shadow-pop transition-all group">
              <div className="flex items-center justify-between mb-3">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold text-sm" style={{ background: p.color ?? "#6366f1" }}>{p.name[0]}</span>
                <span className={clsx("text-[10px] px-2 py-0.5 rounded-full", projectStatusChipClass(p.status))}>{projectStatusLabel(p.status)}</span>
              </div>
              <h3 className="font-semibold text-text truncate group-hover:text-accent transition-colors">{p.name}</h3>
              {p.description && <p className="text-xs text-muted mt-1 line-clamp-2">{p.description}</p>}
              <p className="text-[11px] text-muted mt-3">Pendientes {pending}/{total}</p>
              <div className="mt-2">
                <div className="flex justify-between mb-1.5 text-[11px] text-muted"><span>{p.progress ?? 0}%</span>{p.dueDate && <span>Fin: {relativeDay(p.dueDate)}</span>}</div>
                <ProgressBar value={p.progress ?? 0} />
              </div>
            </button>
            );
          })}
        </div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo proyecto"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Renovar web" autoFocus />
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2 py-0.5">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} className={"w-8 h-8 rounded-full transition-transform " + (color === c ? "ring-2 ring-offset-2 ring-offset-surface ring-text scale-110" : "hover:scale-105")} style={{ background: c }} />
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}