import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlarmClock, CalendarDays, ChevronLeft, ChevronRight, GripVertical, ListChecks, MapPin, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { EventItem, Reminder, Tag, Task } from "@/lib/types";
import { Spinner, Button, Checkbox, ConfirmDialog, Modal, Input, Segmented, useToast, PageHeader, ChoiceChips, RECURRENCE_OPTIONS } from "@/components/ui";
import { DateChip, TimeChip } from "@/components/DateTimeField";
import { fmtTime, localKey, addDays, startOfDay, iso, spansLocalDay, localKeysInRange, relativeDay } from "@/lib/dates";
import { collectOccupiedTimes } from "@/lib/occupiedTimes";
import { CalendarItemEditor, type CalendarSelection } from "@/components/CalendarItemEditor";
import { useItemToasts } from "@/lib/itemToasts";
import { calendarColumns } from "@/lib/calendarLayout";
import { calendarItemStyle, hasTagColors } from "@/lib/calendarColors";

type View = "month" | "week" | "day" | "agenda";
type DraftKind = "task" | "event" | "reminder";
type Draft = { day: string; endDay: string; time: string; endTime: string; kind: DraftKind };
type CalendarFilters = { reminders: boolean; events: boolean; tasks: boolean };
type DeleteKind = "task" | "event" | "reminder";
type DeleteTarget = { kind: DeleteKind; id: string; title: string };
type AddHandler = (day: Date, time?: string) => void;
type DeleteHandler = (kind: DeleteKind, id: string, title: string) => void;
type DragKind = "task" | "event" | "reminder";
type DragItem = { kind: DragKind; id: string };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const SLOT = 56;
const HEAD = 36;
type DragState = [DragItem | null, React.Dispatch<React.SetStateAction<DragItem | null>>];

