import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Check, Import } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Task, Priority, TaskStatus, Project, Tag } from "@/lib/types";
import { Button, Input, Modal, Select, Checkbox, useToast, PriorityDot, Spinner } from "@/components/ui";
import { relativeDay, fmtTime, PRIORITY_LABEL } from "@/lib/dates";

const inv = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries();

/* ---------------- Progress bar ---------------- */
export function ProgressBar({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={clsx("h-1.5 rounded-full bg-border/60 overflow-hidden", className)}>
      <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color ?? undefined }} />
    </div>
  );
}

/* ---------------- TaskItem ---------------- */
export function TaskItem({ task, onOpen, compact, onToggle }: { task: Task; onOpen?: (t: Task) => void; compact?: boolean; onToggle?: (t: Task) => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const done = task.status === "COMPLETED";

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggle) { onToggle(task); return; }
    setBusy(true);
    try {
      if (!done) { await http.post(`/api/tasks/${task.id}/complete`); push("success", "¡Tarea completada! 🎉"); }
      else await http.patch(`/api/tasks/${task.id}`, { status: "PENDING" });
      inv(qc);
    } catch (e: any) { push("error", e.message ?? "Error"); }
    finally { setBusy(false); }
  };

  const overdue = task.dueDate && !done && new Date(task.dueDate).getTime() < Date.now() && task.hasTime;
  const dueToday = task.dueDate && !done && relativeDay(task.dueDate) === "Hoy";

  return (
    <button onClick={() => onOpen?.(task)} className={clsx("w-full flex items-start gap-3 text-left group rounded-xl transition-all hover:bg-surface px-2 py-2 -mx-2", done && "opacity-70")}>
      <button onClick={toggle} disabled={busy} aria-label={done ? "Marcar como pendiente" : "Completar tarea"}
        className={clsx("mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 transition-all",
          done ? "bg-accent border-accent text-white" : "border-border group-hover:border-accent")}>
        {busy ? <Spinner className="!w-3 !h-3" /> : done && <Check className="w-3 h-3" strokeWidth={3.5} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={clsx("text-sm text-text", done && "line-through text-faint")}>{task.title}</p>
        {(task.dueDate || compact === false) && (
          <div className={clsx("flex flex-wrap items-center gap-2 mt-1 text-xs", !compact && "space-y-0")}>
            {task.dueDate && (
              <span className={clsx("inline-flex items-center gap-1", overdue ? "text-danger" : dueToday ? "text-warn" : "text-faint")}>
                <CalendarDays className="w-3 h-3" />{relativeDay(task.dueDate)}{task.hasTime ? " · " + fmtTime(task.dueDate) : ""}
              </span>
            )}
            <span className="inline-flex items-center gap-1"><PriorityDot p={task.priority} /><span className="text-faint">{PRIORITY_LABEL[task.priority]}</span></span>
            {task.project && <span className="chip !px-1.5 !py-0.5" style={{ background: "color-mix(in srgb, " + (task.project.color ?? "#3b82f6") + "22, transparent)" }}> <span className="w-1.5 h-1.5 rounded-full" style={{ background: task.project.color ?? "#3b82f6" }} />{task.project.name}</span>}
            {(task.subtasks ?? []).length > 0 && <span className="text-faint">{task.subtasks?.filter((s) => s.done).length}/{task.subtasks?.length}</span>}
          </div>
        )}
      </div>
      {!done && task.priority === "URGENT" && <span className="w-2 h-2 rounded-full bg-danger mt-1.5 shrink-0" aria-hidden />}
    </button>
  );
}

