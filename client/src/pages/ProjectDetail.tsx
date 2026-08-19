import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, ArrowLeft, Trash2, Check } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Project, Task } from "@/lib/types";
import { Spinner, Button, useToast, ConfirmDialog, EmptyState } from "@/components/ui";
import { TaskItem, TaskEditor, ProgressBar } from "@/components/tasks";

export function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const { data, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => http.get<{ project: Project & { tasks: Task[] } }>(`/api/projects/${id}`), enabled: !!id });
  useQuery({ queryKey: ["projects-lite"], queryFn: () => http.get<{ projects: { id: string; name: string }[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });
  const project = data?.project;
  const openTasks = project?.tasks.filter((t) => t.status !== "COMPLETED") ?? [];
  const doneTasks = project?.tasks.filter((t) => t.status === "COMPLETED") ?? [];

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> : !project ? <EmptyState title="Proyecto no encontrado" /> : (
        <>
          <button onClick={() => navigate("/projects")} className="btn-ghost !px-2 mb-3"><ArrowLeft className="w-4 h-4" />Proyectos</button>
          <div className="card p-6 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-2xl grid place-items-center text-white text-lg font-bold" style={{ background: project.color ?? "#6366f1" }}>{project.name[0]}</span>
                <div>
                  <h1 className="text-2xl font-bold text-text tracking-tight">{project.name}</h1>
                  {project.description && <p className="text-sm text-muted mt-0.5">{project.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {project.status === "COMPLETED" && <span className="chip bg-ok/15 text-ok"><Check className="w-3.5 h-3.5" />Completado</span>}
                <Button variant="ghost" size="sm" onClick={() => setDelOpen(true)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex justify-between text-xs text-muted mb-1.5"><span className="font-medium">{project.progress}% completado</span><span>{doneTasks.length}/{project.tasks.length} tareas</span></div>
              <ProgressBar value={project.progress ?? 0} color={project.color ?? undefined} className="h-2" />
            </div>
            <div className="flex gap-2 mt-4">
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Añadir tarea</Button>
            </div>
          </div>

          <div className="space-y-5">
            <section>
              <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Pendientes ({openTasks.length})</h2>
              <div className="card divide-y divide-border/60 px-1">
                {openTasks.length === 0 ? <p className="px-4 py-6 text-sm text-muted text-center">Ninguna tarea pendiente 🎉</p> : openTasks.map((t) => <div key={t.id} className="px-2"><TaskItem task={t} onOpen={setEditing} /></div>)}
              </div>
            </section>
            {doneTasks.length > 0 && (
              <section>
                <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Completadas ({doneTasks.length})</h2>
                <div className="card divide-y divide-border/60 px-1 opacity-70">
                  {doneTasks.map((t) => <div key={t.id} className="px-2"><TaskItem task={t} onOpen={setEditing} /></div>)}
                </div>
              </section>
            )}
          </div>

          <TaskEditor open={createOpen} onClose={() => setCreateOpen(false)} projects={projects} tags={[]} defaultProjectId={project.id} />
          <TaskEditor open={!!editing} onClose={() => setEditing(null)} task={editing} projects={projects} tags={[]} />

          <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} title="Eliminar proyecto" message={`Se moverá «${project.name}» a la papelera. Puedes restaurarlo después.`} onConfirm={async () => { try { await http.del(`/api/projects/${project.id}`); qc.invalidateQueries(); navigate("/projects"); push("success", "Proyecto movido a la papelera"); } catch (e: any) { push("error", e.message); } setDelOpen(false); }} />
        </>
      )}
    </div>
  );
}