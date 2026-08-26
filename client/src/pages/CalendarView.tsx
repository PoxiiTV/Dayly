import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GripVertical, MapPin, Plus } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { EventItem, Task } from "@/lib/types";
import { Spinner, Button, Modal, Input, Segmented, Select, useToast, PageHeader } from "@/components/ui";
import { fmtTime, localKey, addDays, startOfDay, iso } from "@/lib/dates";

type View = "month" | "week" | "day" | "agenda";
type DraftKind = "task" | "event";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const SLOT = 56;
const HEAD = 36;
type DragState = [{ kind: string; id: string } | null, React.Dispatch<React.SetStateAction<{ kind: string; id: string } | null>>];

function pad(n: number) { return String(n).padStart(2, "0"); }
const DAY_HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CalendarView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { user } = useAuth();
  const startH = user?.calendarStartHour ?? 8;

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [dragging, setDragging] = useState<{ kind: string; id: string } | null>(null);
  const [draft, setDraft] = useState<{ day: string; time: string; kind: DraftKind } | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFreq, setDraftFreq] = useState("");

  const { from, to } = useMemo(() => range(anchor, view), [anchor, view]);
  const { data, isLoading } = useQuery({
    queryKey: ["calendar", from, to],
    queryFn: () => http.get<{ events: EventItem[]; tasks: Task[] }>("/api/calendar", { from, to }),
  });
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];

  const nav = (dir: number) => setAnchor((a) => view === "month" ? shiftMonth(a, dir) : view === "week" ? addDays(a, dir * 7) : addDays(a, dir));
  const today = () => setAnchor(startOfDay(new Date()));

  const openDraft = (day: Date, time: string, kind: DraftKind = "event") => {
    setDraftTitle("");
    setDraftFreq("");
    setDraft({ day: localKey(day), time, kind });
  };

  const drop = async (day: Date, time?: string) => {
    if (!dragging) return;
    try {
      if (dragging.kind === "event") {
        const ev = events.find((e) => e.id === dragging.id);
        if (!ev) return;
        const start = new Date(day);
        start.setHours(time ? Number(time.split(":")[0]) : new Date(ev.startAt).getHours(), time ? Number(time.split(":")[1]) : new Date(ev.startAt).getMinutes(), 0, 0);
        const dur = new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime();
        await http.patch(`/api/events/${ev.id}/move`, { startAt: start.toISOString(), endAt: new Date(start.getTime() + dur).toISOString() });
        push("success", "Evento movido");
      } else {
        const due = new Date(day);
        if (time) {
          const [hh, mm] = time.split(":").map(Number);
          due.setHours(hh, mm, 0, 0);
        } else due.setHours(12, 0, 0, 0);
        await http.patch(`/api/tasks/${dragging.id}/move`, { dueDate: due.toISOString() });
        push("success", "Tarea movida");
      }
      qc.invalidateQueries();
    } catch (e: any) { push("error", e.message); }
    setDragging(null);
  };

  const createDraft = async () => {
    if (!draft || !draftTitle.trim()) return;
    try {
      const s = new Date(`${draft.day}T${draft.time}:00`);
      if (draft.kind === "task") {
        const t = await http.post<{ task: Task }>("/api/tasks", {
          title: draftTitle.trim(), dueDate: iso(s), hasTime: true,
          recurrence: draftFreq ? { frequency: draftFreq, interval: 1 } : undefined,
        });
        push("success", `Tarea «${t.task.title}» creada`);
      } else {
        const ev = await http.post<{ event: EventItem }>("/api/events", {
          title: draftTitle.trim(), startAt: iso(s), endAt: iso(new Date(s.getTime() + 3600000)),
          recurrence: draftFreq ? { frequency: draftFreq, interval: 1 } : undefined,
        });
        push("success", `Evento «${ev.event.title}» creado`);
      }
      setDraftTitle(""); setDraft(null); setDraftFreq("");
      qc.invalidateQueries();
    } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="page-shell flex flex-col h-[calc(100vh-120px)] md:h-[calc(100vh-96px)]">
      <PageHeader
        title="Calendario"
        lead={<span className="capitalize">{headerLabel(anchor, view)}</span>}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={today}>Hoy</Button>
            <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => nav(1)}><ChevronRight className="w-4 h-4" /></Button>
            <Segmented options={[{ value: "month", label: "Mes" }, { value: "week", label: "Semana" }, { value: "day", label: "Día" }, { value: "agenda", label: "Agenda" }]} value={view} onChange={setView} />
          </>
        }
      />

      <div className="card flex-1 overflow-hidden min-h-0">
        {isLoading ? <div className="grid place-items-center h-full"><Spinner /></div> : view === "month" ? (
          <MonthGrid anchor={anchor} events={events} tasks={tasks}
            onDayOpen={(d) => { setAnchor(startOfDay(d)); setView("day"); }}
            onCreate={(d) => openDraft(d, `${pad(Math.max(startH, 9))}:00`, "event")}
            onDrop={drop} dragging={[dragging, setDragging]} />
        ) : view === "week" || view === "day" ? (
          <TimeGrid
            days={view === "week" ? weekDays(anchor) : [startOfDay(anchor)]}
            hours={DAY_HOURS} events={events} tasks={tasks} onDrop={drop}
            dragging={[dragging, setDragging]}
            onCreate={(d, time) => openDraft(d, time, "event")}
          />
        ) : (
          <AgendaView events={events} tasks={tasks} onCreate={() => openDraft(anchor, `${pad(Math.max(startH, 9))}:00`, "event")} />
        )}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Nuevo en el calendario"
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button><Button onClick={createDraft}>Crear</Button></>}>
        <Segmented
          options={[{ value: "event", label: "Evento" }, { value: "task", label: "Tarea" }]}
          value={draft?.kind ?? "event"}
          onChange={(k) => setDraft((d) => d ? { ...d, kind: k } : d)}
          className="!flex w-full [&>button]:flex-1"
        />
        <Input label="Título" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder={draft?.kind === "task" ? "Ej. Llamar al cliente" : "Ej. Reunión"} autoFocus />
        <div className="modal-grid">
          <Input label="Día" type="date" value={draft?.day ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, day: e.target.value } : d)} />
          <Input label="Hora" type="time" value={draft?.time ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, time: e.target.value } : d)} />
        </div>
        <Select label="Repetición" value={draftFreq} onChange={(e) => setDraftFreq(e.target.value)}>
          <option value="">No se repite</option>
          <option value="DAILY">Cada día</option>
          <option value="WEEKLY">Cada semana</option>
          <option value="MONTHLY">Cada mes</option>
        </Select>
      </Modal>
    </div>
  );
}

