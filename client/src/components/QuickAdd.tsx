import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Paperclip, Plus } from "lucide-react";
import { ApiError, http } from "@/lib/api";
import { Button, Input, Textarea, Modal, Checkbox, Select, useToast, Segmented, PriorityChips, ProjectChips, AddIconButton, ChoiceChips, ColorSwatches, RECURRENCE_OPTIONS, TelegramNotifyToggle } from "@/components/ui";
import { useItemToasts } from "@/lib/itemToasts";
import { toDateTimeLocal, fromDateTimeLocal, iso, suggestedCreateStart, defaultEventEnd } from "@/lib/dates";
import { DateTimeField } from "@/components/DateTimeField";
import { useOccupiedTimes } from "@/lib/useOccupiedTimes";
import { AttachmentStrip } from "@/components/AttachmentStrip";
import { AiClassifyChips, AiImproveDescriptionButton, AiSubtaskSuggest } from "@/components/AiAssist";
import { aiApi, provisionalTitle, useAiEnabled } from "@/lib/ai";
import type { Note, ProjectStatus, Task, TaskStatus } from "@/lib/types";
import { parseQuickAdd, type QuickPriority } from "@/lib/quickAddParse";
import { nextTagColor, PROJECT_COLORS, PROJECT_STATUSES, DEFAULT_ENTITY_COLOR } from "@/lib/projects";
import {
  countAttachments,
  filesFromClipboard,
  isPreviewableImage,
  maxFilesFor,
  resolveAllowedMime,
  uploadAttachments,
  validateAttachmentFile,
  attachmentCapMessage,
  type AttachmentKind,
  type PendingAttachment,
} from "@/lib/attachments";

function toDateKey(value: string): string {
  return value.slice(0, 10);
}

function asDateTimeLocal(value: string): string {
  if (!value) return toDateTimeLocal(suggestedCreateStart());
  return value.includes("T") ? value : `${toDateKey(value)}T08:00`;
}

export type QuickKind = "task" | "event" | "note" | "project" | "reminder";
type Kind = QuickKind;

const TABS: { value: Kind; label: string }[] = [
  { value: "task", label: "Tarea" }, { value: "event", label: "Evento" }, { value: "note", label: "Nota" },
  { value: "project", label: "Proyecto" }, { value: "reminder", label: "Recordatorio" },
];

const TITLE_LIMIT = 300;
const TEXT_LIMIT = 5000;
type FieldErrors = Record<string, string>;