/* ---------------- TaskEditor ---------------- */
export interface TaskDraft {
  id?: string;
  title: string; description?: string; dueDate?: string | null; hasTime?: boolean;
  priority: Priority; status?: TaskStatus; projectId?: string | null; estimateMinutes?: number | null;
  notes?: string; tagIds?: string[];
}
export function TaskEditor({ open, onClose, task, projects, tags, defaultProjectId, now }: {
  open: boolean; onClose: () => void; task?: Task | null; projects: { id: string; name: string; color?: string | null }[]; tags: { id: string; name: string; color?: string | null }[]; defaultProjectId?: string | null; now?: boolean;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<TaskDraft>({
    title: task?.title ?? "", description: task?.description ?? "", dueDate: task?.dueDate ?? null,
    hasTime: task?.hasTime ?? true, priority: task?.priority ?? "NORMAL", projectId: task?.projectId ?? defaultProjectId ?? null,
    estimateMinutes: task?.estimateMinutes ?? null, notes: task?.notes ?? "",
    tagIds: task?.tags?.map((t) => t.id) ?? [],
  });
  const [subs, setSubs] = useState<{ title: string }[]>(task?.subtasks?.map((s) => ({ title: s.title })) ?? []);
  const [newSub, setNewSub] = useState("");
  const [freq, setFreq] = useState(String((task?.recurrence as { frequency?: string } | undefined)?.frequency ?? ""));

  // reset when task changes
  const key = task?.id ?? "new";

  const save = async () => {
    if (!d.title.trim()) { push("error", "Escribe un título."); return; }
    setBusy(true);
    const payload = {
      title: d.title.trim(), description: d.description || null, dueDate: d.dueDate || null, hasTime: d.hasTime,
      priority: d.priority, projectId: d.projectId || null, estimateMinutes: d.estimateMinutes ?? null,
      notes: d.notes || null, tagIds: d.tagIds,
      recurrence: freq ? { frequency: freq, interval: 1 } : null,
    };
    try {
      if (task) {
        await http.patch(`/api/tasks/${task.id}`, payload);
        if (subs.some((s) => !s.title.startsWith("__"))) {
          // add new subtasks
          for (const s of subs.filter((x) => !x.title.startsWith("__"))) {
            await http.post(`/api/tasks/${task.id}/subtasks`, { title: s.title });
          }
        }
        push("success", "Tarea actualizada");
      } else {
        await http.post("/api/tasks", { ...payload, subtasks: subs.map((s) => ({ title: s.title })).filter((s) => s.title.trim()) });
        push("success", "Tarea creada");
      }
      inv(qc); onClose();
    } catch (e: any) { push("error", e.message ?? "No se pudo guardar."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={task ? "Editar tarea" : "Nueva tarea"} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button></>}>
      <div key={key} className="space-y-4">
        <Input label="Título" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="¿Qué hay que hacer?" autoFocus />
        <Input label="Descripción" value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Detalles…" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha límite</label>
            <div className="flex gap-2">
              <Input type="datetime-local" value={d.dueDate ? toLocalInp(d.dueDate) : ""} onChange={(e) => setD({ ...d, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
          </div>
          <Select label="Prioridad" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}>
            <option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option>
          </Select>
          <Select label="Proyecto" value={d.projectId ?? ""} onChange={(e) => setD({ ...d, projectId: e.target.value || null })}>
            <option value="">Sin proyecto</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input label="Tiempo estimado (min)" type="number" min={0} value={d.estimateMinutes ?? ""} onChange={(e) => setD({ ...d, estimateMinutes: e.target.value ? Number(e.target.value) : null })} />
          <Select label="Repetición" value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="">No se repite</option>
            <option value="DAILY">Cada día</option>
            <option value="WEEKLY">Cada semana</option>
            <option value="MONTHLY">Cada mes</option>
          </Select>
        </div>
        {tags.length > 0 && <div>
          <span className="label">Etiquetas</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.id} onClick={() => setD({ ...d, tagIds: d.tagIds?.includes(t.id) ? d.tagIds.filter((x) => x !== t.id) : [...(d.tagIds ?? []), t.id] })}
                className={clsx("chip border", d.tagIds?.includes(t.id) ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted")}>
                <span className="w-2 h-2 rounded-full" style={{ background: t.color ?? "#3b82f6" }} />#{t.name}
              </button>
            ))}
          </div>
        </div>}

        <div>
          <span className="label">Subtareas</span>
          <div className="space-y-2">
            {(task?.subtasks ?? []).map((s) => <div key={s.id} className="flex items-center gap-2"><Checkbox checked={s.done} onChange={async (v) => { try { await http.patch(`/api/tasks/subtasks/${s.id}`, { done: v }); inv(qc); } catch { push("error", "Error"); } }} label={s.title} /></div>)}
            {subs.filter((s) => s.title.startsWith("__")).map(() => null)}
          </div>
          <div className="flex gap-2 mt-2">
            <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Añadir subtarea…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } } }} />
            <Button variant="secondary" onClick={() => { if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } }}><Plus className="w-4 h-4" /></Button>
          </div>
          {subs.map((s, i) => (
            <div key={i} className="flex items-center gap-2 mt-1 text-sm text-muted"><Check className="w-3.5 h-3.5 text-ok" />{s.title}<button onClick={() => setSubs(subs.filter((_, j) => j !== i))} className="ml-auto text-faint hover:text-danger">✕</button></div>
          ))}
        </div>
        <Input label="Notas" value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Notas internas…" />
      </div>
    </Modal>
  );
}

function toLocalInp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}