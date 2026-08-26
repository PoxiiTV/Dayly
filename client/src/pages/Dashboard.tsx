import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ListChecks, CalendarDays, Timer, AlertTriangle, PanelsTopLeft, Target, ArrowRight, Plus } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, EmptyState, Button, PageHeader } from "@/components/ui";
import { TaskItem, ProgressBar } from "@/components/tasks";
import type { Task, EventItem } from "@/lib/types";
import { greeting, fmtDate, fmtTime } from "@/lib/dates";

interface DashboardData {
  pending: number; completed: number; overdue: number; activeProjects: number; activeGoals: number;
  events: EventItem[]; todaysTasks: Task[]; habitCompletionsToday: number; timeTodaySeconds: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: dash, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => http.get<DashboardData>("/api/calendar/dashboard"),
  });
  const { data: smart } = useQuery({
    queryKey: ["tasks", "smart"],
    queryFn: () => http.get<{ count: { overdue: number }; upcoming: Task[]; important: Task[] }>("/api/tasks/smart"),
  });

  const name = user?.name?.split(" ")[0] ?? "";
  const total = (dash?.todaysTasks?.length ?? 0) + (dash?.events?.length ?? 0);
  const done = dash?.completed ?? 0;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const agenda: { time?: string; title: string; kind: "event" | "task"; id: string }[] = [
    ...(dash?.events ?? []).map((e) => ({ time: fmtTime(e.startAt), title: e.title, kind: "event" as const, id: e.id })),
    ...(dash?.todaysTasks ?? []).map((t) => ({ time: t.hasTime && t.dueDate ? fmtTime(t.dueDate) : "⏰", title: t.title, kind: "task" as const, id: t.id })),
  ].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  if (isLoading) return <div className="grid place-items-center h-64"><Spinner /></div>;

  return (
    <div className="page-shell">
      <PageHeader
        title={`${greeting()}, ${name} ✨`}
        lead={<span className="capitalize">{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</span>}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <Stat icon={<ListChecks />} label="Pendientes" value={dash?.pending ?? 0} accent />
        <Stat icon={<CalendarDays />} label="Completadas hoy" value={dash?.completed ?? 0} />
        <Stat icon={<AlertTriangle />} label="Atrasadas" value={dash?.overdue ?? 0} warn />
        <Stat icon={<Timer />} label="Enfocado hoy" value={fmtDuration(dash?.timeTodaySeconds ?? 0)} />
        <Stat icon={<PanelsTopLeft />} label="Proyectos" value={dash?.activeProjects ?? 0} />
        <Stat icon={<Target />} label="Objetivos" value={dash?.activeGoals ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agenda de hoy */}
        <section className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-text">Agenda de hoy</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/day")}>Ver Mi día <ArrowRight className="w-4 h-4" /></Button>
          </div>
          {agenda.length === 0 ? (
            <EmptyState icon={<CalendarDays className="w-6 h-6" />} title="Tu día está libre" hint="Perfecto. No tienes eventos ni tareas para hoy." action={<Button size="sm" onClick={() => navigate("/day")}><Plus className="w-4 h-4" />Organizar mi día</Button>} />
          ) : (
            <ul className="divide-y divide-border/70">
              {agenda.map((a) => (
                <li key={a.kind + a.id} className="flex items-center gap-4 py-2.5">
                  <span className="w-14 shrink-0 text-sm font-medium tabular-nums text-muted">{a.time}</span>
                  <span className={"flex-1 text-sm " + (a.kind === "event" ? "font-medium text-text" : "text-text")}>
                    {a.kind === "event" && <span className="w-2 h-2 rounded-full inline-block mr-2 mb-0.5 bg-accent" />}
                    {a.title}
                  </span>
                  <span className={"text-[10px] px-2 py-0.5 rounded-full " + (a.kind === "event" ? "bg-accent-soft text-accent-strong" : "bg-surface border border-border text-muted")}>{a.kind === "event" ? "Evento" : "Tarea"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Right column: progress + important */}
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-semibold text-text mb-3">Progreso del día</h2>
            <div className="flex items-end justify-between gap-4 mb-2">
              <ProgressBar value={progress} className="flex-1 h-2" />
              <span className="text-lg font-bold tabular-nums text-ok">{progress}%</span>
            </div>
            <p className="text-xs text-muted">{dash?.completed ?? 0} de {total} elementos completados</p>
            {progress === 100 && <p className="text-xs text-ok font-medium mt-2">🎉 ¡Día completado!</p>}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-text">Tareas importantes</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>Ver todas</Button>
            </div>
            {(smart?.important ?? []).length === 0 ? (
              <p className="text-sm text-muted">Nada pendiente por ahora. Buen trabajo ✌️</p>
            ) : (
              <div className="space-y-1">
                {(smart?.important ?? []).slice(0, 6).map((t) => <TaskItem key={t.id} task={t} completeMotion="celebrate" onOpen={() => navigate("/tasks")} />)}
              </div>
            )}
            {(smart?.count?.overdue ?? 0) > 0 && (
              <button onClick={() => navigate("/tasks?due=overdue")} className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-danger font-medium hover:bg-danger/10 rounded-lg py-2 transition-colors">
                <AlertTriangle className="w-3.5 h-3.5" />{smart?.count.overdue} atrasadas — revisa
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return "0m";
  if (h === 0) return m + "m";
  return h + "h " + m + "m";
}

function Stat({ icon, label, value, accent, warn }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean; warn?: boolean }) {
  return (
    <div className="card p-4 flex flex-col gap-1.5 hover:shadow-pop transition-shadow">
      <span className={"w-8 h-8 rounded-lg grid place-items-center " + (accent ? "bg-accent-soft text-accent-strong" : warn ? "bg-danger/10 text-danger" : "bg-border/40 text-muted")}>{icon}</span>
      <span className="text-xl font-bold tabular-nums text-text leading-none">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}