function pad(n: number) { return String(n).padStart(2, "0"); }
const DAY_HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CalendarView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { user } = useAuth();
  const startH = user?.calendarStartHour ?? 8;

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFreq, setDraftFreq] = useState("");
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [filters, setFilters] = useState<CalendarFilters>({ reminders: true, events: true, tasks: true });
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const openItem = (kind: DeleteKind, id: string) => setSelection({ kind, id });

  /**
   * `?e=<id>` (and `?t=`/`?r=`) opens that item's editor. The calendar can show
   * it without waiting for the lists, since the editor loads by id on its own.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    // Only the two the editor can load by id. A reminder comes from the list
    // this page has in memory, so a deep link to one outside the visible range
    // would open an editor with nothing in it; those link to /reminders.
    const kinds = [["e", "event"], ["t", "task"]] as const;
    for (const [param, kind] of kinds) {
      const wanted = searchParams.get(param);
      if (!wanted || openedFor.current === wanted) continue;
      openedFor.current = wanted;
      setSelection({ kind, id: wanted });
      const next = new URLSearchParams(searchParams);
      next.delete(param);
      setSearchParams(next, { replace: true });
      return;
    }
  }, [searchParams, setSearchParams]);

  const { from, to } = useMemo(() => range(anchor, view), [anchor, view]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["calendar", from, to],
    queryFn: async () => {
      const [calendar, reminders] = await Promise.all([
        http.get<{ events: EventItem[]; tasks: Task[] }>("/api/calendar", { from, to }),
        http.get<{ reminders: Reminder[] }>("/api/reminders", { from, to }),
      ]);
      return { ...calendar, reminders: reminders.reminders };
    },
  });
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const reminders = data?.reminders ?? [];
  const visibleEvents = filters.events ? events : [];
  const visibleTasks = filters.tasks ? tasks : [];
  const visibleReminders = filters.reminders ? reminders : [];

  const skipEvent = async (e: EventItem) => {
    try {
      await http.post(`/api/events/${e.id}/skip-occurrence`, { at: e.startAt });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      push("success", "Esta vez no: esa repetición ya no aparece");
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo saltar.");
    }
  };
  const skipTask = async (t: Task) => {
    if (!t.dueDate) return;
    try {
      await http.post(`/api/tasks/${t.id}/skip-occurrence`, { at: t.dueDate });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      push("success", "Esta vez no: esa repetición ya no aparece");
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo saltar.");
    }
  };
  const { afterDelete } = useItemToasts();
  const requestDelete: DeleteHandler = (kind, id, title) => setDeleting({ kind, id, title });
  const deleteCalendarItem = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await http.del(`/api/${deleting.kind}s/${deleting.id}`);
      qc.invalidateQueries();
      afterDelete(deleting.kind, deleting.id);
      setDeleting(null);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo eliminar.");
    } finally {
      setDeleteBusy(false);
    }
  };
  const nav = (dir: number) => setAnchor((a) => view === "month" ? shiftMonth(a, dir) : view === "week" ? addDays(a, dir * 7) : addDays(a, dir));
  const today = () => setAnchor(startOfDay(new Date()));

  const openDraft = (day: Date, time: string, kind: DraftKind = "event") => {
    setDraftTitle("");
    setDraftFreq("");
    const startDay = localKey(day);
    const end = afterOneHour(startDay, time);
    setDraft({ day: startDay, endDay: end.day, time, endTime: end.time, kind });
  };

  const drop = async (day: Date, time?: string) => {
    if (!dragging) return;
    const item = dragging;
    setDragging(null);
    try {
      if (item.kind === "event") {
        const ev = events.find((e) => e.id === item.id);
        if (!ev || !isMovable(ev)) return;
        const start = movedDate(day, time, ev.startAt, true);
        const dur = Math.max(new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime(), 3600000);
        await http.patch(`/api/events/${ev.id}/move`, { startAt: start.toISOString(), endAt: new Date(start.getTime() + dur).toISOString(), allDay: ev.allDay && !time });
        push("success", "Evento movido");
      } else if (item.kind === "task") {
        const task = tasks.find((t) => t.id === item.id);
        if (!task?.dueDate || !isMovable(task)) return;
        const due = movedDate(day, time, task.dueDate, task.hasTime);
        await http.patch(`/api/tasks/${task.id}/move`, { dueDate: due.toISOString(), hasTime: task.hasTime || Boolean(time) });
        push("success", "Tarea movida");
      } else {
        const reminder = reminders.find((r) => r.id === item.id);
        if (!reminder || !isMovable(reminder)) return;
        const remindAt = movedDate(day, time, reminder.remindAt, true);
        const sourceEnd = reminder.endAt ? new Date(reminder.endAt) : null;
        const duration = sourceEnd && sourceEnd.getTime() > new Date(reminder.remindAt).getTime()
          ? sourceEnd.getTime() - new Date(reminder.remindAt).getTime()
          : null;
        await http.patch(`/api/reminders/${reminder.id}`, {
          remindAt: remindAt.toISOString(),
          ...(duration ? { endAt: new Date(remindAt.getTime() + duration).toISOString() } : {}),
        });
        push("success", "Recordatorio movido");
      }
      qc.invalidateQueries();
    } catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo mover."); }
  };

  const draftStartOccupied = useMemo(
    () => collectOccupiedTimes({
      dayKey: draft?.day ?? "",
      tasks,
      events,
      reminders,
    }),
    [draft?.day, tasks, events, reminders],
  );
  const draftEndOccupied = useMemo(
    () => collectOccupiedTimes({
      dayKey: draft?.endDay ?? "",
      tasks,
      events,
      reminders,
    }),
    [draft?.endDay, tasks, events, reminders],
  );

  const createDraft = async () => {
    if (!draft || !draftTitle.trim()) return;
    try {
      const start = new Date(`${draft.day}T${draft.time}:00`);
      let end = new Date(`${draft.endDay}T${draft.endTime}:00`);
      if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 3600000);
      const multiDay = localKey(end) !== localKey(start);
      switch (draft.kind) {
        case "task": {
          const t = await http.post<{ task: Task }>("/api/tasks", {
            title: draftTitle.trim(), dueDate: iso(start), dueEndDate: multiDay ? iso(end) : undefined, hasTime: true,
            recurrence: draftFreq ? { frequency: draftFreq, interval: 1 } : undefined,
          });
          push("success", `Tarea «${t.task.title}» creada`);
          break;
        }
        case "reminder": {
          const r = await http.post<{ reminder: Reminder }>("/api/reminders", {
            title: draftTitle.trim(), remindAt: iso(start), endAt: multiDay ? iso(end) : undefined,
          });
          push("success", `Recordatorio «${r.reminder.title || draftTitle.trim()}» creado`);
          break;
        }
        case "event": {
          const ev = await http.post<{ event: EventItem }>("/api/events", {
            title: draftTitle.trim(), startAt: iso(start), endAt: iso(end),
            recurrence: draftFreq ? { frequency: draftFreq, interval: 1 } : undefined,
          });
          push("success", `Evento «${ev.event.title}» creado`);
          break;
        }
        default: {
          const _exhaustive: never = draft.kind;
          return _exhaustive;
        }
      }
      setDraftTitle(""); setDraft(null); setDraftFreq("");
      qc.invalidateQueries();
    } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="page-shell flex flex-col h-[calc(100dvh-120px)] md:h-[calc(100vh-96px)]">
      <PageHeader
        title="Calendario"
        lead={<span className="sentence-case">{headerLabel(anchor, view)}</span>}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={today}>Hoy</Button>
            <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => nav(1)}><ChevronRight className="w-4 h-4" /></Button>
            <Segmented options={[{ value: "month", label: "Mes" }, { value: "week", label: "Semana" }, { value: "day", label: "Día" }, { value: "agenda", label: "Agenda" }]} value={view} onChange={setView} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3" aria-label="Filtros del calendario">
        <span className="text-xs font-medium text-muted">Mostrar:</span>
        <Checkbox label={<span className="inline-flex items-center gap-1.5"><AlarmClock className="w-3.5 h-3.5 text-warn" />Recordatorios</span>} checked={filters.reminders} onChange={(value) => setFilters((current) => ({ ...current, reminders: value }))} />
        <Checkbox label={<span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-accent" />Eventos</span>} checked={filters.events} onChange={(value) => setFilters((current) => ({ ...current, events: value }))} />
        <Checkbox label={<span className="inline-flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-muted" />Tareas</span>} checked={filters.tasks} onChange={(value) => setFilters((current) => ({ ...current, tasks: value }))} />
      </div>

      <div className="card flex-1 overflow-hidden min-h-0">
        {isLoading ? <div className="grid place-items-center h-full text-accent"><Spinner /></div> : isError ? <div role="alert" className="p-6 text-center"><p>No se pudo cargar el calendario.</p><Button onClick={() => void refetch()}>Reintentar</Button></div> : view === "month" ? (
          <MonthGrid onOpen={openItem} anchor={anchor} events={visibleEvents} reminders={visibleReminders} tasks={visibleTasks}
            onDayOpen={(d) => { setAnchor(startOfDay(d)); setView("day"); }}
            onCreate={(d, time) => openDraft(d, time ?? `${pad(Math.max(startH, 9))}:00`, "event")}
            onDrop={drop} dragging={[dragging, setDragging]} onSkipEvent={skipEvent} onSkipTask={skipTask} onDelete={requestDelete} />
        ) : view === "week" || view === "day" ? (
          <TimeGrid onOpen={openItem} initialHour={startH}
            days={view === "week" ? weekDays(anchor) : [startOfDay(anchor)]}
            hours={DAY_HOURS} events={visibleEvents} reminders={visibleReminders} tasks={visibleTasks} onDrop={drop}
            dragging={[dragging, setDragging]}
            onCreate={(d, time) => openDraft(d, time, "event")}
            onSkipEvent={skipEvent} onSkipTask={skipTask} onDelete={requestDelete}
          />
        ) : (
          <AgendaView onOpen={openItem} events={visibleEvents} reminders={visibleReminders} tasks={visibleTasks}
            onCreate={() => openDraft(anchor, `${pad(Math.max(startH, 9))}:00`, "event")}
            onCreateAt={(day, time) => openDraft(day, time, "event")} onDelete={requestDelete} />
        )}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Nuevo en el calendario" size="lg"
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button><Button onClick={createDraft}>Crear</Button></>}>
        <div className="space-y-5">
          <Segmented
            options={[{ value: "event", label: "Evento" }, { value: "task", label: "Tarea" }, { value: "reminder", label: "Recordatorio" }]}
            value={draft?.kind ?? "event"}
            onChange={(k) => setDraft((d) => d ? { ...d, kind: k } : d)}
            className="flex w-full [&>button]:flex-1"
          />
          <Input label="Título" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder={draft?.kind === "task" ? "Ej. Llamar al cliente" : draft?.kind === "reminder" ? "Ej. Pagar el alquiler" : "Ej. Reunión"} autoFocus />
          <div className="modal-grid">
            <DateChip label="Desde" value={draft?.day ?? ""} onChange={(day) => {
              setDraft((d) => {
                if (!d) return d;
                const endDay = d.endDay < day ? day : d.endDay;
                return { ...d, day, endDay };
              });
            }} />
            <DateChip label="Hasta" value={draft?.endDay ?? ""} onChange={(endDay) => setDraft((d) => d ? { ...d, endDay: endDay < d.day ? d.day : endDay } : d)} />
            <TimeChip label="Hora inicio" value={draft?.time ?? ""} occupied={draftStartOccupied} onChange={(time) => setDraft((d) => d ? { ...d, time } : d)} />
            <TimeChip label="Hora fin" value={draft?.endTime ?? ""} occupied={draftEndOccupied} onChange={(endTime) => setDraft((d) => d ? { ...d, endTime } : d)} />
          </div>
          {draft?.kind !== "reminder" && (
            <ChoiceChips label="Repetición" value={draftFreq} onChange={setDraftFreq} options={RECURRENCE_OPTIONS} />
          )}
        </div>
      </Modal>
      {selection && <CalendarItemEditor selection={selection} reminders={reminders} onClose={() => setSelection(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => { if (!deleteBusy) setDeleting(null); }}
        onConfirm={deleteCalendarItem}
        title={`Eliminar ${deleting?.kind === "task" ? "tarea" : deleting?.kind === "event" ? "evento" : "recordatorio"}`}
        message={deleting?.kind === "reminder"
          ? `«${deleting.title}» se eliminará definitivamente.`
          : `«${deleting?.title ?? ""}» se moverá a la papelera.`}
        busy={deleteBusy}
      />
    </div>
  );
}

function MonthGrid({ onOpen, anchor, events, reminders, tasks, onDayOpen, onCreate, onDrop, dragging, onSkipEvent, onSkipTask, onDelete }: {
  onOpen: (kind: DeleteKind, id: string) => void;
  anchor: Date; events: EventItem[]; reminders: Reminder[]; tasks: Task[];
  onDayOpen: (d: Date) => void; onCreate: AddHandler;
  onDrop: (d: Date) => void; dragging: DragState;
  onSkipEvent: (e: EventItem) => void; onSkipTask: (t: Task) => void; onDelete: DeleteHandler;
}) {
  const [drag, setDrag] = dragging;
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const todayKey = localKey(new Date());
  return (
    <div className="grid grid-cols-7 h-full min-h-0" style={{ gridTemplateRows: "auto repeat(6, minmax(0, 1fr))" }}>
      {WEEKDAYS.map((d) => <div key={d} className="text-center text-[11px] font-semibold text-accent-strong py-1.5 uppercase tracking-wide border-b border-accent/20 bg-accent-soft/30">{d}</div>)}
      {cells.map((day) => {
        const key = localKey(day);
        const dayEvents = events.filter((e) => spansLocalDay(e.startAt, e.endAt, key));
        const dayReminders = reminders.filter((r) => spansLocalDay(r.remindAt, r.endAt, key));
        const dayTasks = tasks.filter((t) => t.dueDate && spansLocalDay(t.dueDate, t.dueEndDate, key));
        const dayItems = [
          ...dayEvents.map((item) => ({ kind: "event" as const, item })),
          ...dayReminders.map((item) => ({ kind: "reminder" as const, item })),
          ...dayTasks.map((item) => ({ kind: "task" as const, item })),
        ];
        const isToday = key === todayKey;
        const isPast = key < todayKey;
        const inMonth = day.getMonth() === anchor.getMonth();
        return (
          <div key={key}
            onClick={() => onCreate(day)}
            onKeyDown={(ev) => { if (ev.target !== ev.currentTarget || (ev.key !== "Enter" && ev.key !== " ")) return; ev.preventDefault(); onCreate(day); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag) onDrop(day); }}
            role="button" tabIndex={0} aria-label={`Añadir en ${day.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`}
            className={clsx("group border-b border-r border-border/50 p-1 min-h-[84px] cursor-pointer transition-colors hover:bg-accent-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent", isPast && "bg-text/5", isToday && "bg-ok/10 ring-1 ring-inset ring-ok/30", !inMonth && "opacity-40")}>
            <div className="flex items-center justify-between mb-1">
              <button type="button" onClick={(e) => { e.stopPropagation(); onDayOpen(day); }}
                className={clsx("inline-flex w-6 h-6 items-center justify-center rounded-full text-xs", isToday ? "bg-ok text-white font-bold" : isPast ? "text-faint hover:bg-surface" : "text-muted hover:bg-surface")}>
                {day.getDate()}
              </button>
              <Plus className="w-3.5 h-3.5 text-faint opacity-0 group-hover:opacity-100" />
            </div>
            <div className="space-y-0.5">
              {dayItems.slice(0, 3).map((entry) => entry.kind === "event" ? (
                <div key={entry.item.instanceKey ?? entry.item.id} draggable={isMovable(entry.item)} role="button" tabIndex={0}
                  onClick={(ev) => { if ((ev.target as HTMLElement).closest("button")) return; ev.stopPropagation(); onOpen("event", entry.item.id); }}
                  onKeyDown={(ev) => { if (ev.target !== ev.currentTarget || (ev.key !== "Enter" && ev.key !== " ")) return; ev.preventDefault(); onOpen("event", entry.item.id); }}
                  onDragStart={() => { if (isMovable(entry.item)) setDrag({ kind: "event", id: entry.item.id }); }} onDragEnd={() => setDrag(null)}
                  title={`${entry.item.title}${entry.item.location ? ` · ${entry.item.location}` : ""}`}
                  className={clsx("group/item text-[11px] leading-tight rounded-md px-1.5 py-0.5 truncate flex items-center gap-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", isMovable(entry.item) && "cursor-grab", isPast && "opacity-60 grayscale")} style={calendarItemStyle(entry.item.tags, entry.item.color)}>
                  <span className="truncate flex-1 min-w-0">{localKey(new Date(entry.item.startAt)) === key ? `${fmtTime(entry.item.startAt)} ` : ""}{entry.item.title}</span>
                  <button type="button" className="ml-auto shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit hover:bg-white/20" title="Añadir aquí" aria-label={`Añadir en ${entry.item.title}`} onClick={(ev) => { ev.stopPropagation(); onCreate(day, localKey(new Date(entry.item.startAt)) === key ? fmtTime(entry.item.startAt) : "09:00"); }}>
                    <Plus className="w-3 h-3" />
                  </button>
                  {isRecurring(entry.item) && (
                    <button type="button" className="ml-auto shrink-0 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit" title="Esta vez no" aria-label="Esta vez no" onClick={(ev) => { ev.stopPropagation(); onSkipEvent(entry.item); }}>×</button>
                  )}
                  {!isRecurring(entry.item) && <button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit hover:bg-white/20" title="Eliminar evento" aria-label={`Eliminar evento ${entry.item.title}`} onClick={(ev) => { ev.stopPropagation(); onDelete("event", entry.item.id, entry.item.title); }}><Trash2 className="w-3 h-3" /></button>}
                </div>
              ) : entry.kind === "reminder" ? (
                <div key={entry.item.id} draggable={isMovable(entry.item)} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ev.stopPropagation(); onOpen("reminder", entry.item.id); } }} onClick={(ev) => { ev.stopPropagation(); onOpen("reminder", entry.item.id); }}
                  onDragStart={() => { if (isMovable(entry.item)) setDrag({ kind: "reminder", id: entry.item.id }); }} onDragEnd={() => setDrag(null)}
                  title={entry.item.title || "Recordatorio"}
                  className={clsx("group/item text-[11px] leading-tight rounded-md px-1.5 py-0.5 bg-warn/10 border border-warn/30 text-warn truncate flex items-center gap-1", isMovable(entry.item) && "cursor-grab", isPast && "opacity-60 grayscale")}>
                  {isMovable(entry.item) && <GripVertical className="w-3 h-3 shrink-0 opacity-60" />}<AlarmClock className="w-3 h-3 shrink-0" /><span className="truncate flex-1 min-w-0">{localKey(new Date(entry.item.remindAt)) === key ? `${fmtTime(entry.item.remindAt)} ` : ""}{entry.item.title || "Recordatorio"}</span><button type="button" className="ml-auto shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-warn/20" title="Añadir aquí" aria-label={`Añadir en ${entry.item.title || "recordatorio"}`} onClick={(ev) => { ev.stopPropagation(); onCreate(day, localKey(new Date(entry.item.remindAt)) === key ? fmtTime(entry.item.remindAt) : "09:00"); }}><Plus className="w-3 h-3" /></button><button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-warn/20" title="Eliminar recordatorio" aria-label={`Eliminar recordatorio ${entry.item.title || ""}`} onClick={(ev) => { ev.stopPropagation(); onDelete("reminder", entry.item.id, entry.item.title || "Recordatorio"); }}><Trash2 className="w-3 h-3" /></button></div>
              ) : (
                <div key={entry.item.id} draggable={isMovable(entry.item)} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ev.stopPropagation(); onOpen("task", entry.item.id); } }} onClick={(ev) => { ev.stopPropagation(); onOpen("task", entry.item.id); }} onDragStart={() => { if (isMovable(entry.item)) setDrag({ kind: "task", id: entry.item.id }); }} onDragEnd={() => setDrag(null)}
                  title={entry.item.title}
                  className={clsx("group/item text-[11px] leading-tight rounded-md px-1.5 py-0.5 truncate flex items-center gap-0.5", hasTagColors(entry.item.tags) ? "border border-solid" : "bg-surface border border-dashed border-border text-muted", isMovable(entry.item) && "cursor-grab", isPast && "opacity-60")} style={hasTagColors(entry.item.tags) ? calendarItemStyle(entry.item.tags, entry.item.color) : undefined}>
                  <span className="truncate flex-1 min-w-0">{entry.item.title}</span>
                  <button type="button" className="ml-auto shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-accent-soft" title="Añadir aquí" aria-label={`Añadir en ${entry.item.title}`} onClick={(ev) => { ev.stopPropagation(); onCreate(day, entry.item.dueDate && localKey(new Date(entry.item.dueDate)) === key ? fmtTime(entry.item.dueDate) : "09:00"); }}><Plus className="w-3 h-3" /></button>
                  {isRecurring(entry.item) && (
                    <button type="button" className="ml-auto shrink-0 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100" title="Esta vez no" aria-label="Esta vez no" onClick={(ev) => { ev.stopPropagation(); onSkipTask(entry.item); }}>×</button>
                  )}
                  {!isRecurring(entry.item) && <button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-accent-soft text-danger" title="Eliminar tarea" aria-label={`Eliminar tarea ${entry.item.title}`} onClick={(ev) => { ev.stopPropagation(); onDelete("task", entry.item.id, entry.item.title); }}><Trash2 className="w-3 h-3" /></button>}
                </div>
              ))}
              {dayItems.length > 3 && <button type="button" onClick={(ev) => { ev.stopPropagation(); onDayOpen(day); }} className="text-[10px] text-faint pl-1 hover:text-accent">+{dayItems.length - 3} más</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useMdUp() {
  const [md, setMd] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setMd(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return md;
}

function TimeGrid({ onOpen, initialHour, days, hours, events, reminders, tasks, onDrop, dragging, onCreate, onSkipEvent, onSkipTask, onDelete }: {
  initialHour: number;
  onOpen: (kind: DeleteKind, id: string) => void;
  days: Date[]; hours: number[]; events: EventItem[]; reminders: Reminder[]; tasks: Task[];
  onDrop: (d: Date, t: string) => void; dragging: DragState;
  onCreate: (d: Date, time: string) => void;
  onSkipEvent: (e: EventItem) => void; onSkipTask: (t: Task) => void; onDelete: DeleteHandler;
}) {
  const [drag, setDrag] = dragging;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const md = useMdUp();
  const isWeek = days.length > 1;
  const mobileWeek = isWeek && !md;
  const pickDay = (list: Date[]) => list.find((d) => localKey(d) === localKey(new Date())) ?? list[0];
  const [selected, setSelected] = useState<Date>(() => pickDay(days));
  const weekKey = days.map(localKey).join(",");
  useEffect(() => { setSelected(pickDay(days)); }, [weekKey]);
  const gridDays = mobileWeek ? [selected] : days;
  const selectedKey = localKey(selected);
  const startH = hours[0] ?? 0;
  const gridH = hours.length * SLOT;
  const labels = [...hours, startH + hours.length];

  const slotTime = (el: HTMLElement, clientY: number, h: number) => {
    const rect = el.getBoundingClientRect();
    const half = clientY - rect.top > rect.height / 2;
    return `${pad(h)}:${half ? "30" : "00"}`;
  };

  const busyKeys = new Set([
    ...events.flatMap((e) => localKeysInRange(e.startAt, e.endAt)),
    ...reminders.flatMap((r) => localKeysInRange(r.remindAt, r.endAt)),
    ...tasks.filter((t) => t.dueDate).flatMap((t) => localKeysInRange(t.dueDate!, t.dueEndDate)),
  ]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (initialHour - startH) * SLOT);
  }, [weekKey, startH, initialHour, selectedKey, mobileWeek]);

  const shiftDay = (dir: number) => {
    const i = days.findIndex((d) => localKey(d) === localKey(selected));
    const next = days[i + dir];
    if (next) setSelected(next);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {mobileWeek && (
        <div className="shrink-0 flex border-b border-border/50 bg-surface px-1 pt-1.5 pb-2">
          {days.map((d) => {
            const key = localKey(d);
            const isToday = key === localKey(new Date());
            const isSel = key === localKey(selected);
            const weekday = WEEKDAYS[(d.getDay() + 6) % 7];
            return (
              <button key={key} type="button" onClick={() => setSelected(d)}
                className="flex-1 min-w-0 flex flex-col items-center gap-1 py-1 rounded-xl">
                <span className={clsx("text-[10px] uppercase tracking-wide", isToday || isSel ? "text-accent-strong" : "text-faint")}>{weekday}</span>
                <span className={clsx(
                  "w-8 h-8 grid place-items-center rounded-full text-sm font-semibold tabular-nums",
                  isSel ? "bg-accent text-white" : isToday ? "text-accent-strong" : "text-text",
                )}>{d.getDate()}</span>
                <span className={clsx("w-1 h-1 rounded-full", busyKeys.has(key) ? "bg-accent" : "bg-transparent")} />
              </button>
            );
          })}
        </div>
      )}
      <div className="shrink-0 border-b border-border bg-surface">
        <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Anotado · pulsa para revisar</p>
        <div className="grid divide-x divide-border/50" style={{ gridTemplateColumns: `repeat(${gridDays.length}, minmax(0, 1fr))` }}>
          {gridDays.map((day) => {
            const key = localKey(day);
            const entries = [
              ...events.filter((e) => spansLocalDay(e.startAt, e.endAt, key)).map((e) => ({ kind: "event" as const, id: e.id, at: e.startAt, title: e.title, time: e.allDay ? "Todo el día" : fmtTime(e.startAt), tags: e.tags, color: e.color })),
              ...reminders.filter((r) => spansLocalDay(r.remindAt, r.endAt, key)).map((r) => ({ kind: "reminder" as const, id: r.id, at: r.remindAt, title: r.title || "Recordatorio", time: fmtTime(r.remindAt) })),
              ...tasks.filter((t) => t.dueDate && spansLocalDay(t.dueDate, t.dueEndDate, key)).map((t) => ({ kind: "task" as const, id: t.id, at: t.dueDate!, title: t.title, time: t.hasTime ? fmtTime(t.dueDate!) : "Sin hora", tags: t.tags, color: t.color })),
            ].sort((a, b) => a.at.localeCompare(b.at));
            return <div key={key} className="min-w-0 p-1.5">
              <p className="px-1 text-[10px] text-faint">{WEEKDAYS[(day.getDay() + 6) % 7]} {day.getDate()} · {entries.length}</p>
              <div className="max-h-28 overflow-y-auto space-y-1 mt-1">
                {entries.length === 0 && <p className="px-1 text-xs text-faint">Sin elementos</p>}
                {entries.map((item) => <button key={`${item.kind}:${item.id}:${item.at}`} type="button"
                  onClick={() => onOpen(item.kind, item.id)} title={`${item.time} · ${item.title}`}
                  className={clsx("block w-full rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-accent", item.kind === "event" ? "bg-accent-soft/50 text-accent-strong" : item.kind === "reminder" ? "bg-warn/10 text-warn" : "bg-bg text-text", item.kind !== "reminder" && hasTagColors(item.tags) && "font-medium")}
                  style={item.kind !== "reminder" && hasTagColors(item.tags) ? calendarItemStyle(item.tags, item.color) : undefined}>
                  <span className="block truncate font-medium">{item.title}</span><span className="block text-[10px] opacity-80">{item.time}</span>
                </button>)}
              </div>
            </div>;
          })}
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="flex flex-1 min-h-0 overflow-auto overscroll-y-contain"
        onTouchStart={(e) => { if (mobileWeek) touchStart.current = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }; }}
        onTouchEnd={(e) => {
          if (!mobileWeek || !touchStart.current) return;
          const dx = e.changedTouches[0].clientX - touchStart.current.x;
          const dy = e.changedTouches[0].clientY - touchStart.current.y;
          touchStart.current = null;
          if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) shiftDay(dx < 0 ? 1 : -1);
        }}
      >
        <div className={clsx("shrink-0 border-r border-border/50", mobileWeek ? "w-11" : "w-14")} style={{ minHeight: gridH + HEAD }}>
          <div className="sticky top-0 z-20 bg-surface border-b border-border/50" style={{ height: HEAD }} />
          <div className="relative" style={{ height: gridH }}>
            {labels.map((h) => {
              const isFirst = h === startH;
              const isLast = h === startH + hours.length;
              return (
                <div key={h} className="absolute right-1.5 text-[11px] text-faint tabular-nums leading-none pointer-events-none"
                  style={{
                    top: (h - startH) * SLOT,
                    transform: isFirst ? "translateY(4px)" : isLast ? "translateY(-110%)" : "translateY(-50%)",
                  }}>
                  {pad(h % 24)}:00
                </div>
              );
            })}
          </div>
        </div>
        {gridDays.map((d) => {
          const key = localKey(d);
          const dayEvents = events.filter((e) => !e.allDay && spansLocalDay(e.startAt, e.endAt, key));
          const dayTasks = tasks.filter((t) => t.hasTime && t.dueDate && spansLocalDay(t.dueDate, t.dueEndDate, key));
          const dayReminders = reminders.filter((r) => spansLocalDay(r.remindAt, r.endAt, key));
          const blocks = [
            ...dayEvents.map((e) => ({ key: `event:${e.instanceKey ?? e.id}`, start: e.startAt, end: e.endAt, task: false })),
            ...dayReminders.map((r) => ({ key: `reminder:${r.id}`, start: r.remindAt, end: r.endAt, task: false })),
            ...dayTasks.map((t) => ({ key: `task:${t.instanceKey ?? t.id}`, start: t.dueDate!, end: t.dueEndDate, task: true })),
          ].flatMap((item) => {
            const start = new Date(item.start);
            const end = item.end ? new Date(item.end) : new Date(start.getTime() + 30 * 60_000);
            const slice = clipToDay(start, end, d, startH);
            return slice ? [{ key: item.key, top: slice.top, height: item.task ? Math.min(slice.height, 36) : slice.height }] : [];
          });
          const columns = calendarColumns(blocks);
          const placement = (id: string) => {
            const lane = columns.get(id) ?? { column: 0, columns: 1 };
            return { left: `calc(${lane.column * 100 / lane.columns}% + 4px)`, right: "auto", width: `calc(${100 / lane.columns}% - 8px)` };
          };
          const isToday = key === localKey(new Date());
          const weekday = WEEKDAYS[(d.getDay() + 6) % 7];
          const headLabel = `${weekday} ${d.getDate()}${isToday ? " · Hoy" : ""}`;
          const isPast = key < localKey(new Date());
          return (
            <div key={key} style={{ minHeight: gridH + HEAD }} className={clsx("flex-1 relative border-r border-border/50 min-w-0", isPast && "bg-text/5", isToday && "bg-ok/5", !mobileWeek && isWeek && "md:min-w-[120px]")}>
              <div className={clsx("sticky top-0 z-20 bg-surface text-center text-xs font-semibold border-b border-border/50 flex items-center justify-center gap-1 px-1", isToday && "text-ok ring-1 ring-inset ring-ok/30", isPast && "text-faint")}
                style={{ height: HEAD }}>
                <span className="truncate">{mobileWeek ? (isToday ? "Hoy" : headLabel) : headLabel}</span>
                <button type="button" onClick={() => onCreate(d, "09:00")} className="ml-auto text-faint hover:text-accent p-0.5" aria-label="Crear">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="relative" style={{ height: gridH }}>
                {hours.map((h) => (
                  <div key={h}
                    onClick={(e) => onCreate(d, slotTime(e.currentTarget, e.clientY, h))}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => { ev.preventDefault(); if (drag) onDrop(d, slotTime(ev.currentTarget, ev.clientY, h)); }}
                    className="absolute left-0 right-0 border-b border-border/40 hover:bg-accent-soft/40 cursor-pointer"
                    style={{ top: (h - startH) * SLOT, height: SLOT }} />
                ))}
                {dayEvents.map((e) => {
                  const slice = clipToDay(new Date(e.startAt), new Date(e.endAt), d, startH);
                  if (!slice) return null;
                  const startsHere = localKey(new Date(e.startAt)) === key;
                  return (
                    <div key={e.instanceKey ?? e.id} draggable={isMovable(e)} role="button" tabIndex={0}
                      onClick={(ev) => { if ((ev.target as HTMLElement).closest("button")) return; ev.stopPropagation(); onOpen("event", e.id); }}
                      onKeyDown={(ev) => { if (ev.target !== ev.currentTarget || (ev.key !== "Enter" && ev.key !== " ")) return; ev.preventDefault(); onOpen("event", e.id); }}
                      onDragStart={() => { if (isMovable(e)) setDrag({ kind: "event", id: e.id }); }} onDragEnd={() => setDrag(null)}
                      title={`${startsHere ? `${fmtTime(e.startAt)} · ` : ""}${e.title}${e.location && startsHere ? ` · ${e.location}` : ""}`}
                      className={clsx("absolute left-1 right-1 z-[1] rounded-lg px-2 py-1 text-xs shadow-soft active:cursor-grabbing overflow-hidden group/item focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", isMovable(e) && "cursor-grab", isPast && "opacity-60 grayscale")}
                      style={{ ...calendarItemStyle(e.tags, e.color), top: slice.top, height: slice.height, ...placement(`event:${e.instanceKey ?? e.id}`) }}>
                      <div className="flex items-center gap-1 font-medium">
                        <GripVertical className="w-3 h-3 opacity-70" />
                        <span className="truncate flex-1">{startsHere ? `${fmtTime(e.startAt)} · ` : ""}{e.title}</span>
                        <button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit hover:bg-white/20" title="Añadir aquí" aria-label={`Añadir en ${e.title}`} onClick={(ev) => { ev.stopPropagation(); onCreate(d, startsHere ? fmtTime(e.startAt) : `${pad(startH)}:00`); }}><Plus className="w-3 h-3" /></button>
                        {isRecurring(e) && (
                          <button type="button" className="shrink-0 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit" title="Esta vez no" aria-label="Esta vez no" onClick={(ev) => { ev.stopPropagation(); onSkipEvent(e); }}>×</button>
                        )}
                        {!isRecurring(e) && <button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-inherit hover:bg-white/20" title="Eliminar evento" aria-label={`Eliminar evento ${e.title}`} onClick={(ev) => { ev.stopPropagation(); onDelete("event", e.id, e.title); }}><Trash2 className="w-3 h-3" /></button>}
                      </div>
                      {e.location && startsHere && <div className="text-[10px] opacity-80 flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5" />{e.location}</div>}
                    </div>
                  );
                })}
                {dayReminders.map((r) => {
                  const slice = clipToDay(new Date(r.remindAt), r.endAt ? new Date(r.endAt) : new Date(new Date(r.remindAt).getTime() + 30 * 60 * 1000), d, startH);
                  if (!slice) return null;
                  const startsHere = localKey(new Date(r.remindAt)) === key;
                  return (
                    <div key={r.id} draggable={isMovable(r)} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ev.stopPropagation(); onOpen("reminder", r.id); } }} onClick={(ev) => { ev.stopPropagation(); onOpen("reminder", r.id); }}
                      onDragStart={() => { if (isMovable(r)) setDrag({ kind: "reminder", id: r.id }); }} onDragEnd={() => setDrag(null)}
                      title={`${startsHere ? `${fmtTime(r.remindAt)} · ` : ""}${r.title || "Recordatorio"}`}
                      className={clsx("group/item absolute left-1 right-1 z-[1] rounded-md px-2 py-1 text-xs bg-warn/10 border border-warn/40 text-warn overflow-hidden", isMovable(r) && "cursor-grab", isPast && "opacity-60 grayscale")} style={{ top: slice.top, height: slice.height, minHeight: 30, ...placement(`reminder:${r.id}`) }}>
                      <div className="flex items-center gap-1 font-medium">{isMovable(r) && <GripVertical className="w-3 h-3 shrink-0 opacity-60" />}<AlarmClock className="w-3 h-3 shrink-0" /><span className="truncate flex-1">{startsHere ? `${fmtTime(r.remindAt)} · ` : ""}{r.title || "Recordatorio"}</span><button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-warn/20" title="Añadir aquí" aria-label={`Añadir en ${r.title || "recordatorio"}`} onClick={(ev) => { ev.stopPropagation(); onCreate(d, startsHere ? fmtTime(r.remindAt) : `${pad(startH)}:00`); }}><Plus className="w-3 h-3" /></button><button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-warn/20" title="Eliminar recordatorio" aria-label={`Eliminar recordatorio ${r.title || ""}`} onClick={(ev) => { ev.stopPropagation(); onDelete("reminder", r.id, r.title || "Recordatorio"); }}><Trash2 className="w-3 h-3" /></button></div>
                    </div>
                  );
                })}
                {dayTasks.map((t) => {
                  const due = new Date(t.dueDate!);
                  const taskEnd = t.dueEndDate ? new Date(t.dueEndDate) : new Date(due.getTime() + 30 * 60 * 1000);
                  const slice = clipToDay(due, taskEnd, d, startH);
                  if (!slice) return null;
                  return (
                    <div key={t.instanceKey ?? t.id} draggable={isMovable(t)}
                      role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ev.stopPropagation(); onOpen("task", t.id); } }} onClick={(ev) => { ev.stopPropagation(); onOpen("task", t.id); }}
                      onDragStart={() => { if (isMovable(t)) setDrag({ kind: "task", id: t.id }); }} onDragEnd={() => setDrag(null)}
                      title={`${fmtTime(t.dueDate!)} · ${t.title}`}
                      className={clsx("group/item absolute left-1 right-1 z-[1] rounded-md px-2 py-1 text-xs overflow-hidden", hasTagColors(t.tags) ? "border border-solid" : "bg-surface border border-dashed border-border text-muted", isMovable(t) && "cursor-grab", isPast && "opacity-60")}
                      style={{ ...(hasTagColors(t.tags) ? calendarItemStyle(t.tags, t.color) : {}), top: slice.top, height: Math.min(slice.height, 36), ...placement(`task:${t.instanceKey ?? t.id}`) }}>
                      <span className="flex items-center gap-1"><span className="truncate flex-1">⚡ {t.title}</span><button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-accent-soft" title="Añadir aquí" aria-label={`Añadir en ${t.title}`} onClick={(ev) => { ev.stopPropagation(); onCreate(d, fmtTime(t.dueDate!)); }}><Plus className="w-3 h-3" /></button>{!isRecurring(t) && <button type="button" className="shrink-0 rounded p-0.5 opacity-70 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 text-danger hover:bg-accent-soft" title="Eliminar tarea" aria-label={`Eliminar tarea ${t.title}`} onClick={(ev) => { ev.stopPropagation(); onDelete("task", t.id, t.title); }}><Trash2 className="w-3 h-3" /></button>}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaView({ onOpen, events, reminders, tasks, onCreate, onCreateAt, onDelete }: {
  onOpen: (kind: DeleteKind, id: string) => void;
  events: EventItem[]; reminders: Reminder[]; tasks: Task[]; onCreate: () => void;
  onCreateAt: (day: Date, time: string) => void; onDelete: DeleteHandler;
}) {
  type AgendaItem = { id: string; at: number; date: Date; kind: "event" | "reminder" | "task"; title: string; time: string; recurring: boolean; tags?: Tag[]; color?: string | null };
  const items = [
    ...events.map((e) => ({
      id: e.id,
      at: new Date(e.startAt).getTime(),
      date: new Date(e.startAt),
      kind: "event" as const,
      title: e.title,
      tags: e.tags,
      color: e.color,
      recurring: isRecurring(e),
      time: localKey(new Date(e.startAt)) === localKey(new Date(e.endAt))
        ? `${fmtTime(e.startAt)}–${fmtTime(e.endAt)}`
        : `${relativeDay(e.startAt)} – ${relativeDay(e.endAt)}`,
    })),
    ...reminders.map((r) => ({
      id: r.id,
      at: new Date(r.remindAt).getTime(),
      date: new Date(r.remindAt),
      kind: "reminder" as const,
      title: r.title || "Recordatorio",
      recurring: false,
      time: r.endAt && localKey(new Date(r.remindAt)) !== localKey(new Date(r.endAt))
        ? `${relativeDay(r.remindAt)} – ${relativeDay(r.endAt)}`
        : fmtTime(r.remindAt),
    })),
    ...tasks.filter((t) => t.dueDate).map((t) => ({
      id: t.id,
      at: new Date(t.dueDate!).getTime(),
      date: new Date(t.dueDate!),
      kind: "task" as const,
      title: t.title,
      tags: t.tags,
      color: t.color,
      recurring: isRecurring(t),
      time: t.dueEndDate && localKey(new Date(t.dueDate!)) !== localKey(new Date(t.dueEndDate))
        ? `${relativeDay(t.dueDate!)} – ${relativeDay(t.dueEndDate)}`
        : (t.hasTime ? fmtTime(t.dueDate!) : "todo el día"),
    })),
  ] satisfies AgendaItem[];
  items.sort((a, b) => a.at - b.at);
  if (items.length === 0) {
    return (
      <div className="grid place-items-center h-full text-center p-8">
        <p className="text-muted text-sm mb-4">Sin elementos en este rango.</p>
        <Button onClick={onCreate}><Plus className="w-4 h-4" />Crear</Button>
      </div>
    );
  }
  return (
    <div className="overflow-y-auto p-4">
      {items.map((it) => (
        <div key={`${it.kind}:${it.id}:${it.at}`} className="flex items-center gap-3 py-2.5 border-b border-border/50" role="button" tabIndex={0}
          title={`${it.time} · ${it.title}`}
          onClick={(ev) => { if (!(ev.target as HTMLElement).closest("button")) onOpen(it.kind, it.id); }}
          onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onOpen(it.kind, it.id); } }}>
          <span className={"w-24 shrink-0 text-xs tabular-nums " + (it.kind === "event" ? "text-accent-strong font-medium" : it.kind === "reminder" ? "text-warn font-medium" : "text-muted")}>{it.time}</span>
          <span className={clsx("flex-1 min-w-0 text-sm truncate rounded-md px-2 py-1", it.kind === "event" ? "font-medium text-text" : it.kind === "reminder" ? "font-medium text-warn" : "text-muted", (it.kind !== "reminder" && hasTagColors(it.tags)) && "font-medium")} style={it.kind !== "reminder" && hasTagColors(it.tags) ? calendarItemStyle(it.tags, it.color) : undefined}><span className={clsx("w-2 h-2 rounded-full inline-block mr-2", it.kind !== "reminder" && hasTagColors(it.tags) ? "bg-current" : it.kind === "event" ? "bg-accent" : it.kind === "reminder" ? "bg-warn" : "bg-border")} />{it.title}</span>
          <button type="button" className="btn-ghost btn-icon-sm shrink-0 text-faint hover:text-accent" title="Añadir aquí" aria-label={`Añadir en ${it.title}`} onClick={() => onCreateAt(it.date, fmtTime(it.date))}><Plus className="w-4 h-4" /></button>
          {!it.recurring && <button type="button" className="btn-ghost btn-icon-sm shrink-0 text-faint hover:text-danger" title={`Eliminar ${it.kind === "task" ? "tarea" : it.kind === "event" ? "evento" : "recordatorio"}`} aria-label={`Eliminar ${it.kind === "task" ? "tarea" : it.kind === "event" ? "evento" : "recordatorio"} ${it.title}`} onClick={() => onDelete(it.kind, it.id, it.title)}><Trash2 className="w-4 h-4" /></button>}
        </div>
      ))}
    </div>
  );
}

function range(anchor: Date, view: View) {
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return { from: iso(start), to: iso(new Date(addDays(start, 42).getTime() - 1)) };
  }
  if (view === "week") {
    const monday = addDays(startOfDay(anchor), -((anchor.getDay() + 6) % 7));
    return { from: iso(monday), to: iso(new Date(addDays(monday, 7).getTime() - 1)) };
  }
  const from = startOfDay(anchor);
  return { from: iso(from), to: iso(new Date(addDays(from, view === "day" ? 1 : 2).getTime() - 1)) };
}
function shiftMonth(d: Date, dir: number) { return new Date(d.getFullYear(), d.getMonth() + dir, 1); }
function weekDays(anchor: Date): Date[] {
  const monday = addDays(startOfDay(anchor), -((anchor.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
function afterOneHour(day: string, time: string): { day: string; time: string } {
  const start = new Date(`${day}T${time}:00`);
  const end = new Date(start.getTime() + 3600000);
  return { day: localKey(end), time: `${pad(end.getHours())}:${pad(end.getMinutes())}` };
}

/** Timed block clipped to a local day so multi-day items do not overflow the column. */
function clipToDay(start: Date, end: Date, day: Date, startH: number): { top: number; height: number } | null {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const visStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
  const visEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
  if (visEnd <= visStart) return null;
  const startsThisDay = visStart.getTime() === start.getTime();
  // Continuation days get a compact chip at the top instead of a full-day slab.
  if (!startsThisDay) {
    return { top: 4, height: 28 };
  }
  const top = ((visStart.getHours() - startH) * 60 + visStart.getMinutes()) / 60 * SLOT;
  const durH = (visEnd.getTime() - visStart.getTime()) / 3600000;
  return { top: Math.max(0, top), height: Math.max(30, durH * SLOT - 2) };
}

function movedDate(day: Date, time: string | undefined, source: string, preserveTime: boolean): Date {
  const target = startOfDay(day);
  const sourceDate = new Date(source);
  if (time) {
    const [hours, minutes] = time.split(":").map(Number);
    target.setHours(hours, minutes, 0, 0);
  } else if (preserveTime) {
    target.setHours(sourceDate.getHours(), sourceDate.getMinutes(), 0, 0);
  }
  return target;
}

function isMovable(item: { instanceKey?: string; id: string; recurrence?: unknown; scheduleDaily?: boolean }): boolean {
  return !isRecurring(item) && item.scheduleDaily !== true;
}

function isRecurring(item: { instanceKey?: string; id: string; recurrence?: unknown }): boolean {
  return Boolean(item.recurrence) || Boolean(item.instanceKey && item.instanceKey !== item.id);
}

function headerLabel(anchor: Date, view: View) {
  if (view === "month") return anchor.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  if (view === "week") {
    const ws = addDays(anchor, -((anchor.getDay() + 6) % 7));
    return `${ws.getDate()} – ${addDays(ws, 6).getDate()} ${anchor.toLocaleDateString("es-ES", { month: "short" })}`;
  }
  if (view === "day") return anchor.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return "Agenda";
}
