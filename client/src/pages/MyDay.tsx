import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, ArrowRight, CheckCircle2, AlertTriangle, ListChecks, Plus, Sparkles, Timer } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, EmptyState, Button, useToast, PageHeader } from "@/components/ui";
import { TaskItem, TaskEditor } from "@/components/tasks";
import { AiDayPlanPanel } from "@/components/AiAssist";
import { loadDayPlan, useAiEnabled } from "@/lib/ai";
import type { Task, EventItem, Priority } from "@/lib/types";
import { fmtTime, localKey } from "@/lib/dates";
import { DEFAULT_ENTITY_COLOR } from "@/lib/projects";

interface DayData {
  date: string; now: Item[]; next: Item[]; done: Task[]; overdue: Task[];
  timeline?: Item[];
  progress: number; counts: { total: number; done: number; overdue: number };
}
interface Item { id: string; title: string; kind: "event" | "task"; at: string; end?: string; color?: string | null; hasTime?: boolean }

export function MyDay() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [date, setDate] = useState(() => localKey(new Date()));
  const [createOpen, setCreateOpen] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const [planHidden, setPlanHidden] = useState(false);
  const aiEnabled = useAiEnabled();
  const { data, isLoading } = useQuery({
    queryKey: ["myday", date],
    queryFn: () => http.get<DayData>("/api/calendar/my-day", { date }),
  });
  const { data: projectsData } = useQuery({ queryKey: ["projects"], queryFn: () => http.get<{ projects: { id: string; name: string }[] }>("/api/projects") });
  const projects = projectsData?.projects ?? [];

  const isToday = date === localKey(new Date());
  const hasSavedPlan = Boolean(loadDayPlan(user?.id, date, localKey(new Date())));

  const deadline = async (t: Task) => {
    try { await http.post(`/api/tasks/${t.id}/postpone`, { days: 1 }); qc.invalidateQueries(); push("success", "Pospuesta a mañana"); } catch (e: any) { push("error", e.message); }
  };

  // Timeline 8:00–20:00
  const hourItems = new Map<number, Item[]>();
  const timeline = data?.timeline ?? data?.next ?? [];
  for (const item of timeline) {
    const h = wallTime(item.at, user?.timezone).hour;
    if (!hourItems.has(h)) hourItems.set(h, []);
    hourItems.get(h)!.push(item);
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Mi día"
        lead={isToday ? "Tu centro de control de hoy" : "Planificación del día"}
        actions={
          <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-auto h-10" />
            <Button variant="secondary" onClick={() => navigate("/pomodoro?start=1")}>
              <Timer className="w-4 h-4" />25 min
            </Button>
            {aiEnabled && (
              <Button variant="secondary" onClick={() => { setPlanOpen(true); setPlanHidden(false); }} aria-pressed={planOpen}>
                <Sparkles className="w-4 h-4" />Plan del día
              </Button>
            )}
            <Button onClick={() => { setEditorNonce((n) => n + 1); setCreateOpen(true); }}><Plus className="w-4 h-4" />Nuevo</Button>
          </>
        }
      />

      {aiEnabled && (planOpen || (isToday && !planHidden && hasSavedPlan)) && (
        <AiDayPlanPanel key={date} date={date} today={localKey(new Date())} userId={user?.id} onClose={() => { setPlanOpen(false); setPlanHidden(true); }} />
      )}

      {isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> : !data ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Timeline */}
          <section className="lg:col-span-3 card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Timeline</h2>
              <span className="text-xs text-faint">Arrastra en el calendario para mover</span>
            </div>
            <div className="relative">
              {Array.from({ length: 13 }, (_, i) => 8 + i).map((h) => {
                const items = hourItems.get(h) ?? [];
                return (
                  <div key={h} className="flex gap-3 min-h-[54px] border-b border-border/40">
                    <span className="w-12 pt-1 text-xs tabular-nums text-faint text-right">{String(h).padStart(2, "0")}:00</span>
                    <div className="flex-1 relative">
                      {items.map((it) => {
                        const startMin = wallTime(it.at, user?.timezone).minute;
                        const isEv = it.kind === "event";
                        return (
                          <div key={`${it.kind}:${it.id}`} className={clsx("absolute left-0 right-0 rounded-lg px-2 py-1 text-xs overflow-hidden", isEv ? "text-white" : "bg-surface border border-border")}
                            style={{ top: (startMin / 60) * 54, minHeight: 30, background: isEv ? (it.color ?? DEFAULT_ENTITY_COLOR) : undefined }}>
                            <span className="font-medium truncate block">{isEv && formatRange(it.at, it.end)}{isEv ? " " : ""}{it.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Control center */}
          <div className="lg:col-span-2 space-y-5">
            <section className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="section-title"><Timer className="w-4 h-4 text-accent" />Ahora</h2>
                <CircularProgress value={data.progress} />
              </div>
              {(data.now ?? []).length === 0 ? (
                <p className="text-sm text-muted">{isToday ? "Nada en marcha ahora mismo." : "Nada programado para este momento."}</p>
              ) : (
                <ul className="space-y-2">
                  {(data.now ?? []).map((n) => <li key={n.kind + n.id} className="flex items-center gap-3 text-sm"><span className={clsx("w-2 h-2 rounded-full", n.kind === "event" ? "bg-accent" : "bg-warn")} />{n.title}</li>)}
                </ul>
              )}
            </section>

            <section className="card p-5">
              <h2 className="section-title mb-3"><Play className="w-4 h-4 text-accent" />Próximo</h2>
              {(data.next ?? []).length === 0 ? <p className="text-sm text-muted">Sin eventos ni tareas programadas.</p> :
                <ul className="space-y-2.5">{data.next.map((n) => (
                  <li key={n.kind + n.id} className="flex items-center gap-3 text-sm">
                    <span className={clsx("chip chip-sm tabular-nums", n.kind === "event" ? "bg-accent-soft text-accent-strong" : "bg-surface border border-border text-muted")}>{fmtTime(n.at)}</span>
                    <span className="font-medium text-text">{n.title}</span>
                    {n.kind === "event" && <span className="ml-auto text-[10px] text-faint">{n.end ? fmtDurationRange(n.at, n.end) : ""}</span>}
                  </li>
                ))}</ul>}
            </section>

            {(data.overdue ?? []).length > 0 && (
              <section className="card p-5 border-danger/20">
                <h2 className="section-title text-danger mb-3"><AlertTriangle className="w-4 h-4" />Atrasado ({data.overdue.length})</h2>
                <ul className="space-y-1 text-sm">{data.overdue.map((t) => <li key={t.id} className="flex items-center gap-2"><span className="flex-1 line-through decoration-danger/50 text-muted">{t.title}</span><button onClick={() => deadline(t)} className="text-xs text-accent hover:underline">Posponer</button></li>)}</ul>
              </section>
            )}

            <section className="card p-5 border-ok/20">
              <h2 className="section-title text-ok mb-3"><CheckCircle2 className="w-4 h-4" />Completado</h2>
              {data.done.length === 0 ? <p className="text-sm text-muted">Aún no has completado nada hoy.</p> : <ul className="space-y-1 text-sm line-through text-faint">{data.done.slice(0, 8).map((t) => <li key={t.id}>{t.title}</li>)}</ul>}
            </section>
          </div>
        </div>
      )}

      <TaskEditor key={`new-${editorNonce}`} open={createOpen} onClose={() => setCreateOpen(false)} projects={projects} tags={[]} now />
    </div>
  );
}

function CircularProgress({ value }: { value: number }) {
  const r = 16, c = 2 * Math.PI * r;
  return (
    <div className="relative w-10 h-10">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-border" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-ok transition-all duration-500" strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[10px] font-bold text-text tabular-nums">{value}%</span>
    </div>
  );
}
function formatRange(s: string, e?: string): string {
  const a = new Date(s), b = e ? new Date(e) : null;
  return b ? `${fmtTime(a)}–${fmtTime(b)}` : fmtTime(a);
}
function fmtDurationRange(s: string, e: string): string {
  const mins = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? mins % 60 + "m" : ""}` : mins + "m";
}

function wallTime(value: string, timeZone?: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    return {
      hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
      minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
    };
  } catch {
    const date = new Date(value);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}
