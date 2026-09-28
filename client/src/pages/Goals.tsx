import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, CheckCircle2, Pencil } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Goal, Project, Task } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Textarea, Checkbox, Modal, useToast, PageHeader, Segmented, ChoiceChips, ProjectChips } from "@/components/ui";
import { ProgressBar } from "@/components/tasks";
import { Habits } from "@/pages/Habits";

type GoalDraft = {
  title: string;
  description: string;
  dueDate: string;
  status: Goal["status"];
  projectId: string;
  taskIds: string[];
};

const GOAL_STATUS_OPTIONS: { value: Goal["status"]; label: string }[] = [
  { value: "PENDING", label: "Pendiente" },
  { value: "IN_PROGRESS", label: "En progreso" },
  { value: "POSTPONED", label: "Pospuesto" },
  { value: "COMPLETED", label: "Completado" },
  { value: "CANCELLED", label: "Cancelado" },
];

function draftFrom(goal?: Goal | null): GoalDraft {
  return {
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    dueDate: goal?.dueDate ? goal.dueDate.slice(0, 10) : "",
    status: goal?.status ?? "PENDING",
    projectId: goal?.projectId ?? "",
    taskIds: goal?.tasks?.map((task) => task.id) ?? [],
  };
}

/** `dueDate` arrives as a full ISO instant; only its calendar day is meaningful. */
function daysUntil(dueDate: string): number | null {
  const target = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function deadlineLabel(remaining: number): string {
  if (remaining === 0) return "Vence hoy";
  if (remaining === 1) return "Falta 1 día";
  if (remaining > 1) return `Faltan ${remaining} días`;
  const late = Math.abs(remaining);
  return late === 1 ? "Vencido hace 1 día" : `Vencido hace ${late} días`;
}

export function Goals() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "habits" ? "habits" : "goals";
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(() => draftFrom(null));
  const [projects, setProjects] = useState<Project[]>([]);
  const [habitCreate, setHabitCreate] = useState(0);

  const { data, isLoading } = useQuery({ queryKey: ["goals"], queryFn: () => http.get<{ goals: Goal[] }>("/api/goals") });
  const goals = data?.goals ?? [];
  const { data: taskData } = useQuery({ queryKey: ["goals", "task-options"], queryFn: () => http.get<{ tasks: Task[] }>("/api/tasks", { includeCompleted: "true" }) });
  const tasks = taskData?.tasks ?? [];
  useQuery({ queryKey: ["projects-lite"], queryFn: () => http.get<{ projects: Project[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });

  const openEditor = (goal?: Goal) => {
    setEditing(goal ?? null);
    setDraft(draftFrom(goal));
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.title.trim()) { push("error", "Escribe un objetivo."); return; }
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      dueDate: draft.dueDate ? new Date(`${draft.dueDate}T12:00:00`).toISOString() : null,
      status: draft.status,
      projectId: draft.projectId || null,
      taskIds: draft.taskIds,
    };
    try {
      if (editing) await http.patch(`/api/goals/${editing.id}`, payload);
      else await http.post("/api/goals", payload);
      setEditing(null);
      setEditorOpen(false);
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      push("success", editing ? "Objetivo actualizado" : "Objetivo creado");
    } catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo guardar el objetivo."); }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Hábitos & Objetivos"
        lead="Metas, rachas y constancia"
        actions={tab === "goals"
          ? <Button className="min-w-[10.5rem]" onClick={() => openEditor()}><Plus className="w-4 h-4" />Nuevo objetivo</Button>
          : <Button className="min-w-[10.5rem]" onClick={() => setHabitCreate((n) => n + 1)}><Plus className="w-4 h-4" />Nuevo hábito</Button>}
      />
      <Segmented
        options={[{ value: "goals", label: "Objetivos" }, { value: "habits", label: "Hábitos" }]}
        value={tab}
        onChange={(v) => setParams(v === "habits" ? { tab: "habits" } : {}, { replace: true })}
        className="mb-5"
      />

      {tab === "habits" ? <Habits embedded createSignal={habitCreate} /> : isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> :
        goals.length === 0 ? <EmptyState icon={<Target className="w-6 h-6" />} title="Define un objetivo" action={<Button onClick={() => openEditor()}><Plus className="w-4 h-4" />Crear</Button>} /> :
        <div className="space-y-4">
          {goals.map((g) => {
            const done = g.status === "COMPLETED";
            const taskCount = g.tasks?.length ?? 0;
            const progress = taskCount > 0 ? Math.min(100, Math.max(0, g.progress ?? 0)) : null;
            const remaining = g.dueDate ? daysUntil(g.dueDate) : null;
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
                      {remaining !== null && <span>🎯 {deadlineLabel(remaining)}</span>}
                      {taskCount > 0 && <span>📋 {g.tasks!.filter((t) => t.status === "COMPLETED").length}/{taskCount} tareas</span>}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => openEditor(g)} aria-label={`Editar objetivo ${g.title}`}><Pencil className="w-4 h-4" /></Button>
                </div>
                {progress !== null && <ProgressBar value={progress} className="mt-3" />}
                {taskCount > 0 && (
                  <div className="mt-3 border-t border-border/60 pt-2 space-y-0.5">
                    {g.tasks!.map((t) => <p key={t.id} className={clsx("text-xs py-0.5", t.status === "COMPLETED" ? "line-through text-faint" : "text-muted")}>· {t.title}</p>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>}

      <Modal open={editorOpen} onClose={() => { setEditorOpen(false); setEditing(null); }} title={editing ? "Editar objetivo" : "Nuevo objetivo"} size="lg"
        footer={<><Button variant="secondary" onClick={() => { setEditorOpen(false); setEditing(null); }}>Cancelar</Button><Button onClick={() => void save()}>{editing ? "Guardar" : "Crear"}</Button></>}>
        <div className="space-y-5">
          <Input label="Objetivo" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ej. Lanzar mi nueva web" autoFocus />
          <Textarea label="Descripción" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Qué quieres conseguir…" className="min-h-[5rem]" />
          <Input label="Fecha objetivo" type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
          <ChoiceChips label="Estado" value={draft.status} onChange={(status) => setDraft({ ...draft, status })} options={GOAL_STATUS_OPTIONS} />
          <ProjectChips value={draft.projectId || null} onChange={(id) => setDraft({ ...draft, projectId: id ?? "" })} projects={projects} />
          <div className="space-y-1.5">
            <span className="label">Tareas asignadas</span>
            <div className="max-h-40 overflow-y-auto space-y-2 rounded-xl border border-border p-3">
              {tasks.length === 0 ? <p className="text-sm text-muted">No hay tareas disponibles.</p> : tasks.map((task) => (
                <Checkbox key={task.id} checked={draft.taskIds.includes(task.id)} onChange={(checked) => setDraft({ ...draft, taskIds: checked ? [...draft.taskIds, task.id] : draft.taskIds.filter((id) => id !== task.id) })} label={`${task.title}${task.status === "COMPLETED" ? " · completada" : ""}`} />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}