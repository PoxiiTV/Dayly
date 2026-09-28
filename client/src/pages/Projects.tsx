import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, PanelsTopLeft } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, Segmented, useToast, PageHeader, ColorSwatches } from "@/components/ui";
import { ProgressBar } from "@/components/tasks";
import { relativeDay } from "@/lib/dates";
import { PROJECT_COLORS, PROJECT_STATUSES, projectStatusChipClass, projectStatusLabel, DEFAULT_ENTITY_COLOR } from "@/lib/projects";

export function Projects() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_ENTITY_COLOR);

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
          options={[
            { value: "", label: "Activos" },
            ...PROJECT_STATUSES.filter((s) => s.value !== "ARCHIVED").map((s) => ({ value: s.value, label: s.label })),
            { value: "ARCHIVED", label: "Archivados" },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> :
        projects.length === 0 ? <EmptyState icon={<PanelsTopLeft className="w-6 h-6" />} title={status === "ARCHIVED" ? "Sin proyectos archivados" : "Sin proyectos"} action={status === "ARCHIVED" ? undefined : <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear proyecto</Button>} /> :
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => {
            const pending = p.pendingTasks?.length ?? 0;
            const total = p._count?.tasks ?? pending;
            return (
            <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="card card-interactive p-5 text-left group">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold text-sm shrink-0" style={{ background: p.color ?? DEFAULT_ENTITY_COLOR }}>{p.name[0]}</span>
                <span className={clsx("chip chip-sm", projectStatusChipClass(p.status))}>{projectStatusLabel(p.status)}</span>
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

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo proyecto" size="lg"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <div className="space-y-5">
          <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Renovar web" autoFocus />
          <ColorSwatches colors={PROJECT_COLORS} value={color} onChange={setColor} />
        </div>
      </Modal>
    </div>
  );
}