function validationDetails(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR" || !Array.isArray(error.details)) return {};
  const result: FieldErrors = {};
  for (const issue of error.details) {
    if (!issue || typeof issue !== "object") continue;
    const { field, message } = issue as { field?: unknown; message?: unknown };
    if (typeof field === "string" && typeof message === "string") {
      const target = field === "dueDate" ? "start"
        : field === "dueEndDate" ? "end"
        : field.startsWith("subtasks.") ? "subtasks" : field;
      if (!result[target]) result[target] = message;
    }
  }
  return result;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Slot({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={className}>{children}</div>;
}

export function QuickAdd({ open, onClose, initialKind }: { open: boolean; onClose: () => void; initialKind?: QuickKind }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [kind, setKind] = useState<Kind>("task");
  const { afterQuickAdd } = useItemToasts();
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const [title, setTitle] = useState("");
  const [detail1, setDetail1] = useState("");
  const [priority, setPriority] = useState<QuickPriority>("NORMAL");
  const [allDay, setAllDay] = useState(false);
  const [freq, setFreq] = useState("");
  const [projectId, setProjectId] = useState("");
  const [nlHint, setNlHint] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(DEFAULT_ENTITY_COLOR);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("PLANNING");
  const [daily, setDaily] = useState(false);
  const [telegram, setTelegram] = useState(false);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("PENDING");
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [taskNotes, setTaskNotes] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [subtasks, setSubtasks] = useState<{ title: string }[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PROJECT_COLORS[0]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const aiEnabled = useAiEnabled();
  const pendingRef = useRef<PendingAttachment[]>([]);
  pendingRef.current = pending;
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const [start, setStart] = useState(() => toDateTimeLocal(suggestedCreateStart()));
  const [end, setEnd] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: () => http.get<{ projects: { id: string; name: string; color?: string | null }[] }>("/api/projects"),
    enabled: open,
  });
  const projects = projectsData?.projects ?? [];
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => http.get<{ tags: { id: string; name: string; color?: string | null }[] }>("/api/tags"),
    enabled: open && kind === "task",
  });
  const tags = tagsData?.tags ?? [];
  const { data: telegramStatus } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => http.get<{ linked: boolean }>("/api/telegram/status"),
    enabled: open,
  });

  const attachKind = (): AttachmentKind => {
    switch (kindRef.current) {
      case "note": return "note";
      case "reminder": return "reminder";
      case "task":
      case "event":
      case "project": return "task";
      default: {
        const _never: never = kindRef.current;
        return _never;
      }
    }
  };

  const clearPending = useCallback(() => {
    setPending((prev) => {
      for (const item of prev) if (item.preview) URL.revokeObjectURL(item.preview);
      return [];
    });
  }, []);

  const reset = useCallback(() => {
    setFieldErrors({});
    setFormError("");
    setTitle("");
    setDetail1("");
    setPriority("NORMAL");
    setAllDay(false);
    setFreq("");
    setProjectId("");
    setNlHint("");
    setLocation("");
    setUrl("");
    setColor(DEFAULT_ENTITY_COLOR);
    setProjectStatus("PLANNING");
    setDaily(false);
    setTelegram(false);
    setTaskStatus("PENDING");
    setEstimateMinutes(null);
    setTaskNotes("");
    setSelectedTagIds([]);
    setSubtasks([]);
    setNewSubtask("");
    setNewProjectOpen(false);
    setNewProjectName("");
    setNewTagOpen(false);
    setNewTagName("");
    setNewTagColor(PROJECT_COLORS[0]);
    setStart(toDateTimeLocal(suggestedCreateStart()));
    setEnd("");
    clearPending();
  }, [clearPending]);

  const close = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    setStart(toDateTimeLocal(suggestedCreateStart()));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Opening without a kind (Intro, the + button) is the quick task flow.
    const next = initialKind ?? "task";
    kindRef.current = next;
    setKind(next);
  }, [open, initialKind]);

  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  // A task starts in its description: the title is optional and comes later.
  // Only on opening or picking a tab: a kind guessed while typing never steals focus.
  // The modal mounts its content a frame or two after `open` and animates in,
  // so keep trying briefly until the field exists and actually holds the focus.
  const focusTimer = useRef<number | null>(null);
  const focusFirstField = useCallback(() => {
    if (focusTimer.current) window.clearInterval(focusTimer.current);
    let tries = 0;
    focusTimer.current = window.setInterval(() => {
      const target = kindRef.current === "task" ? descRef.current : document.getElementById(titleId);
      if (target && document.activeElement !== target) target.focus();
      tries += 1;
      if ((target && document.activeElement === target && tries >= 4) || tries >= 20) {
        window.clearInterval(focusTimer.current!);
        focusTimer.current = null;
      }
    }, 50);
  }, [titleId]);

  useEffect(() => {
    if (open) focusFirstField();
    return () => {
      if (focusTimer.current) window.clearInterval(focusTimer.current);
      focusTimer.current = null;
    };
  }, [open, initialKind, focusFirstField]);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const kindNow = attachKind();
    const next = [...pendingRef.current];
    for (const file of Array.from(list)) {
      const err = await validateAttachmentFile(file, kindNow);
      if (err) { push("error", err); continue; }
      if (countAttachments([], next, []) >= maxFilesFor(kindNow)) {
        push("error", attachmentCapMessage(kindNow));
        break;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const mime = resolveAllowedMime(buf, file.name, kindNow);
      const preview = mime && isPreviewableImage(mime) ? URL.createObjectURL(file) : null;
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file, preview });
    }
    pendingRef.current = next;
    setPending(next);
    if (fileRef.current) fileRef.current.value = "";
  }, [push]);

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  useEffect(() => {
    if (!open || (kind !== "task" && kind !== "note" && kind !== "reminder")) return;
    const onWinPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addFilesRef.current(files);
    };
    window.addEventListener("paste", onWinPaste);
    return () => window.removeEventListener("paste", onWinPaste);
  }, [open, kind]);

  const onPaste = (e: React.ClipboardEvent) => {
    if (kind !== "task" && kind !== "note" && kind !== "reminder") return;
    const files = filesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
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
      setProjectId(created.project.id);
      setNewProjectName("");
      setNewProjectOpen(false);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      push("success", "Proyecto creado y seleccionado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear el proyecto.");
    }
  };

  const createTag = async () => {
    const name = newTagName.trim().replace(/^#/, "");
    if (!name) return;
    const already = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (already) {
      setSelectedTagIds((current) => current.includes(already.id) ? current : [...current, already.id]);
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
        if (list.some((tag) => tag.id === created.tag.id)) return old ?? { tags: list };
        return { tags: [...list, created.tag] };
      });
      setSelectedTagIds((current) => [...current, created.tag.id]);
      setNewTagName("");
      setNewTagColor(PROJECT_COLORS[0]);
      setNewTagOpen(false);
      void qc.invalidateQueries({ queryKey: ["tags"] });
      push("success", `Etiqueta #${created.tag.name} creada`);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear la etiqueta.");
    }
  };

  const applyNatural = (raw: string) => {
    setFieldErrors((current) => ({ ...current, title: "" }));
    setFormError("");
    setTitle(raw);
    const parsed = parseQuickAdd(raw);
    if (kind === "task" && (parsed.invalidDate || parsed.invalidTime)) {
      setFieldErrors((current) => ({ ...current, start: parsed.invalidDate ? "La fecha indicada no existe." : "La hora indicada no es válida." }));
    } else {
      setFieldErrors((current) => ({ ...current, start: "" }));
    }
    if (!parsed.hint) { setNlHint(""); return; }
    setKind(parsed.kind);
    setPriority(parsed.priority);
    setFreq(parsed.freq);
    setAllDay(parsed.allDay);
    if (parsed.start) {
      setStart(toDateTimeLocal(parsed.start));
      setEnd(parsed.end ? toDateTimeLocal(parsed.end) : "");
    }
    setNlHint(parsed.hint);
  };

  const invalidate = () => { qc.invalidateQueries(); };

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    setFormError("");
  };

  const submit = async () => {
    if (busy) return;
    const parsed = parseQuickAdd(title);
    // A task can start from its description alone; the AI then writes the real title.
    const finalTitle = title.trim()
      ? parsed.title.trim() || title.trim()
      : kind === "task" ? provisionalTitle(detail1) : "";
    if (kind !== "task" && !title.trim()) { push("error", "Ponle un título."); return; }
    const errors: FieldErrors = {};
    if (kind === "task") {
      if (!title.trim() && !detail1.trim()) errors.title = "Ponle un título o una descripción.";
      else if (finalTitle.length > TITLE_LIMIT) errors.title = `Máximo ${TITLE_LIMIT} caracteres.`;
      if (parsed.invalidDate) errors.start = "La fecha indicada no existe.";
      else if (parsed.invalidTime) errors.start = "La hora indicada no es válida.";
      if (detail1.length > TEXT_LIMIT) errors.description = `Máximo ${TEXT_LIMIT} caracteres.`;
      if (taskNotes.length > TEXT_LIMIT) errors.notes = `Máximo ${TEXT_LIMIT} caracteres.`;
      if (estimateMinutes != null && (!Number.isInteger(estimateMinutes) || estimateMinutes < 0 || estimateMinutes > 100000)) errors.estimateMinutes = "Introduce un número entero entre 0 y 100.000.";
      if (subtasks.length > 200) errors.subtasks = "Máximo 200 subtareas.";
      if (end && start && fromDateTimeLocal(asDateTimeLocal(end)).getTime() <= fromDateTimeLocal(asDateTimeLocal(start)).getTime()) {
        errors.end = "La fecha final debe ser posterior a la inicial.";
      }
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError("Revisa los campos indicados antes de crear.");
      return;
    }
    setFieldErrors({});
    setFormError("");
    setBusy(true);
    let createdTaskId: string | null = null;
    try {
      switch (kind) {
        case "task": {
          const created = await http.post<{ task: Task }>("/api/tasks", {
            title: finalTitle,
            description: detail1.trim() || null,
            priority,
            projectId: projectId || null,
            dueDate: start ? iso(fromDateTimeLocal(asDateTimeLocal(start))) : null,
            dueEndDate: end && start && fromDateTimeLocal(asDateTimeLocal(end)).getTime() > fromDateTimeLocal(asDateTimeLocal(start)).getTime() ? iso(fromDateTimeLocal(asDateTimeLocal(end))) : null,
            hasTime: !!start,
            status: taskStatus,
            estimateMinutes,
            notes: taskNotes.trim() || null,
            tagIds: selectedTagIds,
            subtasks: subtasks.filter((sub) => sub.title.trim()),
            notifyTelegram: telegram,
            recurrence: freq ? { frequency: freq, interval: 1 } : undefined,
          });
          createdTaskId = created.task.id;
          if (aiEnabled && detail1.trim()) retitleWithAi(created.task.id);
          break;
        }
        case "event": {
          const startAt = fromDateTimeLocal(asDateTimeLocal(start));
          const endAt = end
            ? fromDateTimeLocal(asDateTimeLocal(end))
            : defaultEventEnd(startAt);
          const created = await http.post<{ event: { id: string } }>("/api/events", {
            title: finalTitle,
            description: detail1.trim() || null,
            startAt: iso(startAt),
            endAt: iso(endAt.getTime() <= startAt.getTime() ? defaultEventEnd(startAt) : endAt),
            allDay,
            priority,
            projectId: projectId || null,
            location: location.trim() || null,
            url: url.trim() || null,
            notifyTelegram: telegram,
            recurrence: freq ? { frequency: freq, interval: 1 } : undefined,
          });
          afterQuickAdd({ kind: "event", id: created.event.id });
          break;
        }
        case "note": {
          const created = await http.post<{ note: Note }>("/api/notes", {
            title: finalTitle,
            content: detail1 || "",
            projectId: projectId || null,
            color,
          });
          if (pending.length) await uploadAttachments("note", created.note.id, pending.map((item) => item.file));
          afterQuickAdd({ kind: "note", id: created.note.id });
          break;
        }
        case "project": {
          const created = await http.post<{ project: { id: string } }>("/api/projects", {
            name: finalTitle,
            description: detail1.trim() || null,
            color,
            status: projectStatus,
            startDate: start ? toDateKey(start) : null,
            dueDate: end ? toDateKey(end) : null,
          });
          afterQuickAdd({ kind: "project", id: created.project.id });
          break;
        }
        case "reminder": {
          const created = await http.post<{ reminder: { id: string } }>("/api/reminders", {
            title: finalTitle,
            remindAt: iso(fromDateTimeLocal(asDateTimeLocal(start))),
            endAt: end && fromDateTimeLocal(asDateTimeLocal(end)).getTime() > fromDateTimeLocal(asDateTimeLocal(start)).getTime() && toDateKey(end) !== toDateKey(start) ? iso(fromDateTimeLocal(asDateTimeLocal(end))) : undefined,
            scheduleDaily: daily,
            notifyTelegram: telegram,
          });
          if (pending.length) await uploadAttachments("reminder", created.reminder.id, pending.map((item) => item.file));
          afterQuickAdd({ kind: "reminder", id: created.reminder.id });
          break;
        }
        default: {
          const _never: never = kind;
          return _never;
        }
      }
      if (createdTaskId && pending.length) {
        try {
          await uploadAttachments("task", createdTaskId, pending.map((item) => item.file));
        } catch (uploadError: unknown) {
          afterQuickAdd({ kind: "task", id: createdTaskId });
          invalidate();
          reset();
          onClose();
          push("error", `Se creó, pero no se pudieron subir los adjuntos: ${errorMessage(uploadError, "error de subida")}`);
          return;
        }
      }
      if (createdTaskId) afterQuickAdd({ kind: "task", id: createdTaskId });
      invalidate();
      reset();
      onClose();
    } catch (e: unknown) {
      if (kind !== "task") { push("error", errorMessage(e, "No se pudo crear.")); return; }
      const details = validationDetails(e);
      if (Object.keys(details).length) {
        setFieldErrors(details);
        setFormError("Revisa los campos indicados antes de crear.");
      } else {
        setFormError(errorMessage(e, "No se pudo crear."));
      }
    }
    finally { setBusy(false); }
  };

  /** Runs after the modal closes: the task already exists, the AI only swaps its title. */
  const retitleWithAi = (taskId: string) => {
    void aiApi.title(taskId)
      .then(({ task, previousTitle }) => {
        void qc.invalidateQueries();
        push("success", `Título con IA: «${task.title}»`, [{
          label: "Deshacer",
          onClick: () => {
            void http.patch(`/api/tasks/${taskId}`, { title: previousTitle })
              .then(() => qc.invalidateQueries())
              .catch(() => push("error", "No se pudo restaurar el título."));
          },
        }]);
      })
      .catch(() => push("info", "La IA no pudo generar el título; se queda el provisional."));
  };

  const titleLabel = (() => {
    switch (kind) {
      case "project": return "Nombre";
      case "reminder": return "Recordatorio";
      case "task": return "Título (opcional)";
      case "note": return "Título";
      case "event": return "Título";
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  })();

  const detailLabel = (() => {
    switch (kind) {
      case "note": return "Contenido";
      case "task": return "Notas (opcional)";
      case "event":
      case "project": return "Descripción";
      case "reminder": return "Notas (opcional)";
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  })();

  const showDates = kind === "task" || kind === "event" || kind === "reminder" || kind === "project";
  const showAttachments = kind === "task" || kind === "note" || kind === "reminder";
  const showTelegram = kind === "task" || kind === "event" || kind === "reminder";
  const startDay = toDateKey(asDateTimeLocal(start));
  const endDay = end ? toDateKey(end) : "";
  const startOccupied = useOccupiedTimes(startDay, open && showDates && kind !== "project");
  const endOccupied = useOccupiedTimes(endDay, open && showDates && kind !== "project" && Boolean(endDay));

  return (
    <Modal
      open={open}
      onClose={close}
      size={kind === "task" ? "xl" : "lg"}
      shellClassName="modal-shell-quickadd"
      title="Añadir"
      description="Escribe en lenguaje natural: «reunión mañana a las 10» o «tarea urgente el viernes»."
      footer={<><Button variant="secondary" onClick={close}>Cancelar</Button><Button onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Crear"}</Button></>}
    >
      <div onPaste={onPaste} className="space-y-5">
      <Segmented options={TABS} value={kind} onChange={(next) => { setKind(next); kindRef.current = next; setFieldErrors({}); setFormError(""); focusFirstField(); }} className="flex w-full [&>button]:flex-1 overflow-x-auto no-scrollbar" />
      {formError && <p ref={formErrorRef} role="alert" tabIndex={-1} className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}
      <div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={titleLabel}
              value={title}
              onChange={(e) => applyNatural(e.target.value)}
              maxLength={kind === "task" ? TITLE_LIMIT : undefined}
              error={kind === "task" ? fieldErrors.title : undefined}
              aria-invalid={kind === "task" && Boolean(fieldErrors.title)}
              id={titleId}
              placeholder={kind === "task" ? (aiEnabled ? "Opcional: la IA lo escribe a partir de la descripción" : "Opcional: se usan las primeras palabras de la descripción") : "Ej. reunión mañana a las 10"}
              autoFocus={kind !== "task"}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.repeat) return;
                e.preventDefault();
                // Tasks: Intro jumps to the description; Intro there creates it.
                if (kind === "task" && descRef.current) descRef.current.focus();
                else void submit();
              }}
            />
          </div>
          {showTelegram && (
            <TelegramNotifyToggle
              on={telegram}
              onChange={setTelegram}
              linked={telegramStatus?.linked}
            />
          )}
        </div>
        {kind === "event" && (
          <Checkbox label="Todo el día" checked={allDay} onChange={setAllDay} className="mt-2" />
        )}
        <p className={`text-xs mt-1.5 min-h-4 ${nlHint ? "text-accent-strong" : "invisible"}`}>{nlHint || "\u00a0"}</p>
      </div>

      {kind === "task" ? (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><label className="label">Descripción</label><span className="text-xs text-faint">Máximo {TEXT_LIMIT} caracteres</span></div>
            <div className="relative">
              <Textarea
                ref={descRef}
                rows={2}
                value={detail1}
                maxLength={TEXT_LIMIT}
                error={fieldErrors.description}
                onChange={(e) => { setDetail1(e.target.value); clearFieldError("description"); }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.repeat) return;
                  e.preventDefault();
                  void submit();
                }}
                placeholder="Escribe la tarea con todo detalle: fechas, personas, lo que haga falta…"
                className={clsx("min-h-[5rem]", aiEnabled ? "pr-20" : "pr-11")}
              />
              {aiEnabled && (
                <AiImproveDescriptionButton
                  title={title}
                  description={detail1}
                  onChange={(next) => { setDetail1(next); clearFieldError("description"); }}
                  className="absolute bottom-2.5 right-10"
                />
              )}
              <button
                type="button"
                className="absolute bottom-2.5 right-2 btn-ghost btn-icon-sm text-faint hover:text-accent disabled:opacity-40"
                onClick={() => fileRef.current?.click()}
                disabled={countAttachments([], pending, []) >= maxFilesFor("task")}
                aria-label="Añadir adjunto"
                title="Añadir adjunto"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>
            <AttachmentStrip
              embedded
              kind="task"
              existing={[]}
              pending={pending}
              removed={[]}
              previews={{}}
              fileRef={fileRef}
              onAdd={(list) => { void addFiles(list); }}
              onRemoveExisting={() => undefined}
              onRemovePending={(key) => {
                setPending((current) => {
                  const item = current.find((p) => p.key === key);
                  if (item?.preview) URL.revokeObjectURL(item.preview);
                  return current.filter((p) => p.key !== key);
                });
              }}
            />
            <p className="text-xs text-faint">
              Intro crea la tarea · Mayús+Intro, nueva línea{aiEnabled && detail1.trim() ? " · la IA le pondrá un título claro" : ""}
            </p>
            {aiEnabled && (
              <AiClassifyChips
                title={title}
                description={detail1}
                projects={projects}
                tags={tags}
                onProject={(id) => setProjectId(id)}
                onTag={(id) => setSelectedTagIds((current) => (current.includes(id) ? current : [...current, id]))}
                onPriority={(p) => setPriority(p)}
                onDate={(isoDate) => { setStart(toDateTimeLocal(new Date(isoDate))); clearFieldError("start"); }}
              />
            )}
          </div>

          <div className="modal-grid">
            <div><DateTimeField label="Desde" value={asDateTimeLocal(start)} occupied={startOccupied} onChange={(value) => { setStart(value); clearFieldError("start"); }} />{fieldErrors.start && <p className="text-xs text-danger mt-1">{fieldErrors.start}</p>}</div>
            <div><DateTimeField label="Hasta" value={end} onChange={(value) => { setEnd(value); clearFieldError("end"); }} optional occupied={endOccupied} />{fieldErrors.end && <p className="text-xs text-danger mt-1">{fieldErrors.end}</p>}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <PriorityChips value={priority} onChange={setPriority} />
            <ProjectChips
              value={projectId || null}
              onChange={(id) => setProjectId(id ?? "")}
              projects={projects}
              titleAction={<AddIconButton label="Crear proyecto" expanded={newProjectOpen} onClick={() => setNewProjectOpen((value) => !value)} />}
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
            <Select label="Estado" value={taskStatus} onChange={(e) => setTaskStatus(e.target.value as TaskStatus)}>
              <option value="PENDING">Pendiente</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="POSTPONED">Pospuesta</option>
              <option value="COMPLETED">Completada</option>
              <option value="CANCELLED">Cancelada</option>
            </Select>
            <Select label="Repetición" value={freq} onChange={(e) => setFreq(e.target.value)}>
              {RECURRENCE_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
            </Select>
            <Input label="Estimado (min)" type="number" min={0} max={100000} step={1} placeholder="Ej. 45" value={estimateMinutes ?? ""} error={fieldErrors.estimateMinutes} onChange={(e) => { setEstimateMinutes(e.target.value ? Number(e.target.value) : null); clearFieldError("estimateMinutes"); }} />
          </div>

          <div className="form-section">
            <div className="flex items-center gap-1.5"><p className="section-title">Etiquetas</p><AddIconButton label="Crear etiqueta" expanded={newTagOpen} onClick={() => setNewTagOpen((current) => {
              const next = !current;
              if (next) setNewTagColor(nextTagColor(tags));
              return next;
            })} /></div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {tags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <button key={tag.id} type="button" onClick={() => setSelectedTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                    className={`chip border transition-colors ${selected ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted hover:border-accent/40 hover:text-text"}`}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: tag.color ?? "rgb(var(--accent))" }} />#{tag.name}
                  </button>
                );
              })}
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

          <div className="flex flex-col sm:flex-row sm:items-start gap-x-6 gap-y-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="section-title">Subtareas</p>
                {aiEnabled && (
                  <AiSubtaskSuggest
                    title={title}
                    description={detail1}
                    disabled={subtasks.length >= 200}
                    onAdd={(titles) => setSubtasks((current) => [...current, ...titles.map((t) => ({ title: t.slice(0, TITLE_LIMIT) }))].slice(0, 200))}
                  />
                )}
              </div>
              <p className="text-xs text-faint">Máximo 200 subtareas de {TITLE_LIMIT} caracteres.</p>
              <div className="flex w-full gap-2 items-center min-w-0">
                <div className="min-w-0 flex-1 w-full">
                  <Input value={newSubtask} maxLength={TITLE_LIMIT} error={fieldErrors.subtasks} onChange={(e) => { setNewSubtask(e.target.value); clearFieldError("subtasks"); }} placeholder="Añadir subtarea…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newSubtask.trim() && subtasks.length < 200) { setSubtasks([...subtasks, { title: newSubtask.trim() }]); setNewSubtask(""); } } }} />
                </div>
                <Button variant="secondary" className="btn-icon-lg shrink-0" aria-label="Añadir subtarea" disabled={subtasks.length >= 200} onClick={() => { if (newSubtask.trim() && subtasks.length < 200) { setSubtasks([...subtasks, { title: newSubtask.trim() }]); setNewSubtask(""); } }}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="space-y-1">
                {subtasks.map((subtask, index) => (
                  <div key={`${subtask.title}-${index}`} className="flex items-center gap-2.5 text-sm text-muted"><Check className="w-4 h-4 text-ok shrink-0" /><span className="truncate">{subtask.title}</span><button type="button" onClick={() => setSubtasks(subtasks.filter((_, i) => i !== index))} className="ml-auto text-faint hover:text-danger" aria-label="Quitar subtarea">✕</button></div>
                ))}
              </div>
            </div>
            <div className="sm:w-64 sm:shrink-0">
              <Input label="Notas internas" value={taskNotes} maxLength={TEXT_LIMIT} error={fieldErrors.notes} onChange={(e) => { setTaskNotes(e.target.value); clearFieldError("notes"); }} placeholder="Notas internas…" />
              <p className="text-xs text-faint mt-1">Máximo {TEXT_LIMIT} caracteres.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <Slot className="min-h-[4.75rem]">
            {showDates && (
              <div className="modal-grid">
                {kind === "project" ? (
                  <>
                    <Input label="Inicio" type="date" value={toDateKey(start)} onChange={(e) => setStart(e.target.value)} />
                    <Input label="Fecha límite" type="date" value={toDateKey(end)} onChange={(e) => setEnd(e.target.value)} />
                  </>
                ) : (
                  <>
                    <DateTimeField label="Desde" value={asDateTimeLocal(start)} onChange={setStart} occupied={startOccupied} />
                    <DateTimeField label="Hasta" value={end} onChange={setEnd} optional occupied={endOccupied} />
                  </>
                )}
              </div>
            )}
            {kind === "note" && (
              <ProjectChips value={projectId || null} onChange={(id) => setProjectId(id ?? "")} projects={projects} />
            )}
          </Slot>

          <Slot className="min-h-[4.75rem]">
            {kind === "event" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <PriorityChips value={priority} onChange={setPriority} />
                <ProjectChips value={projectId || null} onChange={(id) => setProjectId(id ?? "")} projects={projects} />
              </div>
            )}
            {kind === "project" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <ChoiceChips label="Estado" value={projectStatus} onChange={setProjectStatus} options={PROJECT_STATUSES} />
                <ColorSwatches colors={PROJECT_COLORS} value={color} onChange={setColor} />
              </div>
            )}
            {kind === "note" && (
              <ColorSwatches colors={PROJECT_COLORS} value={color} onChange={setColor} />
            )}
            {kind === "reminder" && (
              <Checkbox label="Repetir a diario" checked={daily} onChange={setDaily} className="h-11" />
            )}
          </Slot>

          <Slot className="min-h-[4.75rem]">
            {kind === "event" && (
              <ChoiceChips label="Repetición" value={freq} onChange={setFreq} options={RECURRENCE_OPTIONS} />
            )}
          </Slot>

          <Slot className="min-h-[6.5rem]">
            {kind !== "reminder" && (
              <Textarea
                label={detailLabel}
                rows={2}
                value={detail1}
                onChange={(e) => setDetail1(e.target.value)}
                placeholder={kind === "note" ? "Escribe aquí…" : "Detalle rápido…"}
                className="min-h-[5rem]"
              />
            )}
          </Slot>

          <Slot className="min-h-[6.75rem]">
            {showAttachments && (
              <AttachmentStrip
                kind={attachKind()}
                existing={[]}
                pending={pending}
                removed={[]}
                previews={{}}
                fileRef={fileRef}
                onAdd={(list) => { void addFiles(list); }}
                onRemoveExisting={() => undefined}
                onRemovePending={(key) => {
                  setPending((current) => {
                    const item = current.find((p) => p.key === key);
                    if (item?.preview) URL.revokeObjectURL(item.preview);
                    return current.filter((p) => p.key !== key);
                  });
                }}
              />
            )}
            {kind === "event" && (
              <div className="modal-grid">
                <Input label="Ubicación" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala, enlace, dirección…" />
                <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </div>
            )}
          </Slot>
        </>
      )}
      </div>
    </Modal>
  );
}
