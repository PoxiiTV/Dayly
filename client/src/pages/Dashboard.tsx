import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ListChecks, CalendarDays, Timer, AlertTriangle, PanelsTopLeft, Target, ArrowRight, Plus, Clock3, MapPin,
  ArrowDown, ArrowUp, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Moon, Sun,
  type LucideIcon,
} from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, EmptyState, Button, PageHeader } from "@/components/ui";
import { TaskItem, TaskEditor, ProgressBar } from "@/components/tasks";
import { RadioPlayer } from "@/components/RadioPlayer";
import type { Task, EventItem } from "@/lib/types";
import { greeting, fmtDate, fmtTime, localKeyInTimeZone } from "@/lib/dates";

interface DashboardData {
  pending: number; completed: number; overdue: number; activeProjects: number; activeGoals: number;
  events: EventItem[]; todaysTasks: Task[]; habitCompletionsToday: number; timeTodaySeconds: number;
  todayTaskTotal: number; todayTaskDone: number;
}

interface WeatherData {
  weather: {
    place: string;
    timezone: string;
    current: { temperatureC: number; apparentC: number; weatherCode: number; label: string; humidity: number; windKmh: number };
    today: { minC: number | null; maxC: number | null; precipitationProbability: number | null };
  };
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const timezone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [dayKey, setDayKey] = useState(() => localKeyInTimeZone(new Date(), timezone));

  useEffect(() => {
    const refreshDayKey = () => {
      const next = localKeyInTimeZone(new Date(), timezone);
      setDayKey((current) => current === next ? current : next);
    };
    refreshDayKey();
    const timer = window.setInterval(refreshDayKey, 30_000);
    return () => window.clearInterval(timer);
  }, [timezone]);

