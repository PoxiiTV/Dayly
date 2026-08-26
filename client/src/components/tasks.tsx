import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Check, GripVertical, Paperclip } from "lucide-react";
import clsx from "clsx";
import { Button, Input, Textarea, Modal, Select, Checkbox, useToast, PriorityDot, Spinner } from "@/components/ui";
import { relativeDay, fmtTime, PRIORITY_LABEL } from "@/lib/dates";
import { http, getAttachmentBlob } from "@/lib/api";
import { flyTaskRow, burstConfetti } from "@/lib/flip";
import type { Project, Task, TaskAttachment, Priority, TaskStatus, Subtask } from "@/lib/types";
import { AttachmentStrip } from "@/components/AttachmentStrip";
import {
  MAX_ATTACHMENTS_PER_TASK,
  countAttachments,
  isPreviewableImage,
  resolveAllowedMime,
  uploadAttachments,
  validateAttachmentFile,
  type PendingAttachment,
} from "@/lib/attachments";

const inv = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries();

type ProjectBundle = { project: Project & { tasks: Task[] } };

function applyTaskStatus(qc: ReturnType<typeof useQueryClient>, task: Task, status: TaskStatus) {
  const completedAt = status === "COMPLETED" ? new Date().toISOString() : null;
  const patch = (t: Task): Task => (t.id !== task.id ? t : { ...t, status, completedAt });
  qc.setQueriesData<ProjectBundle>({ queryKey: ["project"] }, (old) => {
    if (!old?.project?.tasks?.some((t) => t.id === task.id)) return old;
    const tasks = old.project.tasks.map(patch);
    const total = tasks.length;
    const doneCount = tasks.filter((t) => t.status === "COMPLETED").length;
    return {
      ...old,
      project: {
        ...old.project,
        tasks,
        progress: total ? Math.round((doneCount / total) * 100) : old.project.progress,
      },
    };
  });
  qc.setQueriesData<{ tasks: Task[] }>({ queryKey: ["tasks"] }, (old) => {
    if (!old?.tasks) return old;
    return { ...old, tasks: old.tasks.map(patch) };
  });
  qc.setQueriesData<{ important?: Task[]; upcoming?: Task[]; today?: Task[] }>({ queryKey: ["tasks", "smart"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      important: old.important?.map(patch),
      upcoming: old.upcoming?.map(patch),
      today: old.today?.map(patch),
    };
  });
}

/* ---------------- Progress bar ---------------- */
export function ProgressBar({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={clsx("h-1.5 rounded-full bg-border/60 overflow-hidden", className)}>
      <div
        className={clsx("h-full rounded-full transition-all duration-500", !color && "bg-ok")}
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
      />
    </div>
  );
}

