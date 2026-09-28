import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, Plus, Check, GripVertical, ListChecks, Palette, Paperclip, Send, Pencil, Timer } from "lucide-react";
import clsx from "clsx";
import { Button, Input, Textarea, Modal, Select, Checkbox, useToast, PriorityDot, Spinner, PriorityChips, ProjectChips, AddIconButton, TelegramNotifyToggle, ColorSwatches, ConfirmDialog } from "@/components/ui";
import { useIntegration } from "@/lib/integrations";
import { useItemToasts } from "@/lib/itemToasts";
import { relativeDay, fmtTime, PRIORITY_LABEL, spansLocalDay, localKey, iso, suggestedCreateStart, isTaskOverdue, taskDeadlineMs } from "@/lib/dates";
import { isUrgentSoon, useMinuteNow, useUrgentPulsePref } from "@/lib/urgentPulse";
import { DateTimeField } from "@/components/DateTimeField";
import { useOccupiedTimes } from "@/lib/useOccupiedTimes";
import { http, getAttachmentBlob } from "@/lib/api";
import { flyTaskRow, burstConfetti } from "@/lib/flip";
import type { Project, Task, TaskAttachment, Priority, TaskStatus, Subtask, Tag } from "@/lib/types";
import { nextTagColor, PROJECT_COLORS } from "@/lib/projects";
import { AttachmentStrip } from "@/components/AttachmentStrip";
import { TaskCardMenu } from "@/components/TaskCardMenu";
import { AiImproveDescriptionButton, AiOptimizeModal, AiSubtaskSuggest, AiTitleButton } from "@/components/AiAssist";
import { useAiEnabled } from "@/lib/ai";
import { isTaskCardFill, resolveTaskCardFill, taskCardFillStyle, taskCardInk, usePaintCardsByProject, type TaskCardFill } from "@/lib/taskCardFill";
import {
  MAX_ATTACHMENTS_PER_TASK,
  countAttachments,
  filesFromClipboard,
  isPreviewableImage,
  resolveAllowedMime,
  uploadAttachments,
  validateAttachmentFile,
  type PendingAttachment,
} from "@/lib/attachments";

const inv = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries();

type ProjectBundle = { project: Project & { tasks: Task[] } };
type QueryClient = ReturnType<typeof useQueryClient>;

function patchTaskInCaches(qc: QueryClient, taskId: string, patch: Partial<Task>) {
  const apply = (t: Task): Task => (t.id !== taskId ? t : { ...t, ...patch });
  qc.setQueriesData<ProjectBundle>({ queryKey: ["project"] }, (old) => {
    if (!old?.project?.tasks?.some((t) => t.id === taskId)) return old;
    const tasks = old.project.tasks.map(apply);
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
    return { ...old, tasks: old.tasks.map(apply) };
  });
  qc.setQueriesData<{ important?: Task[]; upcoming?: Task[]; today?: Task[] }>({ queryKey: ["tasks", "smart"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      important: old.important?.map(apply),
      upcoming: old.upcoming?.map(apply),
      today: old.today?.map(apply),
    };
  });
  qc.setQueriesData<{ todaysTasks?: Task[] }>({ queryKey: ["dashboard"] }, (old) => {
    if (!old?.todaysTasks) return old;
    return { ...old, todaysTasks: old.todaysTasks.map(apply) };
  });
}

function applyTaskStatus(qc: QueryClient, task: Task, status: TaskStatus) {
  const completedAt = status === "COMPLETED" ? new Date().toISOString() : null;
  patchTaskInCaches(qc, task.id, { status, completedAt });
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

const TASK_ROW_TAG_LIMIT = 2;

const PRIORITY_BAND_CLASS: Record<Priority, string> = {
  LOW: "bg-prio-low",
  NORMAL: "bg-prio-normal",
  HIGH: "bg-prio-high",
  URGENT: "bg-prio-urgent",
};

function TaskRowTags({ tags, monochrome = false }: { tags: Tag[]; monochrome?: boolean }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, TASK_ROW_TAG_LIMIT);
  const extra = tags.length - shown.length;
  return (
    <span className="flex items-center gap-1 shrink-0 max-w-[8.5rem]" aria-label={`Etiquetas: ${tags.map((t) => t.name).join(", ")}`}>
      {shown.map((tag) => {
        const color = monochrome ? "rgb(var(--text))" : tag.color ?? "rgb(var(--accent))";
        return (
          <span
            key={tag.id}
            className="chip chip-sm max-w-[4.25rem] truncate"
            style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            title={`#${tag.name}`}
          >
            #{tag.name}
          </span>
        );
      })}
      {extra > 0 && <span className="text-[10px] text-faint shrink-0">+{extra}</span>}
    </span>
  );
}