  const { data: dash, isLoading } = useQuery({
    queryKey: ["dashboard", timezone, dayKey],
    queryFn: () => http.get<DashboardData>("/api/calendar/dashboard"),
  });
  const { data: smart } = useQuery({
    queryKey: ["tasks", "smart"],
    queryFn: () => http.get<{ count: { overdue: number }; upcoming: Task[]; important: Task[] }>("/api/tasks/smart"),
  });
  const { data: weather } = useQuery({
    queryKey: ["weather", user?.timezone, user?.weatherCity],
    queryFn: () => http.get<WeatherData>("/api/weather"),
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const [editing, setEditing] = useState<Task | null>(null);

  const name = user?.name?.split(" ")[0] ?? "";
  const total = (dash?.todayTaskTotal ?? dash?.todaysTasks?.length ?? 0) + (dash?.events?.length ?? 0);
  const done = Math.min(dash?.todayTaskDone ?? 0, total);
  const progress = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const agenda: { time?: string; title: string; kind: "event" | "task"; id: string }[] = [
    ...(dash?.events ?? []).map((e) => ({ time: fmtTime(e.startAt), title: e.title, kind: "event" as const, id: e.id })),
    ...(dash?.todaysTasks ?? []).map((t) => ({ time: t.hasTime && t.dueDate ? fmtTime(t.dueDate) : "⏰", title: t.title, kind: "task" as const, id: t.id })),
  ].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  if (isLoading) return <div className="grid place-items-center h-64 text-accent"><Spinner /></div>;

  return (
    // Phone order: what needs doing first, clock and radio last. Desktop keeps its grid.
    <div className="page-shell flex flex-col">
      <PageHeader
        title={`${greeting()}, ${name} ✨`}
        lead={<span className="sentence-case">{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</span>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-stretch max-lg:order-3 max-lg:mb-0">
        <NowWeatherCard weather={weather?.weather} timezone={timezone} timeFormat24={user?.timeFormat24 ?? true} />
        <RadioPlayer />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6 max-lg:order-1">
        <Stat icon={<ListChecks />} label="Pendientes" value={dash?.pending ?? 0} accent onClick={() => navigate("/tasks?status=PENDING")} />
        <Stat icon={<CalendarDays />} label="Completadas hoy" value={dash?.completed ?? 0} onClick={() => navigate("/tasks?status=COMPLETED&completed=today")} />
        <Stat icon={<AlertTriangle />} label="Atrasadas" value={dash?.overdue ?? 0} warn onClick={() => navigate("/tasks?due=overdue")} />
        <Stat icon={<Timer />} label="Enfocado hoy" value={fmtDuration(dash?.timeTodaySeconds ?? 0)} onClick={() => navigate("/pomodoro")} />
        <Stat icon={<PanelsTopLeft />} label="Proyectos" value={dash?.activeProjects ?? 0} onClick={() => navigate("/projects")} />
        <Stat icon={<Target />} label="Objetivos" value={dash?.activeGoals ?? 0} onClick={() => navigate("/goals")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-lg:order-2 max-lg:mb-6">
        <section className="lg:col-span-2 card p-5">
          <div className="card-head">
            <h2 className="card-title">Tareas importantes</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>Ver todas</Button>
          </div>
          {(smart?.important ?? []).length === 0 ? (
            <p className="text-sm text-muted">Nada pendiente por ahora. Buen trabajo ✌️</p>
          ) : (
            <div className="space-y-1">
              {(smart?.important ?? []).slice(0, 10).map((t) => <TaskItem key={t.id} task={t} completeMotion="celebrate" onOpen={setEditing} />)}
            </div>
          )}
          {(smart?.count?.overdue ?? 0) > 0 && (
            <button onClick={() => navigate("/tasks?due=overdue")} className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-danger font-medium hover:bg-danger/10 rounded-lg py-2 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" />{smart?.count.overdue} atrasadas — revisa
            </button>
          )}
        </section>

        <div className="space-y-6 max-lg:order-first">
          <section className="card p-5">
            <div className="card-head">
              <h2 className="card-title">Agenda de hoy</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/day")}>Ver Mi día <ArrowRight className="w-4 h-4" /></Button>
            </div>
            {agenda.length === 0 ? (
              <EmptyState icon={<CalendarDays className="w-6 h-6" />} title="Tu día está libre" hint="Perfecto. No tienes eventos ni tareas para hoy." action={<Button size="sm" onClick={() => navigate("/day")}><Plus className="w-4 h-4" />Organizar mi día</Button>} />
            ) : (
              <ul className="divide-y divide-border/70 stagger">
                {agenda.map((a) => (
                  <li key={a.kind + a.id} className="flex items-center gap-4 py-2.5">
                    <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-muted">{a.time}</span>
                    <span className="flex-1 min-w-0 text-sm text-text flex items-center gap-2">
                      <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", a.kind === "event" ? "bg-accent" : "bg-border")} />
                      <span className="truncate">{a.title}</span>
                    </span>
                    <span className={clsx("chip chip-sm shrink-0", a.kind === "event" ? "bg-accent-soft text-accent-strong" : "bg-bg border border-border text-muted")}>{a.kind === "event" ? "Evento" : "Tarea"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="card-title mb-4">Progreso del día</h2>
            <div className="flex items-center justify-between gap-4 mb-2.5">
              <ProgressBar value={progress} className="flex-1 h-2" />
              <span className="text-lg font-bold tabular-nums text-ok">{progress}%</span>
            </div>
            <p className="text-xs text-muted">{done} de {total} elementos completados</p>
            {progress === 100 && <p className="text-xs text-ok font-medium mt-2">🎉 ¡Día completado!</p>}
          </section>
        </div>
      </div>

      <TaskEditor open={!!editing} onClose={() => setEditing(null)} task={editing} />
    </div>
  );
}

type WeatherLook = { Icon: LucideIcon; gradient: string };

/** WMO codes, as served by Open-Meteo, mapped to icon plus its own colour. */
function weatherLook(code: number, night: boolean): WeatherLook {
  if (code === 0) return night
    ? { Icon: Moon, gradient: "from-indigo-400 to-indigo-700" }
    : { Icon: Sun, gradient: "from-amber-300 to-orange-500" };
  if (code <= 2) return night
    ? { Icon: Moon, gradient: "from-indigo-400 to-slate-700" }
    : { Icon: CloudSun, gradient: "from-amber-300 to-sky-500" };
  if (code === 3) return { Icon: Cloud, gradient: "from-slate-300 to-slate-500" };
  if (code <= 48) return { Icon: CloudFog, gradient: "from-slate-300 to-slate-400" };
  if (code <= 57) return { Icon: CloudDrizzle, gradient: "from-sky-300 to-sky-500" };
  if (code <= 67) return { Icon: CloudRain, gradient: "from-sky-400 to-blue-600" };
  if (code <= 77) return { Icon: CloudSnow, gradient: "from-sky-200 to-cyan-400" };
  if (code <= 82) return { Icon: CloudRain, gradient: "from-blue-400 to-blue-700" };
  if (code <= 86) return { Icon: CloudSnow, gradient: "from-cyan-200 to-sky-400" };
  return { Icon: CloudLightning, gradient: "from-violet-400 to-indigo-700" };
}

function NowWeatherCard({ weather, timezone, timeFormat24 }: { weather?: WeatherData["weather"]; timezone: string; timeFormat24: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const date = new Intl.DateTimeFormat("es-ES", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const clock = new Intl.DateTimeFormat("es-ES", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: timeFormat24 ? "h23" : "h12" }).format(now);
  const seconds = new Intl.DateTimeFormat("es-ES", { timeZone: timezone, second: "2-digit" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("es-ES", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const look = weatherLook(weather?.current.weatherCode ?? 3, hour >= 21 || hour < 7);
  return (
    <section className="card p-5 h-full flex flex-col">
      <h2 className="section-title mb-4"><Clock3 className="w-3.5 h-3.5" />Ahora</h2>
      <div className="flex-1 flex items-center justify-between gap-4 min-h-0">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="text-4xl lg:text-[2.75rem] leading-none font-bold tabular-nums tracking-tight text-text">{clock}</span>
            <span className="text-lg lg:text-xl font-semibold tabular-nums text-faint">{seconds}</span>
          </p>
          <p className="text-sm text-muted sentence-case mt-2.5">{date}</p>
        </div>
        {weather && (
          <div className="flex items-center gap-3 shrink-0">
            <span className={clsx("w-14 h-14 rounded-2xl grid place-items-center bg-gradient-to-br shadow-soft", look.gradient)}>
              <look.Icon className="w-8 h-8 text-white" aria-hidden />
            </span>
            <p className="text-[2.5rem] leading-none font-bold tabular-nums text-text">{Math.round(weather.current.temperatureC)}°</p>
          </div>
        )}
      </div>
      {weather ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 pt-4 border-t border-border/70 text-xs text-muted">
          <span className="inline-flex items-center gap-1 text-text"><MapPin className="w-3.5 h-3.5 text-faint" />{weather.place}</span>
          <span className="sentence-case">{weather.current.label}</span>
          <span className="inline-flex items-center gap-2.5 tabular-nums">
            <span className="inline-flex items-center gap-0.5"><ArrowUp className="w-3.5 h-3.5 text-orange-500" />{weather.today.maxC ?? "—"}°</span>
            <span className="inline-flex items-center gap-0.5"><ArrowDown className="w-3.5 h-3.5 text-sky-500" />{weather.today.minC ?? "—"}°</span>
          </span>
        </div>
      ) : <p className="text-xs text-faint mt-4 pt-4 border-t border-border/70">Clima no disponible ahora.</p>}
    </section>
  );
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return "0m";
  if (h === 0) return m + "m";
  return h + "h " + m + "m";
}

function Stat({ icon, label, value, accent, warn, onClick }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card card-interactive px-3 py-2 flex items-center gap-2.5 text-left active:scale-[.99] min-h-0">
      <span className={clsx(
        "w-8 h-8 rounded-lg grid place-items-center shrink-0 [&>svg]:w-4 [&>svg]:h-4",
        accent ? "bg-accent-soft text-accent-strong" : warn ? "bg-danger/10 text-danger" : "bg-bg border border-border text-muted",
      )}>{icon}</span>
      {/* Stacked on a phone so "Completadas hoy" is read whole, not cut. */}
      <span className="min-w-0 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <span className="text-2xl font-bold tabular-nums text-text leading-none">{value}</span>
        <span className="text-[11px] text-muted truncate">{label}</span>
      </span>
    </button>
  );
}