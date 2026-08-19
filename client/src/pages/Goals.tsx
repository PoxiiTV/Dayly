import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Goal, Project, Task } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, useToast, ConfirmDialog } from "@/components/ui";
import { TaskItem, TaskEditor, ProgressBar } from "@/components/tasks";
import { relativeDay } from "@/lib/dates";

export function Goals() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);

  const { data, isLoading } = useQuery({ queryKey: ["goals"], queryFn: () => http.get<{ goals: Goal[] }>("/api/goals") });
  const goals = data?.goals ?? [];
  useQuery({ queryKey: ["projects-lite"], queryFn: () => http.get<{ projects: Project[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });

  const create = async () => {
    if (!title.trim()) return;
    try { await http.post("/api/goals", { title: title.trim(), dueDate: due ? new Date(due).toISOString() : null }); setCreateOpen(false); setTitle(""); setDue(""); qc.invalidateQueries({ queryKey: ["goals"] }); push("success", "Objetivo creado"); } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <div><h1 className="text-2xl font-bold text-text tracking-tight">Objetivos</h1><p className="text-muted text-sm">Metas con progreso visual</p></div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo objetivo</Button>
      </div>

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        goals.length === 0 ? <EmptyState icon={<Target className="w-6 h-6" />} title="Define un objetivo" action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear</Button>} /> :
        <div className="space-y-4">
          {goals.map((g) => {
            const done = g.status === "COMPLETED";
            return (
              <div key={g.id} className={clsx("card p-5", done && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {done && <CheckCircle2 className="w-5 h-5 text-ok" />}
                      <h3 className="font-semibold text-text">{g.title}</h3>
                    </div>
                    {g.description && <p className="text-sm text-muted mt-0.5">{g.description}</p>}
                    <div className="flex gap-3 mt-1.5 text-xs text-faint">
                      {g.dueDate && <span>🎯 {relativeDay(g.dueDate)}</span>}
                      {g.tasks && <span>📋 {g.tasks.filter((t) => t.status === "COMPLETED").length}/{g.tasks.length} tareas</span>}
                    </div>
                  </div>
                  <span className={clsx("chip shrink-0", done ? "bg-ok/15 text-ok" : "bg-accent-soft text-accent-strong")}>{g.progress}%</span>
                </div>
                <ProgressBar value={g.progress ?? 0} className="mt-3" />
                {g.tasks && g.tasks.length > 0 && (
                  <div className="mt-3 border-t border-border/60 pt-2 space-y-0.5">
                    {g.tasks.map((t) => <p key={t.id} className={clsx("text-xs py-0.5", t.status === "COMPLETED" ? "line-through text-faint" : "text-muted")}>· {t.title}</p>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo objetivo" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <div className="space-y-4">
          <Input label="Objetivo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Lanzar mi nueva web" autoFocus />
          <Input label="Fecha límite" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}