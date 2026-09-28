import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { Button, Checkbox, Modal, PriorityDot, Spinner, useToast } from "@/components/ui";
import { http } from "@/lib/api";
import { aiApi, loadDayPlan, saveDayPlan, type AiClassification, type AiDayPlan, type AiOptimizeProposal, type AiReschedule } from "@/lib/ai";
import { fmtTime, fromDateTimeLocal, iso, PRIORITY_LABEL, relativeDay, toDateTimeLocal } from "@/lib/dates";
import type { Priority } from "@/lib/types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** ✨ inside the description field: rewrites it clearly, with an undo in the toast. */
export function AiImproveDescriptionButton({ title, description, onChange, className }: {
  title: string;
  description: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const improve = async () => {
    if (busy || !description.trim()) return;
    setBusy(true);
    const previous = description;
    try {
      const { description: next } = await aiApi.improveDescription({ title, description });
      onChange(next);
      push("success", "Descripción mejorada", [{ label: "Deshacer", onClick: () => onChange(previous) }]);
    } catch (err: unknown) {
      push("error", message(err, "La IA no pudo mejorar la descripción."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={clsx("btn-ghost btn-icon-sm text-faint hover:text-accent disabled:opacity-40", className)}
      onClick={() => void improve()}
      disabled={busy || !description.trim()}
      aria-label="Mejorar descripción con IA"
      title="Mejorar descripción con IA"
    >
      {busy ? <Spinner size={16} /> : <Sparkles className="h-4 w-4" />}
    </button>
  );
}

/** ✨ Sugerir: proposes steps; the user keeps the ones they want. */
export function AiSubtaskSuggest({ title, description, onAdd, disabled }: {
  title: string;
  description: string;
  onAdd: (titles: string[]) => void;
  disabled?: boolean;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<{ title: string; keep: boolean }[] | null>(null);
  const suggest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { suggestions } = await aiApi.subtasks({ title, description });
      setItems(suggestions.map((s) => ({ title: s, keep: true })));
    } catch (err: unknown) {
      push("error", message(err, "La IA no pudo sugerir subtareas."));
    } finally {
      setBusy(false);
    }
  };
  if (!items) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => void suggest()} disabled={disabled || busy || !(title.trim() || description.trim())}>
        {busy ? <Spinner size={14} /> : <Sparkles className="h-4 w-4" />}Sugerir con IA
      </Button>
    );
  }
  const chosen = items.filter((i) => i.keep).map((i) => i.title);
  return (
    <div className="basis-full space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-strong"><Sparkles className="h-3.5 w-3.5" />Subtareas sugeridas</p>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <Checkbox
            key={`${item.title}-${index}`}
            label={item.title}
            checked={item.keep}
            onChange={(keep) => setItems(items.map((it, i) => (i === index ? { ...it, keep } : it)))}
            className="w-full"
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setItems(null)}>Descartar</Button>
        <Button type="button" size="sm" disabled={!chosen.length} onClick={() => { onAdd(chosen); setItems(null); }}>Añadir {chosen.length || ""}</Button>
      </div>
    </div>
  );
}

type Named = { id: string; name: string };

/**
 * Suggestions while the user writes. Nothing is applied on its own: each chip
 * fills its field only when clicked.
 */