/* ---------------- TaskItem ---------------- */
export function TaskItem({ task, onOpen, compact, onToggle, sortable, completeMotion = "fly", variant = "row" }: {
  task: Task; onOpen?: (t: Task) => void; compact?: boolean; onToggle?: (t: Task) => void; sortable?: boolean;
  completeMotion?: "fly" | "celebrate";
  /** `card` is the board layout: same task, same actions, different shape. */
  variant?: "row" | "card";
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { afterComplete, afterDelete } = useItemToasts();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const paintByProject = usePaintCardsByProject();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const aiEnabled = useAiEnabled();
  const urgentPulse = useUrgentPulsePref();
  const minuteNow = useMinuteNow(urgentPulse && task.priority === "URGENT");
  const pulsing = urgentPulse && task.dueDate != null && isUrgentSoon(task, taskDeadlineMs(task), minuteNow);
  const pendingFill = useRef<{ timer: number; send: () => void; base: string | null } | null>(null);
  const toggling = useRef(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [postponeBusy, setPostponeBusy] = useState(false);
  const [telegramOn, setTelegramOn] = useState(Boolean(task.notifyTelegram));
  // The row shortcut is only offered once Telegram works; the editor shows
  // "Próximamente" while the admin keeps it announced.
  const telegramAvailable = useIntegration("telegram") === "AVAILABLE";
  const done = task.status === "COMPLETED";
  const overdue = isTaskOverdue(task);

  useEffect(() => {
    setTelegramOn(Boolean(task.notifyTelegram));
  }, [task.id, task.notifyTelegram]);

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
        afterComplete(task.id, task.status);
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

  const toggleTelegram = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (telegramBusy) return;
    const next = !telegramOn;
    setTelegramOn(next);
    patchTaskInCaches(qc, task.id, { notifyTelegram: next });
    setTelegramBusy(true);
    try {
      const updated = await http.patch<{ task: Task }>(`/api/tasks/${task.id}`, { notifyTelegram: next });
      const confirmed = Boolean(updated.task.notifyTelegram);
      setTelegramOn(confirmed);
      patchTaskInCaches(qc, task.id, { notifyTelegram: confirmed });
      push(confirmed ? "success" : "info", confirmed ? "Aviso de Telegram activado" : "Aviso de Telegram desactivado");
    } catch (err: unknown) {
      setTelegramOn(!next);
      patchTaskInCaches(qc, task.id, { notifyTelegram: !next });
      push("error", err instanceof Error ? err.message : "No se pudo cambiar el aviso de Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  };

  const postponeTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (postponeBusy) return;
    setPostponeBusy(true);
    try {
      const updated = await http.post<{ task: Task }>(`/api/tasks/${task.id}/postpone`, { days: 1 });
      patchTaskInCaches(qc, task.id, {
        dueDate: updated.task.dueDate,
        dueEndDate: updated.task.dueEndDate,
        status: updated.task.status,
      });
      push("success", "Pospuesta a mañana");
      inv(qc);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo aplazar la tarea.");
    } finally {
      setPostponeBusy(false);
    }
  };

  // Colour picks apply at once; the save waits for the picker to settle.
  const setCardFill = (fill: TaskCardFill | null) => {
    const previous = pendingFill.current ? pendingFill.current.base : task.cardFill ?? null;
    if (pendingFill.current) window.clearTimeout(pendingFill.current.timer);
    patchTaskInCaches(qc, task.id, { cardFill: fill });
    const send = () => {
      pendingFill.current = null;
      void http.patch<{ task: Task }>(`/api/tasks/${task.id}`, { cardFill: fill })
        .then((updated) => patchTaskInCaches(qc, task.id, { cardFill: updated.task.cardFill ?? null }))
        .catch((err: unknown) => {
          patchTaskInCaches(qc, task.id, { cardFill: previous });
          push("error", err instanceof Error ? err.message : "No se pudo cambiar el color de la tarjeta.");
        });
    };
    pendingFill.current = { timer: window.setTimeout(send, 250), send, base: previous };
  };

  useEffect(() => () => {
    const pending = pendingFill.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.send();
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const deleteTask = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      await http.del(`/api/tasks/${task.id}`);
      setDeleteOpen(false);
      afterDelete("task", task.id);
      inv(qc);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo eliminar la tarea.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const hasFiles = (task.attachments?.length ?? 0) > 0;
  const dueToday = task.dueDate && !done && (relativeDay(task.dueDate) === "Hoy" || (task.dueEndDate ? spansLocalDay(task.dueDate, task.dueEndDate, localKey(new Date())) : false));
  const dateLabel = !task.dueDate
    ? "Sin fecha"
    : task.dueEndDate && localKey(new Date(task.dueDate)) !== localKey(new Date(task.dueEndDate))
      ? `${relativeDay(task.dueDate)} – ${relativeDay(task.dueEndDate)}`
      : relativeDay(task.dueDate);
  const timeLabel = task.dueDate && task.hasTime ? fmtTime(task.dueDate) : "—";
  const fill = resolveTaskCardFill(task.cardFill, task.project?.color, paintByProject);
  const fillStyle = taskCardFillStyle(fill);
  const painted = Boolean(fillStyle);
  // Solid project colour, like the project's letter badge; on a painted card
  // it switches to an ink tint so it never disappears into the fill.
  const projectInk = task.project?.color ? taskCardInk(task.project.color) : null;
  const projectChipStyle: React.CSSProperties = painted || !projectInk
    ? { background: "color-mix(in srgb, rgb(var(--text)) 16%, transparent)" }
    : { background: projectInk.background, color: `rgb(${projectInk.ink.join(" ")})` };

  const open = () => onOpen?.(task);
  const openOnKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };

  if (variant === "card") {
    const openMenuAt = (x: number, y: number) => setMenu({ x, y });
    const onCardKey = (e: React.KeyboardEvent) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const rect = rootRef.current?.getBoundingClientRect();
        openMenuAt((rect?.left ?? 0) + 16, (rect?.top ?? 0) + 16);
        return;
      }
      openOnKey(e);
    };
    return (
      <>
      <article
        ref={rootRef}
        role="button"
        tabIndex={0}
        data-flip-key={task.id}
        aria-haspopup="menu"
        onClick={open}
        onKeyDown={onCardKey}
        onContextMenu={(e) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
        className={clsx(
          "task-card group relative flex cursor-pointer flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4 text-left",
          pulsing && "urgent-pulse",
          "transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop",
          done && "opacity-60",
        )}
        style={fillStyle}
      >
        {/* Priority band: colour and label in one strip, dark ink reads on every priority tone. */}
        <div className={clsx("-mx-4 -mt-4 mb-1 flex h-6 items-center rounded-t-2xl px-4 text-[10px] font-bold uppercase tracking-wider text-[#111]", PRIORITY_BAND_CLASS[task.priority])}>
          {PRIORITY_LABEL[task.priority]}
        </div>

        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={toggle}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={done ? "Marcar como pendiente" : "Completar tarea"}
            className="shrink-0 pt-0.5"
          >
            <span
              className={clsx(
                "grid h-5 w-5 place-items-center rounded-full border-2",
                done ? "border-accent bg-accent text-white" : "border-border group-hover:border-accent",
              )}
              style={done && painted ? { color: "rgb(var(--surface))" } : undefined}
            >
              {done && <Check className="h-3 w-3" strokeWidth={3.5} />}
            </span>
          </button>
          <p className={clsx("min-w-0 flex-1 line-clamp-5 break-words text-sm font-medium text-text", done && "line-through text-faint")}>
            {task.title}
          </p>
        </div>

        {task.description && (
          <p className="line-clamp-2 pl-7 text-xs leading-relaxed text-muted">{task.description}</p>
        )}

        {/* Due date sits right above the divider so it lines up across a row. */}
        <div className="mt-auto flex items-center gap-x-2 text-[11px]">
          <span className={clsx("inline-flex items-center gap-1", overdue ? "text-danger" : dueToday ? "text-warn" : "text-faint", painted && (overdue || dueToday) && "font-semibold")}>
            <CalendarDays className="h-3 w-3" />
            {dateLabel}
            {task.hasTime && <><span aria-hidden>·</span>{timeLabel}</>}
          </span>
          {(task.subtasks ?? []).length > 0 && (
            <span className="inline-flex items-center gap-1 text-faint">
              <ListChecks className="h-3 w-3" aria-hidden="true" />
              {task.subtasks?.filter((s) => s.done).length}/{task.subtasks?.length}
            </span>
          )}
          {hasFiles && <Paperclip className="ml-auto h-3.5 w-3.5 shrink-0 text-faint" aria-label="Tiene adjuntos" />}
        </div>

        <div className="flex items-center gap-1 border-t border-border/60 pt-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {task.project ? (
              <span className={clsx("chip chip-sm min-w-0 shrink truncate font-semibold", (painted || !projectInk) && "text-text")} style={projectChipStyle}>
                {task.project.name}
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-faint">Sin proyecto</span>
            )}
            <TaskRowTags tags={task.tags ?? []} monochrome={painted} />
          </div>
          {overdue && (
            <button
              type="button"
              className={clsx("btn-ghost btn-icon-sm text-faint", painted ? "hover:bg-text/15 hover:text-text" : "hover:bg-warn/15 hover:text-warn")}
              onClick={postponeTask}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={postponeBusy}
              aria-label="Aplazar un día"
              title="Aplazar un día"
            >
              <CalendarClock className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className={clsx("btn-ghost btn-icon-sm text-faint", painted ? "hover:bg-text/15 hover:text-text" : "hover:bg-danger/15 hover:text-danger")}
            onClick={(e) => { e.stopPropagation(); navigate(`/pomodoro?taskId=${encodeURIComponent(task.id)}&start=1`); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Pomodoro 25 min"
            title="Pomodoro 25 min"
          >
            <Timer className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={clsx("btn-ghost btn-icon-sm text-faint", painted ? "hover:bg-text/15 hover:text-text" : "hover:bg-accent/15 hover:text-accent")}
            onClick={(e) => { e.stopPropagation(); open(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Editar tarea"
            title="Editar tarea"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </article>
      {menu && (
        <TaskCardMenu
          x={menu.x}
          y={menu.y}
          cardFill={task.cardFill}
          projectColor={task.project?.color && /^#[0-9a-f]{6}$/i.test(task.project.color) ? task.project.color : null}
          onFill={setCardFill}
          onDelete={() => setDeleteOpen(true)}
          onOptimize={aiEnabled ? () => setOptimizeOpen(true) : undefined}
          onClose={closeMenu}
        />
      )}
      {optimizeOpen && <AiOptimizeModal task={task} onClose={() => setOptimizeOpen(false)} />}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteTask()}
        busy={deleteBusy}
        title="Eliminar tarea"
        message={`Se moverá «${task.title}» a la papelera. Puedes restaurarla después.`}
      />
      </>
    );
  }

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      data-flip-key={task.id}
      onClick={open}
      onKeyDown={openOnKey}
      className={clsx("w-full flex items-start gap-2 text-left group rounded-xl transition-colors hover:bg-surface px-2 py-2 -mx-2 cursor-pointer", done && "opacity-70", pulsing && "urgent-pulse urgent-pulse-row")}
    >
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
          {telegramAvailable && <button
            type="button"
            onClick={toggleTelegram}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={telegramBusy}
            aria-pressed={telegramOn}
            className={clsx("shrink-0 rounded p-0.5", telegramOn ? "text-sky-500" : "text-faint opacity-0 group-hover:opacity-100 hover:text-sky-500")}
            aria-label={telegramOn ? "Desactivar aviso de Telegram" : "Activar aviso de Telegram"}
            title={telegramOn ? "Aviso de Telegram activado" : "Avisar por Telegram"}
          >
            <Send className="w-3.5 h-3.5" fill={telegramOn ? "currentColor" : "none"} />
          </button>}
        </p>
        <div className={clsx("flex flex-wrap items-center gap-2 mt-1 text-xs", compact && "gap-x-2")}>
          <PriorityDot p={task.priority} className="w-2.5 h-2.5" />
          <TaskRowTags tags={task.tags ?? []} />
          <span className={clsx("inline-flex items-center gap-1", overdue ? "text-danger" : dueToday ? "text-warn" : "text-faint")}>
            <CalendarDays className="w-3 h-3" />
            {dateLabel}
            <span aria-hidden>·</span>
            {timeLabel}
          </span>
          <span className="text-faint">{PRIORITY_LABEL[task.priority]}</span>
          {task.project ? (
            <span className={clsx("chip chip-sm font-semibold", !projectInk && "text-text")} style={projectChipStyle}>
              {task.project.name}
            </span>
          ) : (
            <span className="text-faint">Sin proyecto</span>
          )}
          {(task.subtasks ?? []).length > 0 && <span className="text-faint">{task.subtasks?.filter((s) => s.done).length}/{task.subtasks?.length}</span>}
        </div>
      </div>
      {onOpen && overdue && (
        <button
          type="button"
          className="btn-ghost btn-icon-sm shrink-0 text-faint hover:text-accent mt-0.5"
          onClick={postponeTask}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={postponeBusy}
          aria-label="Aplazar un día"
          title="Aplazar un día"
        >
          <CalendarClock className="w-4 h-4" />
        </button>
      )}
      {onOpen && (
        <button
          type="button"
          className="btn-ghost btn-icon-sm shrink-0 text-faint hover:text-accent mt-0.5 opacity-0 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); navigate(`/pomodoro?taskId=${encodeURIComponent(task.id)}&start=1`); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Pomodoro 25 min"
          title="Pomodoro 25 min"
        >
          <Timer className="w-4 h-4" />
        </button>
      )}
      {onOpen && (
        <button
          type="button"
          className="btn-ghost btn-icon-sm shrink-0 text-faint hover:text-accent mt-0.5"
          onClick={(e) => { e.stopPropagation(); onOpen(task); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Editar tarea"
          title="Editar tarea"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
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
  title: string; description?: string; dueDate?: string | null; dueEndDate?: string | null; hasTime?: boolean;
  priority: Priority; status?: TaskStatus; projectId?: string | null; estimateMinutes?: number | null;
  notes?: string; tagIds?: string[]; cardFill?: string | null;
  notifyTelegram?: boolean;
}

function draftFrom(task: Task | null | undefined, defaultProjectId?: string | null): TaskDraft {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    dueDate: task ? task.dueDate ?? null : iso(suggestedCreateStart()),
    dueEndDate: task?.dueEndDate ?? null,
    hasTime: task?.hasTime ?? true,
    priority: task?.priority ?? "NORMAL",
    status: task?.status ?? "PENDING",
    projectId: task?.projectId ?? defaultProjectId ?? null,
    estimateMinutes: task?.estimateMinutes ?? null,
    notes: task?.notes ?? "",
    tagIds: task?.tags?.map((t) => t.id) ?? [],
    notifyTelegram: task?.notifyTelegram ?? false,
    cardFill: task?.cardFill ?? null,
  };
}

export function TaskEditor({ open, onClose, task, projects = [], tags = [], defaultProjectId }: {
  open: boolean; onClose: () => void; task?: Task | null; projects?: { id: string; name: string; color?: string | null }[]; tags?: { id: string; name: string; color?: string | null }[]; defaultProjectId?: string | null; now?: boolean;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data: telegramStatus } = useQuery({ queryKey: ["telegram-status"], queryFn: () => http.get<{ linked: boolean }>("/api/telegram/status") });
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: () => http.get<{ projects: { id: string; name: string; color?: string | null }[] }>("/api/projects"),
    enabled: open,
  });
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => http.get<{ tags: { id: string; name: string; color?: string | null }[] }>("/api/tags"),
    enabled: open,
  });
  const availableProjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string | null }>();
    for (const p of [...projects, ...(projectsData?.projects ?? [])]) map.set(p.id, p);
    return [...map.values()];
  }, [projects, projectsData]);
  const availableTags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string | null }>();
    for (const t of [...tags, ...(tagsData?.tags ?? [])]) map.set(t.id, t);
    return [...map.values()];
  }, [tags, tagsData]);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<TaskDraft>(() => draftFrom(task, defaultProjectId));
  const excludeIds = useMemo(() => (task?.id ? [task.id] : []), [task?.id]);
  const startDay = d.dueDate ? localKey(new Date(d.dueDate)) : "";
  const endDay = d.dueEndDate ? localKey(new Date(d.dueEndDate)) : "";
  const startOccupied = useOccupiedTimes(startDay, open, excludeIds);
  const endOccupied = useOccupiedTimes(endDay, open && Boolean(endDay), excludeIds);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PROJECT_COLORS[0]);
  const [subs, setSubs] = useState<{ title: string }[]>([]);
  const aiEnabled = useAiEnabled();
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
    setNewProjectOpen(false);
    setNewProjectName("");
    setNewTagOpen(false);
    setNewTagName("");
    setNewTagColor(PROJECT_COLORS[0]);
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

  const addFiles = async (list: FileList | File[] | null) => {
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

  const onPaste = (e: React.ClipboardEvent) => {
    const files = filesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const created = await http.post<{ project: { id: string; name: string; color?: string | null } }>("/api/projects", { name });
      qc.setQueryData<{ projects: { id: string; name: string; color?: string | null }[] }>(["projects"], (old) => {
        const list = old?.projects ?? [];
        if (list.some((p) => p.id === created.project.id)) return old ?? { projects: list };
        return { projects: [...list, created.project] };
      });
      setD((current) => ({ ...current, projectId: created.project.id }));
      setNewProjectName("");
      setNewProjectOpen(false);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["projects-lite"] });
      push("success", "Proyecto creado y seleccionado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear el proyecto.");
    }
  };

  const createTag = async () => {
    const name = newTagName.trim().replace(/^#/, "");
    if (!name) return;
    const already = availableTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (already) {
      setD((current) => ({
        ...current,
        tagIds: current.tagIds?.includes(already.id) ? current.tagIds : [...(current.tagIds ?? []), already.id],
      }));
      setNewTagName("");
      setNewTagOpen(false);
      return;
    }
    try {
      const created = await http.post<{ tag: { id: string; name: string; color?: string | null } }>("/api/tags", {
        name,
        color: newTagColor,
      });
      qc.setQueryData<{ tags: { id: string; name: string; color?: string | null }[] }>(["tags"], (old) => {
        const list = old?.tags ?? [];
        if (list.some((t) => t.id === created.tag.id)) return old ?? { tags: list };
        return { tags: [...list, created.tag] };
      });
      setD((current) => ({ ...current, tagIds: [...(current.tagIds ?? []), created.tag.id] }));
      setNewTagName("");
      setNewTagColor(PROJECT_COLORS[0]);
      setNewTagOpen(false);
      void qc.invalidateQueries({ queryKey: ["tags"] });
      push("success", `Etiqueta #${created.tag.name} creada`);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear la etiqueta.");
    }
  };

  const save = async () => {
    if (busy) return;
    if (!d.title.trim()) { push("error", "Escribe un título."); return; }
    setBusy(true);
    const payload = {
      title: d.title.trim(), description: d.description || null, dueDate: d.dueDate || null, dueEndDate: d.dueEndDate || null, hasTime: d.hasTime,
      priority: d.priority, status: d.status, projectId: d.projectId || null, estimateMinutes: d.estimateMinutes ?? null,
      notes: d.notes || null, tagIds: d.tagIds, notifyTelegram: d.notifyTelegram,
      cardFill: isTaskCardFill(d.cardFill) ? d.cardFill : null,
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
    <Modal open={open} onClose={onClose} size="xl" title={task ? "Editar tarea" : "Nueva tarea"}
      headerExtra={
        <CardFillButton
          value={d.cardFill ?? null}
          projectColor={availableProjects.find((p) => p.id === d.projectId)?.color ?? null}
          onChange={(cardFill) => setD((current) => ({ ...current, cardFill }))}
        />
      }
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button></>}>
      <div onPaste={onPaste} className="space-y-5">
      <div className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          <Input label="Título" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="¿Qué hay que hacer?" autoFocus className={aiEnabled ? "pr-11" : undefined} onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.repeat) return;
            e.preventDefault();
            void save();
          }} />
          {aiEnabled && (
            <AiTitleButton
              title={d.title}
              description={d.description ?? ""}
              onChange={(title) => setD((current) => ({ ...current, title }))}
              className="absolute bottom-1.5 right-1.5"
            />
          )}
        </div>
        <TelegramNotifyToggle
          on={Boolean(d.notifyTelegram)}
          onChange={(notifyTelegram) => setD({ ...d, notifyTelegram })}
          linked={telegramStatus?.linked}
        />
      </div>

      <div className="modal-grid">
        <DateTimeField label="Desde" value={d.dueDate ? toLocalInp(d.dueDate) : ""} occupied={startOccupied} onChange={(v) => {
          const dueDate = v ? new Date(v).toISOString() : null;
          const dueEndDate = dueDate && d.dueEndDate && new Date(d.dueEndDate).getTime() <= new Date(dueDate).getTime() ? null : d.dueEndDate;
          setD({ ...d, dueDate, dueEndDate });
        }} />
        <DateTimeField label="Hasta" value={d.dueEndDate ? toLocalInp(d.dueEndDate) : ""} occupied={endOccupied} optional onChange={(v) => setD({ ...d, dueEndDate: v ? new Date(v).toISOString() : null })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <PriorityChips value={d.priority} onChange={(priority) => setD({ ...d, priority })} />
        <ProjectChips
          value={d.projectId ?? null}
          onChange={(projectId) => setD({ ...d, projectId })}
          projects={availableProjects}
          titleAction={<AddIconButton label="Crear proyecto" expanded={newProjectOpen} onClick={() => setNewProjectOpen((open) => !open)} />}
        />
        {newProjectOpen && (
          <div className="sm:col-span-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Nombre del proyecto" autoFocus onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createProject(); } }} />
            </div>
            <Button className="h-11 shrink-0" onClick={() => void createProject()}>Crear</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-4">
        <Select label="Estado" value={d.status ?? "PENDING"} onChange={(e) => setD({ ...d, status: e.target.value as TaskStatus })}>
          <option value="PENDING">Pendiente</option>
          <option value="IN_PROGRESS">En progreso</option>
          <option value="POSTPONED">Pospuesta</option>
          <option value="COMPLETED">Completada</option>
          <option value="CANCELLED">Cancelada</option>
        </Select>
        <Select label="Repetición" value={freq} onChange={(e) => setFreq(e.target.value)}>
          <option value="">No se repite</option>
          <option value="DAILY">Cada día</option>
          <option value="WEEKLY">Cada semana</option>
          <option value="MONTHLY">Cada mes</option>
        </Select>
        <Input label="Estimado (min)" type="number" min={0} placeholder="Ej. 45" value={d.estimateMinutes ?? ""} onChange={(e) => setD({ ...d, estimateMinutes: e.target.value ? Number(e.target.value) : null })} />
      </div>
      {task?.recurrence && task.dueDate && (
        <Button type="button" variant="secondary" size="sm" onClick={async () => {
          try {
            await http.post(`/api/tasks/${task.id}/skip-occurrence`, { at: task.dueDate });
            push("success", "Esta repetición no se mostrará");
            inv(qc); onClose();
          } catch (e: unknown) {
            push("error", e instanceof Error ? e.message : "No se pudo saltar.");
          }
        }}>Esta vez no</Button>
      )}

      <div className="form-section">
        <div className="flex items-center gap-1.5"><p className="section-title">Etiquetas</p><AddIconButton label="Crear etiqueta" expanded={newTagOpen} onClick={() => setNewTagOpen((current) => {
              const next = !current;
              if (next) setNewTagColor(nextTagColor(availableTags));
              return next;
            })} /></div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {availableTags.map((t) => (
            <button key={t.id} type="button" onClick={() => setD({ ...d, tagIds: d.tagIds?.includes(t.id) ? d.tagIds.filter((x) => x !== t.id) : [...(d.tagIds ?? []), t.id] })}
              className={clsx("chip border transition-colors", d.tagIds?.includes(t.id) ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted hover:border-accent/40 hover:text-text")}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color ?? "rgb(var(--accent))" }} />#{t.name}
            </button>
          ))}
        </div>
        {newTagOpen && (
          <div className="mt-3 rounded-xl border border-border bg-surface/60 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Input label="Nombre" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Ej. Trabajo" maxLength={60} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void createTag(); } }} />
              </div>
              <Button className="h-11 shrink-0" onClick={() => void createTag()}>Crear etiqueta</Button>
            </div>
            <div className="mt-3">
              <ColorSwatches colors={PROJECT_COLORS} value={newTagColor} onChange={setNewTagColor} label="Color de la etiqueta" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="label">Descripción</label>
        <div className="relative">
          <Textarea rows={2} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Detalles…" className={clsx("min-h-[5rem]", aiEnabled ? "pr-20" : "pr-11")} />
          {aiEnabled && (
            <AiImproveDescriptionButton
              title={d.title}
              description={d.description ?? ""}
              onChange={(next) => setD((current) => ({ ...current, description: next }))}
              className="absolute bottom-2.5 right-10"
            />
          )}
          <button
            type="button"
            className="absolute bottom-2.5 right-2 btn-ghost btn-icon-sm text-faint hover:text-accent disabled:opacity-40"
            onClick={() => fileRef.current?.click()}
            disabled={countAttachments(existing, pending, removed) >= MAX_ATTACHMENTS_PER_TASK}
            aria-label="Añadir adjunto"
            title="Añadir adjunto"
          >
            <Paperclip className="w-4 h-4" />
          </button>
        </div>
        <AttachmentStrip
          embedded
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
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="section-title">Subtareas</p>
          {aiEnabled && (
            <AiSubtaskSuggest
              title={d.title}
              description={d.description ?? ""}
              onAdd={(titles) => setSubs((current) => [...current, ...titles.map((t) => ({ title: t }))])}
            />
          )}
        </div>
        <div className="flex w-full gap-2 items-center min-w-0">
          <div className="min-w-0 flex-1 w-full">
            <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Añadir subtarea…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } } }} />
          </div>
          <Button variant="secondary" className="btn-icon-lg shrink-0" aria-label="Añadir subtarea" onClick={() => { if (newSub.trim()) { setSubs([...subs, { title: newSub.trim() }]); setNewSub(""); } }}><Plus className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-1">
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
        {subs.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 text-sm text-muted"><Check className="w-4 h-4 text-ok shrink-0" /><span className="truncate">{s.title}</span><button type="button" onClick={() => setSubs(subs.filter((_, j) => j !== i))} className="ml-auto text-faint hover:text-danger" aria-label="Quitar subtarea">✕</button></div>
        ))}
        </div>
        <div className="space-y-2 sm:w-72 sm:shrink-0">
          <p className="section-title">Notas internas</p>
          <Textarea dense rows={3} value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Solo para ti: no se muestran en la tarjeta…" aria-label="Notas internas" />
        </div>
      </div>
      </div>
    </Modal>
  );
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Card colour inside the task: a dot in the header that opens the same menu as the card. */
function CardFillButton({ value, projectColor, onChange }: {
  value: string | null;
  projectColor: string | null;
  onChange: (fill: TaskCardFill | null) => void;
}) {
  const paintByProject = usePaintCardsByProject();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const safeProject = projectColor && HEX6.test(projectColor) ? projectColor : null;
  const shown = resolveTaskCardFill(value, safeProject, paintByProject);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.right - 264, y: r.bottom + 6 });
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        aria-label="Color de la tarjeta"
        title="Color de la tarjeta"
        className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm text-muted hover:text-text"
      >
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full border border-border"
          style={shown ? { background: shown } : undefined}
        >
          {!shown && <Palette className="h-3 w-3" />}
        </span>
        <span className="hidden sm:inline">Color</span>
      </button>
      {menu && (
        <TaskCardMenu
          x={menu.x}
          y={menu.y}
          cardFill={value}
          projectColor={safeProject}
          onFill={onChange}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

function toLocalInp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
