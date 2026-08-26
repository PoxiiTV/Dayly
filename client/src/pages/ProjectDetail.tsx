import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, ArrowLeft, Trash2, Pencil, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Project, ProjectStatus, Task } from "@/lib/types";
import { Spinner, Button, Input, Textarea, Select, Modal, useToast, ConfirmDialog, EmptyState } from "@/components/ui";
import { TaskEditor, ProgressBar, SortableTaskList } from "@/components/tasks";
import { PROJECT_COLORS, PROJECT_STATUSES, projectStatusChipClass, projectStatusDotClass, projectStatusLabel } from "@/lib/projects";

function toDateInput(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function ProjectStatusChip({ value, onChange }: { value: ProjectStatus; onChange: (s: ProjectStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Estado del proyecto"
        onClick={() => setOpen((v) => !v)}
        className={clsx("inline-flex items-center gap-1 text-[11px] font-medium rounded-full pl-2.5 pr-1.5 py-1", projectStatusChipClass(value))}
      >
        {projectStatusLabel(value)}
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-full mt-1 z-50 min-w-[11rem] rounded-xl border border-border bg-surface shadow-pop py-1">
          {PROJECT_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="option"
              aria-selected={s.value === value}
              onClick={() => { onChange(s.value); setOpen(false); }}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text hover:bg-elevated",
                s.value === value && "font-medium",
              )}
            >
              <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", projectStatusDotClass(s.value))} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorNonce, setEditorNonce] = useState(0);
  const [delOpen, setDelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState("#6366f1");
  const [editStatus, setEditStatus] = useState<ProjectStatus>("ACTIVE");
  const [editStart, setEditStart] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => http.get<{ project: Project & { tasks: Task[] } }>(`/api/projects/${id}`), enabled: !!id });
  useQuery({ queryKey: ["projects-lite"], queryFn: () => http.get<{ projects: { id: string; name: string }[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });
  const project = data?.project;
  const openTasks = useMemo(
    () => [...(project?.tasks.filter((t) => t.status !== "COMPLETED") ?? [])]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)),
    [project?.tasks],
  );
  const doneTasks = useMemo(
    () => [...(project?.tasks.filter((t) => t.status === "COMPLETED") ?? [])]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt)),
    [project?.tasks],
  );

  const reorderTasks = useCallback(async (ids: string[]) => {
    if (!id) return;
    qc.setQueryData(["project", id], (old: { project: Project & { tasks: Task[] } } | undefined) => {
      if (!old) return old;
      const tasks = old.project.tasks.map((t) => {
        const i = ids.indexOf(t.id);
        return i >= 0 ? { ...t, sortOrder: i } : t;
      });
      return { ...old, project: { ...old.project, tasks } };
    });
    try {
      await http.patch(`/api/projects/${id}/tasks/reorder`, { ids });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo reordenar.");
      void qc.invalidateQueries({ queryKey: ["project", id] });
    }
  }, [id, qc, push]);

  const openEdit = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description ?? "");
    setEditColor(project.color ?? "#6366f1");
    setEditStatus(project.status);
    setEditStart(toDateInput(project.startDate));
    setEditDue(toDateInput(project.dueDate));
    setEditOpen(true);
  };

  const saveProject = async () => {
    if (!project || !editName.trim()) { push("error", "Escribe un nombre."); return; }
    setEditBusy(true);
    try {
      await http.patch(`/api/projects/${project.id}`, {
        name: editName.trim(),
        description: editDesc.trim() || null,
        color: editColor,
        status: editStatus,
        startDate: editStart || null,
        dueDate: editDue || null,
      });
      setEditOpen(false);
      void qc.invalidateQueries({ queryKey: ["project", id] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      push("success", "Proyecto actualizado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setEditBusy(false);
    }
  };

  const changeStatus = async (status: ProjectStatus) => {
    if (!project || status === project.status) return;
    try {
      await http.patch(`/api/projects/${project.id}`, { status });
      void qc.invalidateQueries({ queryKey: ["project", id] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar el estado.");
    }
  };

  return (
    <div className="page-shell">
      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> : !project ? <EmptyState title="Proyecto no encontrado" /> : (
        <>
          <button onClick={() => navigate("/projects")} className="btn-ghost !px-2 mb-2"><ArrowLeft className="w-4 h-4" />Proyectos</button>
          <div className="card px-4 py-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-xl grid place-items-center text-white text-sm font-bold shrink-0" style={{ background: project.color ?? "#6366f1" }}>{project.name[0]}</span>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold text-text tracking-tight truncate">{project.name}</h1>
                {project.description && <p className="text-xs text-muted line-clamp-1">{project.description}</p>}
              </div>
              <ProjectStatusChip value={project.status} onChange={(s) => void changeStatus(s)} />
              <Button variant="ghost" size="sm" onClick={openEdit} aria-label="Editar proyecto"><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setDelOpen(true)} aria-label="Eliminar proyecto"><Trash2 className="w-4 h-4" /></Button>
            </div>
            <div className="flex items-center gap-3 mt-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-[11px] text-muted mb-1">
                  <span>{project.progress ?? 0}% · {doneTasks.length}/{project.tasks.length} tareas</span>
                </div>
                <ProgressBar value={project.progress ?? 0} className="h-1" />
              </div>
              <Button size="sm" onClick={() => { setEditing(null); setEditorNonce((n) => n + 1); setCreateOpen(true); }}><Plus className="w-4 h-4" />Añadir tarea</Button>
            </div>
          </div>

          <div className="space-y-5">
            <section>
              <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Pendientes ({openTasks.length})</h2>
              <div className="card divide-y divide-border/60 px-1 overflow-visible">
                {openTasks.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted text-center">Ninguna tarea pendiente</p>
                ) : (
                  <SortableTaskList
                    tasks={openTasks}
                    onOpen={(task) => { setCreateOpen(false); setEditing(task); }}
                    onReorder={reorderTasks}
                  />
                )}
              </div>
            </section>
            {doneTasks.length > 0 && (
              <section>
                <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Completadas ({doneTasks.length})</h2>
                <div className="card divide-y divide-border/60 px-1 overflow-visible opacity-70">
                  <SortableTaskList
                    tasks={doneTasks}
                    onOpen={(task) => { setCreateOpen(false); setEditing(task); }}
                    onReorder={reorderTasks}
                  />
                </div>
              </section>
            )}
          </div>

          <TaskEditor
            key={editing?.id ?? `new-${editorNonce}`}
            open={createOpen || !!editing}
            onClose={() => { setCreateOpen(false); setEditing(null); }}
            task={editing}
            projects={projects}
            tags={[]}
            defaultProjectId={project.id}
          />

          <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar proyecto"
            footer={<><Button variant="secondary" onClick={() => setEditOpen(false)}>Cancelar</Button><Button onClick={() => void saveProject()} disabled={editBusy}>{editBusy ? <Spinner /> : "Guardar"}</Button></>}>
            <Input label="Nombre" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            <Textarea label="Descripción" rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Para qué es este proyecto…" />
            <div>
              <label className="label">Color</label>
              <div className="flex flex-wrap gap-2 py-0.5">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setEditColor(c)} className={"w-8 h-8 rounded-full transition-transform " + (editColor === c ? "ring-2 ring-offset-2 ring-offset-surface ring-text scale-110" : "hover:scale-105")} style={{ background: c }} />
                ))}
              </div>
            </div>
            <Select label="Estado" value={editStatus} onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <div className="modal-grid">
              <Input label="Inicio" type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
              <Input label="Fecha límite" type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
            </div>
          </Modal>

          <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} title="Eliminar proyecto" message={`Se moverá «${project.name}» a la papelera. Puedes restaurarlo después.`} onConfirm={async () => { try { await http.del(`/api/projects/${project.id}`); qc.invalidateQueries(); navigate("/projects"); push("success", "Proyecto movido a la papelera"); } catch (e: unknown) { push("error", e instanceof Error ? e.message : "Error"); } setDelOpen(false); }} />
        </>
      )}
    </div>
  );
}