export function AiClassifyChips({ title, description, projects, tags, onProject, onTag, onPriority, onDate }: {
  title: string;
  description: string;
  projects: Named[];
  tags: Named[];
  onProject: (id: string) => void;
  onTag: (id: string) => void;
  onPriority: (p: Priority) => void;
  onDate: (iso: string, hasTime: boolean) => void;
}) {
  const [result, setResult] = useState<AiClassification | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const text = `${title}\n${description}`.trim();

  useEffect(() => {
    if (text.length < 12) {
      setResult(null);
      return;
    }
    const id = ++seq.current;
    const timer = window.setTimeout(() => {
      setBusy(true);
      aiApi.classify({ title, description })
        .then((next) => {
          if (seq.current !== id) return;
          setResult(next);
          setUsed(new Set());
        })
        .catch(() => {
          if (seq.current === id) setResult(null);
        })
        .finally(() => {
          if (seq.current === id) setBusy(false);
        });
    }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const chips: { key: string; label: string; apply: () => void }[] = [];
  if (result?.projectId) {
    const project = projects.find((p) => p.id === result.projectId);
    if (project) chips.push({ key: `p:${project.id}`, label: project.name, apply: () => onProject(project.id) });
  }
  for (const tagId of result?.tagIds ?? []) {
    const tag = tags.find((t) => t.id === tagId);
    if (tag) chips.push({ key: `t:${tag.id}`, label: `#${tag.name}`, apply: () => onTag(tag.id) });
  }
  if (result?.priority && result.priority !== "NORMAL") {
    const priority = result.priority;
    chips.push({ key: `r:${priority}`, label: PRIORITY_LABEL[priority] ?? priority, apply: () => onPriority(priority) });
  }
  if (result?.dueDate) {
    const due = result.dueDate;
    const hasTime = result.hasTime;
    chips.push({ key: `d:${due}`, label: `${relativeDay(due)}${hasTime ? ` · ${fmtTime(due)}` : ""}`, apply: () => onDate(due, hasTime) });
  }
  const visible = chips.filter((c) => !used.has(c.key));
  if (!busy && !visible.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong">
        {busy ? <Spinner size={12} /> : <Sparkles className="h-3.5 w-3.5" />}Sugerencias
      </span>
      {visible.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => { chip.apply(); setUsed(new Set([...used, chip.key])); }}
          className="chip chip-sm border border-accent/40 bg-accent-soft text-accent-strong hover:bg-accent hover:text-white"
          title="Aplicar sugerencia"
        >
          {chip.label}
        </button>
      ))}
      {visible.length > 0 && (
        <button type="button" onClick={() => setUsed(new Set(chips.map((c) => c.key)))} className="text-faint hover:text-text" aria-label="Descartar sugerencias">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Proposal list for overdue tasks: nothing moves until «Aplicar». */
export function AiRescheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [rows, setRows] = useState<(AiReschedule & { keep: boolean; local: string })[] | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setRows(null);
    setError("");
    aiApi.rescheduleOverdue()
      .then(({ proposals }) => {
        if (!active) return;
        setRows(proposals.map((p) => ({ ...p, keep: true, local: toDateTimeLocal(new Date(p.dueDate)) })));
      })
      .catch((err: unknown) => { if (active) setError(message(err, "La IA no pudo proponer fechas.")); });
    return () => { active = false; };
  }, [open]);

  const chosen = rows?.filter((r) => r.keep && r.local) ?? [];
  const apply = async () => {
    if (applying || !chosen.length) return;
    setApplying(true);
    const results = await Promise.allSettled(chosen.map((r) => http.patch(`/api/tasks/${r.taskId}`, {
      dueDate: iso(fromDateTimeLocal(r.local)),
      hasTime: r.hasTime || r.local !== toDateTimeLocal(new Date(r.dueDate)),
    })));
    setApplying(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    void qc.invalidateQueries();
    if (failed) push("error", `No se pudieron mover ${failed} de ${chosen.length} tareas.`);
    else push("success", `${chosen.length} tarea${chosen.length > 1 ? "s" : ""} reprogramada${chosen.length > 1 ? "s" : ""}`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reprogramar atrasadas"
      description="La IA propone nuevas fechas. Revisa, ajusta y aplica solo las que quieras."
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void apply()} disabled={applying || !chosen.length}>{applying ? "Aplicando…" : `Aplicar ${chosen.length || ""}`}</Button></>}
    >
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : !rows ? (
        <div className="grid h-32 place-items-center gap-2 text-accent"><Spinner /><p className="text-xs text-muted">La IA está repartiendo las tareas… puede tardar unos segundos.</p></div>
      ) : !rows.length ? (
        <p className="text-sm text-muted">No hay tareas atrasadas que reprogramar.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.taskId} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
              <Checkbox
                label={<span className="font-medium">{row.title}</span>}
                checked={row.keep}
                onChange={(keep) => setRows(rows.map((r, i) => (i === index ? { ...r, keep } : r)))}
                className="min-w-0 flex-1"
              />
              <input
                type="datetime-local"
                value={row.local}
                onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, local: e.target.value } : r)))}
                className="input h-9 w-auto shrink-0"
                aria-label={`Nueva fecha para ${row.title}`}
              />
              {row.reason && <p className="text-xs text-faint sm:w-48 sm:shrink-0">{row.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * Suggested order for a day; each task opens its own card. Today's plan stays
 * on this device until the day ends or the user asks for a new one.
 */
export function AiDayPlanPanel({ date, today, userId, onClose }: { date: string; today: string; userId?: string; onClose: () => void }) {
  const [plan, setPlan] = useState<AiDayPlan | null>(() => loadDayPlan(userId, date, today));
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (round === 0 && loadDayPlan(userId, date, today)) return;
    let active = true;
    setPlan(null);
    setError("");
    aiApi.planDay(date)
      .then((next) => {
        if (!active) return;
        setPlan(next);
        if (date === today) saveDayPlan(userId, date, next);
      })
      .catch((err: unknown) => { if (active) setError(message(err, "La IA no pudo preparar el plan.")); });
    return () => { active = false; };
  }, [date, today, userId, round]);

  return (
    <section className="card mb-6 p-5" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="section-title flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" />Plan del día</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setRound((n) => n + 1)} disabled={!plan && !error} className="btn-ghost btn-icon-sm text-faint hover:text-accent disabled:opacity-40" aria-label="Generar otro plan" title="Generar otro plan"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} className="btn-ghost btn-icon-sm text-faint hover:text-text" aria-label="Ocultar plan" title="Ocultar plan"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : !plan ? (
        <div className="grid h-20 place-items-center text-accent"><Spinner /></div>
      ) : (
        <>
          {plan.summary && <p className="mb-3 text-sm text-muted">{plan.summary}</p>}
          <ol className="space-y-1.5">
            {plan.order.map((item, index) => (
              <li key={item.taskId}>
                <Link to={`/tasks?t=${encodeURIComponent(item.taskId)}`} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-surface">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-strong">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-text"><PriorityDot p={item.priority} className="h-2 w-2" />{item.title}</span>
                    {item.reason && <span className="block text-xs text-faint">{item.reason}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** ✨ inside the title field: writes a title from the description, with an undo in the toast. */
export function AiTitleButton({ title, description, onChange, className }: {
  title: string;
  description: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const ready = Boolean(description.trim() || title.trim());
  const suggest = async () => {
    if (busy || !ready) return;
    setBusy(true);
    const previous = title;
    try {
      const { title: next } = await aiApi.suggestTitle({ title, description });
      onChange(next);
      push("success", "Título con IA", [{ label: "Deshacer", onClick: () => onChange(previous) }]);
    } catch (err: unknown) {
      push("error", message(err, "La IA no pudo escribir el título."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={clsx("btn-ghost btn-icon-sm text-faint hover:text-accent disabled:opacity-40", className)}
      onClick={() => void suggest()}
      disabled={busy || !ready}
      aria-label="Escribir el título con IA"
      title="Escribir el título con IA (a partir de la descripción)"
    >
      {busy ? <Spinner size={16} /> : <Sparkles className="h-4 w-4" />}
    </button>
  );
}

type OptimizeTarget = {
  id: string;
  title: string;
  description?: string | null;
  priority: Priority;
  projectId?: string | null;
  tags?: { id: string }[];
};

/**
 * «Optimizar con IA» on a saved task: one proposal for title, description,
 * subtasks, project, tags and priority. Each part has its own box; only the
 * ticked ones are written, and the toast can undo them.
 */
export function AiOptimizeModal({ task, onClose }: { task: OptimizeTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: projectsData } = useQuery({ queryKey: ["projects"], queryFn: () => http.get<{ projects: Named[] }>("/api/projects") });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => http.get<{ tags: Named[] }>("/api/tags") });
  const projects = projectsData?.projects ?? [];
  const tags = tagsData?.tags ?? [];
  const { push } = useToast();
  const [proposal, setProposal] = useState<AiOptimizeProposal | null>(null);
  const [error, setError] = useState("");
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let active = true;
    aiApi.optimize(task.id)
      .then(({ proposal: next, empty }) => {
        if (!active) return;
        if (empty) {
          setError("La IA no ve nada que mejorar en esta tarea.");
          return;
        }
        const initial: Record<string, boolean> = {
          title: Boolean(next.title),
          description: Boolean(next.description),
          project: Boolean(next.projectId),
          tags: next.tagIds.length > 0,
          // A priority the user already changed by hand is not overwritten by default.
          priority: Boolean(next.priority) && task.priority === "NORMAL",
        };
        next.subtasks.forEach((_, i) => { initial[`sub:${i}`] = true; });
        setKeep(initial);
        setProposal(next);
      })
      .catch((err: unknown) => { if (active) setError(message(err, "La IA no pudo optimizar la tarea.")); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const on = (key: string) => Boolean(keep[key]);
  const toggle = (key: string) => (value: boolean) => setKeep((current) => ({ ...current, [key]: value }));
  const subtasks = proposal?.subtasks.filter((_, i) => on(`sub:${i}`)) ?? [];
  const patch: Record<string, unknown> = {};
  if (proposal?.title && on("title")) patch.title = proposal.title;
  if (proposal?.description && on("description")) patch.description = proposal.description;
  if (proposal?.projectId && on("project")) patch.projectId = proposal.projectId;
  if (proposal?.tagIds.length && on("tags")) patch.tagIds = proposal.tagIds;
  if (proposal?.priority && on("priority")) patch.priority = proposal.priority;
  const count = Object.keys(patch).length + subtasks.length;

  const apply = async () => {
    if (applying || !count) return;
    setApplying(true);
    const previous: Record<string, unknown> = {
      title: task.title,
      description: task.description ?? null,
      projectId: task.projectId ?? null,
      tagIds: (task.tags ?? []).map((t) => t.id),
      priority: task.priority,
    };
    const undoPatch = Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key]]));
    const created: string[] = [];
    try {
      if (Object.keys(patch).length) await http.patch(`/api/tasks/${task.id}`, patch);
      for (const title of subtasks) {
        const res = await http.post<{ subtask: { id: string } }>(`/api/tasks/${task.id}/subtasks`, { title });
        created.push(res.subtask.id);
      }
      push("success", "Tarea optimizada", [{
        label: "Deshacer",
        onClick: () => {
          void Promise.all([
            Object.keys(undoPatch).length ? http.patch(`/api/tasks/${task.id}`, undoPatch) : null,
            ...created.map((id) => http.del(`/api/tasks/subtasks/${id}`)),
          ])
            .then(() => qc.invalidateQueries())
            .catch(() => push("error", "No se pudo deshacer del todo."));
        },
      }]);
      onClose();
    } catch (err: unknown) {
      push("error", message(err, "No se pudieron aplicar los cambios."));
    } finally {
      setApplying(false);
      void qc.invalidateQueries();
    }
  };

  const projectName = proposal?.projectId ? projects.find((p) => p.id === proposal.projectId)?.name : null;
  const tagNames = (proposal?.tagIds ?? []).map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean);
  const section = "space-y-1.5 rounded-xl border border-border p-3";

  return (
    <Modal
      open
      onClose={onClose}
      title="Optimizar con IA"
      description="Marca lo que quieras aplicar. Si ya tenía proyecto o etiquetas, se respetan."
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void apply()} disabled={applying || !count}>{applying ? "Aplicando…" : `Aplicar ${count || ""}`}</Button></>}
    >
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : !proposal ? (
        <div className="grid h-32 place-items-center gap-2 text-accent"><Spinner /><p className="text-xs text-muted">La IA está revisando la tarea… con textos largos puede tardar un poco.</p></div>
      ) : (
        <div className="space-y-3">
          {proposal.title && (
            <div className={section}>
              <Checkbox label={<span className="font-semibold">Título</span>} checked={on("title")} onChange={toggle("title")} />
              <p className="pl-7 text-xs text-faint line-through">{task.title}</p>
              <p className="pl-7 text-sm font-medium text-text">{proposal.title}</p>
            </div>
          )}
          {proposal.description && (
            <div className={section}>
              <Checkbox label={<span className="font-semibold">Descripción</span>} checked={on("description")} onChange={toggle("description")} />
              <p className="ml-7 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm text-muted">{proposal.description}</p>
            </div>
          )}
          {proposal.subtasks.length > 0 && (
            <div className={section}>
              <p className="text-sm font-semibold text-text">Subtareas nuevas</p>
              {proposal.subtasks.map((sub, i) => (
                <Checkbox key={`${sub}-${i}`} label={sub} checked={on(`sub:${i}`)} onChange={toggle(`sub:${i}`)} className="w-full" />
              ))}
            </div>
          )}
          {(projectName || tagNames.length > 0 || proposal.priority) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border p-3">
              {projectName && <Checkbox label={<>Proyecto: <strong>{projectName}</strong></>} checked={on("project")} onChange={toggle("project")} />}
              {tagNames.length > 0 && <Checkbox label={<>Etiquetas: <strong>{tagNames.map((n) => `#${n}`).join(" ")}</strong></>} checked={on("tags")} onChange={toggle("tags")} />}
              {proposal.priority && <Checkbox label={<>Prioridad: <strong>{PRIORITY_LABEL[proposal.priority] ?? proposal.priority}</strong></>} checked={on("priority")} onChange={toggle("priority")} />}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