/* ---------------- TaskItem ---------------- */
export function TaskItem({ task, onOpen, compact, onToggle, sortable, completeMotion = "fly" }: {
  task: Task; onOpen?: (t: Task) => void; compact?: boolean; onToggle?: (t: Task) => void; sortable?: boolean;
  completeMotion?: "fly" | "celebrate";
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggling = useRef(false);
  const done = task.status === "COMPLETED";

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggle) { onToggle(task); return; }
    if (toggling.current) return;
    toggling.current = true;
    const next: TaskStatus = done ? "PENDING" : "COMPLETED";
    try {
      const row = rootRef.current;
      if (completeMotion === "celebrate") {
        applyTaskStatus(qc, task, next);
        if (!done && row) burstConfetti(row);
      } else if (row) {
        await flyTaskRow(row, task.id, () => applyTaskStatus(qc, task, next));
      } else {
        applyTaskStatus(qc, task, next);
      }
      if (!done) {
        await http.post(`/api/tasks/${task.id}/complete`);
        push("success", "¡Tarea completada! 🎉");
      } else {
        await http.patch(`/api/tasks/${task.id}`, { status: "PENDING" });
      }
      if (completeMotion === "celebrate" && !done) {
        await new Promise((r) => setTimeout(r, 1050));
      }
      inv(qc);
    } catch (err: unknown) {
      applyTaskStatus(qc, task, task.status);
      push("error", err instanceof Error ? err.message : "Error");
      inv(qc);
    } finally {
      toggling.current = false;
    }
  };

  const hasFiles = (task.attachments?.length ?? 0) > 0;
  const overdue = task.dueDate && !done && new Date(task.dueDate).getTime() < Date.now() && task.hasTime;
  const dueToday = task.dueDate && !done && relativeDay(task.dueDate) === "Hoy";

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      data-flip-key={task.id}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(task);
        }
      }}
      className={clsx("w-full flex items-start gap-3 text-left group rounded-xl transition-colors hover:bg-surface px-2 py-2 -mx-2 cursor-pointer", done && "opacity-70")}
    >
      <PriorityDot p={task.priority} className="w-2.5 h-2.5 mt-1.5" />
      {sortable && (
        <span
          data-drag-handle
          role="button"
          tabIndex={0}
          aria-label="Reordenar tarea"
          className="mt-0.5 p-0.5 text-faint hover:text-muted cursor-grab active:cursor-grabbing touch-none shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 pointer-events-none" />
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={done ? "Marcar como pendiente" : "Completar tarea"}
        className="relative shrink-0 -my-1.5 -mx-1 p-2.5 grid place-items-center rounded-lg"
      >
        <span
          className={clsx(
            "w-5 h-5 rounded-full border-2 grid place-items-center pointer-events-none transition-colors",
            done ? "bg-accent border-accent text-white" : "border-border group-hover:border-accent",
          )}
        >
          {done && <Check className="w-3 h-3" strokeWidth={3.5} />}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <p className={clsx("text-sm text-text flex items-center gap-1.5 min-w-0", done && "line-through text-faint")}>
          <span className="truncate">{task.title}</span>
          {hasFiles && <Paperclip className="w-3.5 h-3.5 text-faint shrink-0" aria-label="Tiene adjuntos" />}
        </p>
        {(task.dueDate || compact === false) && (
          <div className={clsx("flex flex-wrap items-center gap-2 mt-1 text-xs", !compact && "space-y-0")}>
            {task.dueDate && (
              <span className={clsx("inline-flex items-center gap-1", overdue ? "text-danger" : dueToday ? "text-warn" : "text-faint")}>
                <CalendarDays className="w-3 h-3" />{relativeDay(task.dueDate)}{task.hasTime ? " · " + fmtTime(task.dueDate) : ""}
              </span>
            )}
            <span className="text-faint">{PRIORITY_LABEL[task.priority]}</span>
            {task.project && <span className="chip !px-1.5 !py-0.5" style={{ background: "color-mix(in srgb, " + (task.project.color ?? "#3b82f6") + "22, transparent)" }}> <span className="w-1.5 h-1.5 rounded-full" style={{ background: task.project.color ?? "#3b82f6" }} />{task.project.name}</span>}
            {(task.subtasks ?? []).length > 0 && <span className="text-faint">{task.subtasks?.filter((s) => s.done).length}/{task.subtasks?.length}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Lista de pendientes reordenable (arrastrar el asa). */
export function SortableTaskList({ tasks, onOpen, onReorder }: {
  tasks: Task[];
  onOpen: (t: Task) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [dragItems, setDragItems] = useState<Task[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = dragItems ?? tasks;
  const itemsRef = useRef(items);
  const draggingId = useRef<string | null>(null);
  const originIds = useRef<string[] | null>(null);
  const skipClick = useRef(false);

  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingId.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest("[data-task-id]") as HTMLElement | null;
      if (!row || !rootRef.current?.contains(row)) return;
      const overId = row.dataset.taskId;
      if (!overId || overId === draggingId.current) return;
      setDragItems((prev) => {
        const list = prev ?? itemsRef.current;
        const from = list.findIndex((t) => t.id === draggingId.current);
        const to = list.findIndex((t) => t.id === overId);
        if (from < 0 || to < 0 || from === to) return list;
        return moveItem(list, from, to);
      });
    };
    const onUp = () => {
      if (!draggingId.current) return;
      skipClick.current = true;
      draggingId.current = null;
      setActiveId(null);
      const started = originIds.current;
      originIds.current = null;
      const ids = itemsRef.current.map((t) => t.id);
      setDragItems(null);
      if (started && ids.some((id, i) => id !== started[i])) onReorder(ids);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onReorder]);

  if (items.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted text-center">Ninguna tarea pendiente</p>;
  }

  return (
    <div ref={rootRef} className="divide-y divide-border/60">
      {items.map((t) => (
        <div
          key={t.id}
          data-task-id={t.id}
          className={clsx("px-2", activeId === t.id && "opacity-60")}
          onPointerDown={(e) => {
            const handle = (e.target as HTMLElement).closest("[data-drag-handle]");
            if (!handle) return;
            e.preventDefault();
            e.stopPropagation();
            draggingId.current = t.id;
            originIds.current = itemsRef.current.map((x) => x.id);
            setDragItems(itemsRef.current);
            setActiveId(t.id);
          }}
        >
          <TaskItem
            task={t}
            sortable
            onOpen={(task) => {
              if (skipClick.current) { skipClick.current = false; return; }
              onOpen(task);
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* ---------------- TaskEditor ---------------- */
export interface TaskDraft {
  id?: string;
  title: string; description?: string; dueDate?: string | null; hasTime?: boolean;
  priority: Priority; status?: TaskStatus; projectId?: string | null; estimateMinutes?: number | null;
  notes?: string; tagIds?: string[];
}

function draftFrom(task: Task | null | undefined, defaultProjectId?: string | null): TaskDraft {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    dueDate: task?.dueDate ?? null,
    hasTime: task?.hasTime ?? true,
    priority: task?.priority ?? "NORMAL",
    status: task?.status ?? "PENDING",
    projectId: task?.projectId ?? defaultProjectId ?? null,
    estimateMinutes: task?.estimateMinutes ?? null,
    notes: task?.notes ?? "",
    tagIds: task?.tags?.map((t) => t.id) ?? [],
  };
}

export function TaskEditor({ open, onClose, task, projects, tags, defaultProjectId }: {
  open: boolean; onClose: () => void; task?: Task | null; projects: { id: string; name: string; color?: string | null }[]; tags: { id: string; name: string; color?: string | null }[]; defaultProjectId?: string | null; now?: boolean;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<TaskDraft>(() => draftFrom(task, defaultProjectId));
  const [subs, setSubs] = useState<{ title: string }[]>([]);
  // Authoritative subtask state lives in a ref; `savedSubs` mirrors it for
  // rendering. This makes toggles immune to stale closures, double-fired
  // label/button click synthesis, and React StrictMode double-invocation.
  const subsRef = useRef<Subtask[]>(task?.subtasks ?? []);
  const [savedSubs, setSavedSubs] = useState<Subtask[]>(() => task?.subtasks ?? []);
  const [newSub, setNewSub] = useState("");
  const [freq, setFreq] = useState("");
  const [existing, setExisting] = useState<TaskAttachment[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const resetForm = (source?: Task | null) => {
    setD(draftFrom(source, defaultProjectId));
    setSubs([]);
    setNewSub("");
    subsRef.current = source?.subtasks ?? [];
    setSavedSubs(source?.subtasks ?? []);
    setFreq(String((source?.recurrence as { frequency?: string } | undefined)?.frequency ?? ""));
    setExisting(source?.attachments ?? []);
    setPending((prev) => {
      for (const p of prev) if (p.preview) URL.revokeObjectURL(p.preview);
      return [];
    });
    setRemoved([]);
  };

  useEffect(() => {
    if (!open) {
      resetForm(null);
      return;
    }
    resetForm(task);
  }, [open, task?.id, defaultProjectId]);

  // Sync server-backed queries when the editor closes so reopening this task
  // reflects subtask toggles/deletes made while it was open (`editing` holds
  // a stale snapshot otherwise).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) inv(qc);
    wasOpen.current = open;
  }, [open, qc]);

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    const images = existing.filter((a) => isPreviewableImage(a.mimeType) && task?.id && !removed.includes(a.id));
    if (!task?.id || images.length === 0) { setPreviews({}); return; }
    void Promise.all(images.map(async (a) => {
      try {
        const blob = await getAttachmentBlob(task.id, a.id);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return [a.id, url] as const;
      } catch {
        return null;
      }
    })).then((pairs) => {
      if (cancelled) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      setPreviews(next);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [task?.id, existing, removed]);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...pending];
    for (const file of Array.from(list)) {
      const err = await validateAttachmentFile(file, "task");
      if (err) { push("error", err); continue; }
      if (countAttachments(existing, next, removed) >= MAX_ATTACHMENTS_PER_TASK) {
        push("error", "Máximo 5 archivos por tarea.");
        break;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const mime = resolveAllowedMime(buf, file.name, "task");
      const preview = mime && isPreviewableImage(mime) ? URL.createObjectURL(file) : null;
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file, preview });
    }
    setPending(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (!d.title.trim()) { push("error", "Escribe un título."); return; }
    setBusy(true);
    const payload = {
      title: d.title.trim(), description: d.description || null, dueDate: d.dueDate || null, hasTime: d.hasTime,
      priority: d.priority, status: d.status, projectId: d.projectId || null, estimateMinutes: d.estimateMinutes ?? null,
      notes: d.notes || null, tagIds: d.tagIds,
      recurrence: freq ? { frequency: freq, interval: 1 } : null,
    };
    try {
      let taskId = task?.id;
      if (task) {
        await http.patch(`/api/tasks/${task.id}`, payload);
        for (const s of subs.filter((x) => x.title.trim())) {
          await http.post(`/api/tasks/${task.id}/subtasks`, { title: s.title.trim() });
        }
      } else {
        const created = await http.post<{ task: Task }>("/api/tasks", { ...payload, subtasks: subs.map((s) => ({ title: s.title })).filter((s) => s.title.trim()) });
        taskId = created.task.id;
      }
      if (!taskId) throw new Error("No se pudo guardar.");
      for (const id of removed) {
        await http.del(`/api/tasks/${taskId}/attachments/${id}`);
      }
      await uploadAttachments("task", taskId, pending.map((p) => p.file));
      push("success", task ? "Tarea actualizada" : "Tarea creada");
      resetForm(null);
      inv(qc); onClose();
    } catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={task ? "Editar tarea" : "Nueva tarea"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button></>}>
      {tags.length > 0 && (
        <div>
          <span className="label">Etiquetas</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t.id} type="button" onClick={() => setD({ ...d, tagIds: d.tagIds?.includes(t.id) ? d.tagIds.filter((x) => x !== t.id) : [...(d.tagIds ?? []), t.id] })}
                className={clsx("chip !py-0.5 !px-2 border", d.tagIds?.includes(t.id) ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted")}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color ?? "#3b82f6" }} />#{t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Input label="Título" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="¿Qué hay que hacer?" autoFocus />
      <Textarea label="Descripción" rows={3} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Detalles…" />

      <div className="modal-grid">
        <Input label="Fecha límite" type="datetime-local" value={d.dueDate ? toLocalInp(d.dueDate) : ""} onChange={(e) => setD({ ...d, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        <Select label="Prioridad" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}>
          <option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option>
        </Select>
        <Select label="Proyecto" value={d.projectId ?? ""} onChange={(e) => setD({ ...d, projectId: e.target.value || null })}>
          <option value="">Sin proyecto</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input label="Estimado (min)" type="number" min={0} value={d.estimateMinutes ?? ""} onChange={(e) => setD({ ...d, estimateMinutes: e.target.value ? Number(e.target.value) : null })} />
        <Select label="Repetición" value={freq} onChange={(e) => setFreq(e.target.value)}>
          <option value="">No se repite</option>
          <option value="DAILY">Cada día</option>
          <option value="WEEKLY">Cada semana</option>
          <option value="MONTHLY">Cada mes</option>
        </Select>
        {task ? (
          <Select label="Estado" value={d.status ?? "PENDING"} onChange={(e) => setD({ ...d, status: e.target.value as TaskStatus })}>
            <option value="PENDING">Pendiente</option>
            <option value="IN_PROGRESS">En progreso</option>
            <option value="POSTPONED">Pospuesta</option>
            <option value="COMPLETED">Completada</option>
            <option value="CANCELLED">Cancelada</option>
          </Select>
        ) : <div className="hidden sm:block" />}
      </div>

      <AttachmentStrip
        existing={existing}
        pending={pending}
        removed={removed}
        previews={previews}
        fileRef={fileRef}
        onAdd={(list) => { void addFiles(list); }}
        onRemoveExisting={(id) => setRemoved([...removed, id])}
        onRemovePending={(key) => {
          const gone = pending.find((x) => x.key === key);
          if (gone?.preview) URL.revokeObjectURL(gone.preview);
          setPending(pending.filter((x) => x.key !== key));
        }}
      />

      <Input label="Notas" value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Notas internas…" />

      <div>
        <span className="label">Subtareas</span>
        <div className="space-y-1 mb-2">
          {savedSubs.map((s) => (
            <div key={s.id} className="flex items-center gap-1 group/sub">
              <Checkbox
                checked={s.done}
                onChange={() => {
                  const current = subsRef.current.find((x) => x.id === s.id);
                  if (!current) return;
                  const nextDone = !current.done;
                  subsRef.current = subsRef.current.map((x) => (x.id === s.id ? { ...x, done: nextDone } : x));
                  setSavedSubs(subsRef.current);
                  http.patch(`/api/tasks/subtasks/${s.id}`, { done: nextDone })
                    .catch(() => {
                      subsRef.current = subsRef.current.map((x) => (x.id === s.id ? { ...x, done: !nextDone } : x));
                      setSavedSubs(subsRef.current);
                      push("error", "No se pudo actualizar la subtarea.");
                    });
                }}
                label={s.title}
              />
              <button
                type="button"
                aria-label="Eliminar subtarea"
                onClick={() => {
                  const snapshot = subsRef.current;
                  subsRef.current = subsRef.current.filter((x) => x.id !== s.id);
                  setSavedSubs(subsRef.current);
                  http.del(`/api/tasks/subtasks/${s.id}`)
                    .catch(() => {
                      subsRef.current = snapshot;
                      setSavedSubs(snapshot);
                      push("error", "No se pudo eliminar la subtarea.");
                    });
                }}
                className="ml-auto text-faint hover:text-danger opacity-0 group-hover/sub:opacity-100 focus:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-0">
            <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Añadir subtarea…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } } }} />
          </div>
          <Button type="button" variant="secondary" className="shrink-0 h-11" onClick={() => { if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } }}><Plus className="w-4 h-4" /></Button>
        </div>
        {subs.map((s, i) => (
          <div key={i} className="flex items-center gap-2 mt-1 text-sm text-muted"><Check className="w-3.5 h-3.5 text-ok" />{s.title}<button type="button" onClick={() => setSubs(subs.filter((_, j) => j !== i))} className="ml-auto text-faint hover:text-danger">✕</button></div>
        ))}
      </div>
    </Modal>
  );
}

function toLocalInp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}