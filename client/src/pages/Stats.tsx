import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Timer, Target, Flame, AlertTriangle } from "lucide-react";
import { http } from "@/lib/api";
import { Spinner, PageHeader } from "@/components/ui";
import { fmtDuration, PRIORITY_LABEL } from "@/lib/dates";

interface Metric { completed: number; created: number; completionRate: number; completedProjects: number; timeSeconds: number; habitCompletions: number; overdue: number; }
interface StatsData { today: Metric; week: Metric; month: Metric; pendingByPriority: { priority: string; _count: { _all: number } }[]; }

/** Theme tokens so charts retint with the active skin instead of fighting it. */
const PRIORITY = {
  URGENT: "rgb(var(--prio-urgent))",
  HIGH: "rgb(var(--prio-high))",
  NORMAL: "rgb(var(--prio-normal))",
  LOW: "rgb(var(--prio-low))",
};
const RANGE_COLORS = ["rgb(var(--accent))", "rgb(var(--accent-strong))", "rgb(var(--ok))"];

export function Stats({ embedded = false }: { embedded?: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => http.get<StatsData>("/api/stats") });
  if (isLoading || !data) return <div className="grid place-items-center h-64 text-accent"><Spinner /></div>;

  const rows: { key: "today" | "week" | "month"; label: string; color: string }[] = [
    { key: "today", label: "Hoy", color: RANGE_COLORS[0] },
    { key: "week", label: "Semana", color: RANGE_COLORS[1] },
    { key: "month", label: "Mes", color: RANGE_COLORS[2] },
  ];
  const maxTime = Math.max(...rows.map((r) => data[r.key].timeSeconds || 0), 1);
  const maxDone = Math.max(...rows.map((r) => data[r.key].completed), 1);
  const maxPending = Math.max(...(data.pendingByPriority ?? []).map((p) => p._count._all), 1);

  const body = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {rows.map((r) => {
          const m = data[r.key];
          return (
            <div key={r.key} className="card p-5">
              <div className="card-head"><span className="section-title">{r.label}</span><span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} /></div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-2xl font-bold text-text tabular-nums">{m.completed}</p><p className="text-[11px] text-muted flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-ok" />completadas</p></div>
                <div><p className="text-2xl font-bold text-text tabular-nums">{m.completionRate}%</p><p className="text-[11px] text-muted flex items-center gap-1"><Target className="w-3 h-3 text-accent" />tasa de éxito</p></div>
                <div><p className="text-2xl font-bold text-text tabular-nums">{fmtDuration(m.timeSeconds)}</p><p className="text-[11px] text-muted flex items-center gap-1"><Timer className="w-3 h-3 text-accent" />enfocado</p></div>
                <div><p className="text-2xl font-bold text-text tabular-nums">{m.habitCompletions}</p><p className="text-[11px] text-muted flex items-center gap-1"><Flame className="w-3 h-3 text-warn" />hábitos</p></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="card p-5">
          <h2 className="section-title mb-4">Tareas completadas</h2>
          <div className="space-y-3">
            {rows.map((r) => {
              const m = data[r.key];
              return (
                <div key={r.key}>
                  <div className="flex justify-between text-xs text-muted mb-1"><span>{r.label}</span><span>{m.completed}</span></div>
                  <div className="h-2 rounded-full bg-border/50"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(m.completed / maxDone) * 100}%`, background: r.color }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-4"><AlertTriangle className="w-4 h-4 text-danger" />Pendientes por prioridad</h2>
          <div className="space-y-3">
            {(data.pendingByPriority ?? []).map((p) => {
              const c = PRIORITY[p.priority as keyof typeof PRIORITY] ?? PRIORITY.LOW;
              return (
                <div key={p.priority}>
                  <div className="flex justify-between text-xs text-muted mb-1"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{PRIORITY_LABEL[p.priority] ?? p.priority}</span><span>{p._count._all}</span></div>
                  <div className="h-2 rounded-full bg-border/50"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${(p._count._all / maxPending) * 100}%`, background: c }} /></div>
                </div>
              );
            })}
            {(data.pendingByPriority ?? []).length === 0 && <p className="text-sm text-muted">Nada pendiente 🎉</p>}
          </div>
        </section>
      </div>
    </>
  );

  if (embedded) return body;
  return (
    <div className="page-shell">
      <PageHeader title="Estadísticas" />
      {body}
    </div>
  );
}