function MonthGrid({ anchor, events, tasks, onDayOpen, onCreate, onDrop, dragging }: {
  anchor: Date; events: EventItem[]; tasks: Task[];
  onDayOpen: (d: Date) => void; onCreate: (d: Date) => void;
  onDrop: (d: Date) => void; dragging: DragState;
}) {
  const [drag, setDrag] = dragging;
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-7 h-full min-h-0">
      {WEEKDAYS.map((d) => <div key={d} className="text-center text-[11px] font-semibold text-faint py-2 uppercase tracking-wide border-b border-border/50 bg-surface">{d}</div>)}
      {cells.map((day) => {
        const key = localKey(day);
        const dayEvents = events.filter((e) => localKey(new Date(e.startAt)) === key);
        const dayTasks = tasks.filter((t) => t.dueDate && localKey(new Date(t.dueDate)) === key);
        const isToday = key === localKey(new Date());
        const inMonth = day.getMonth() === anchor.getMonth();
        return (
          <div key={key}
            onClick={() => onCreate(day)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag) onDrop(day); }}
            className={clsx("group border-b border-r border-border/50 p-1 min-h-[84px] cursor-pointer transition-colors hover:bg-accent-soft/30", !inMonth && "opacity-40")}>
            <div className="flex items-center justify-between mb-1">
              <button type="button" onClick={(e) => { e.stopPropagation(); onDayOpen(day); }}
                className={clsx("inline-flex w-6 h-6 items-center justify-center rounded-full text-xs", isToday ? "bg-accent text-white font-bold" : "text-muted hover:bg-surface")}>
                {day.getDate()}
              </button>
              <Plus className="w-3.5 h-3.5 text-faint opacity-0 group-hover:opacity-100" />
            </div>
            <div className="space-y-0.5">
              {dayEvents.slice(0, 3).map((e) => (
                <div key={e.instanceKey ?? e.id} draggable onClick={(ev) => ev.stopPropagation()} onDragStart={() => setDrag({ kind: "event", id: e.id })}
                  className="text-[11px] leading-tight rounded-md px-1.5 py-0.5 text-white truncate cursor-grab" style={{ background: e.color ?? "#1d4ed8" }}>{fmtTime(e.startAt)} {e.title}</div>
              ))}
              {dayTasks.slice(0, 3).map((t) => (
                <div key={t.id} draggable onClick={(ev) => ev.stopPropagation()} onDragStart={() => setDrag({ kind: "task", id: t.id })}
                  className="text-[11px] leading-tight rounded-md px-1.5 py-0.5 bg-surface border border-border text-muted truncate cursor-grab">{t.title}</div>
              ))}
              {(dayEvents.length + dayTasks.length) > 3 && <div className="text-[10px] text-faint pl-1">+{dayEvents.length + dayTasks.length - 3} más</div>}
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

function TimeGrid({ days, hours, events, tasks, onDrop, dragging, onCreate }: {
  days: Date[]; hours: number[]; events: EventItem[]; tasks: Task[];
  onDrop: (d: Date, t: string) => void; dragging: DragState;
  onCreate: (d: Date, time: string) => void;
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
  const startH = hours[0] ?? 0;
  const gridH = hours.length * SLOT;
  const labels = [...hours, startH + hours.length];

  const slotTime = (el: HTMLElement, clientY: number, h: number) => {
    const rect = el.getBoundingClientRect();
    const half = clientY - rect.top > rect.height / 2;
    return `${pad(h)}:${half ? "30" : "00"}`;
  };

  const busyKeys = new Set([
    ...events.map((e) => localKey(new Date(e.startAt))),
    ...tasks.filter((t) => t.dueDate).map((t) => localKey(new Date(t.dueDate!))),
  ]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const now = new Date();
    const showNow = gridDays.some((d) => localKey(d) === localKey(now));
    const hour = showNow ? now.getHours() + now.getMinutes() / 60 : 8;
    el.scrollTop = Math.max(0, (hour - startH) * SLOT - SLOT);
  }, [days, startH, selected, mobileWeek]);

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
        <div className={clsx("shrink-0 border-r border-border/50", mobileWeek ? "w-11" : "w-14")}>
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
          const dayEvents = events.filter((e) => localKey(new Date(e.startAt)) === key);
          const dayTasks = tasks.filter((t) => t.dueDate && localKey(new Date(t.dueDate)) === key);
          const isToday = key === localKey(new Date());
          const weekday = WEEKDAYS[(d.getDay() + 6) % 7];
          const headLabel = `${weekday} ${d.getDate()}${isToday ? " · Hoy" : ""}`;
          return (
            <div key={key} className={clsx("flex-1 relative border-r border-border/50 min-w-0", !mobileWeek && isWeek && "md:min-w-[120px]")}>
              <div className={clsx("sticky top-0 z-20 bg-surface text-center text-xs font-semibold border-b border-border/50 flex items-center justify-center gap-1 px-1", isToday && "text-accent")}
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
                  const top = ((new Date(e.startAt).getHours() - startH) * 60 + new Date(e.startAt).getMinutes()) / 60 * SLOT;
                  const durH = (new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 3600000;
                  return (
                    <div key={e.instanceKey ?? e.id} draggable
                      onClick={(ev) => ev.stopPropagation()}
                      onDragStart={() => setDrag({ kind: "event", id: e.id })}
                      className="absolute left-1 right-1 z-[1] rounded-lg px-2 py-1 text-xs text-white shadow-soft cursor-grab active:cursor-grabbing overflow-hidden"
                      style={{ top, height: Math.max(30, durH * SLOT - 2), background: e.color ?? "#1d4ed8" }}>
                      <div className="flex items-center gap-1 font-medium"><GripVertical className="w-3 h-3 opacity-70" />{fmtTime(e.startAt)} · {e.title}</div>
                      {e.location && <div className="text-[10px] opacity-80 flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5" />{e.location}</div>}
                    </div>
                  );
                })}
                {dayTasks.slice(0, 4).map((t) => {
                  const due = new Date(t.dueDate!);
                  const top = Math.max((due.getHours() - startH) * SLOT + due.getMinutes() / 60 * SLOT, 0);
                  return (
                    <div key={t.id} draggable
                      onClick={(ev) => ev.stopPropagation()}
                      onDragStart={() => setDrag({ kind: "task", id: t.id })}
                      className="absolute left-1 right-1 z-[1] rounded-md bg-surface border border-dashed border-border px-2 py-1 text-xs text-muted cursor-grab"
                      style={{ top }}>
                      ⚡ {t.title}
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

function AgendaView({ events, tasks, onCreate }: { events: EventItem[]; tasks: Task[]; onCreate: () => void }) {
  const items = [
    ...events.map((e) => ({ at: new Date(e.startAt).getTime(), kind: "event", title: e.title, time: `${fmtTime(e.startAt)}–${fmtTime(e.endAt)}` })),
    ...tasks.filter((t) => t.dueDate).map((t) => ({ at: new Date(t.dueDate!).getTime(), kind: "task", title: t.title, time: t.hasTime ? fmtTime(t.dueDate!) : "todo el día" })),
  ].sort((a, b) => a.at - b.at);
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
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-4 py-2.5 border-b border-border/50">
          <span className={"w-24 shrink-0 text-xs tabular-nums " + (it.kind === "event" ? "text-accent-strong font-medium" : "text-muted")}>{it.time}</span>
          <span className={"flex-1 text-sm " + (it.kind === "event" ? "font-medium text-text" : "text-muted")}><span className={clsx("w-2 h-2 rounded-full inline-block mr-2", it.kind === "event" ? "bg-accent" : "bg-border")} />{it.title}</span>
        </div>
      ))}
    </div>
  );
}

function range(anchor: Date, view: View) {
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return { from: localKey(start), to: localKey(addDays(start, 42)) };
  }
  if (view === "week") {
    const monday = addDays(startOfDay(anchor), -((anchor.getDay() + 6) % 7));
    return { from: localKey(monday), to: localKey(addDays(monday, 7)) };
  }
  const from = startOfDay(anchor);
  return { from: localKey(from), to: localKey(addDays(from, 2)) };
}
function shiftMonth(d: Date, dir: number) { return new Date(d.getFullYear(), d.getMonth() + dir, 1); }
function weekDays(anchor: Date): Date[] {
  const monday = addDays(startOfDay(anchor), -((anchor.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
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
