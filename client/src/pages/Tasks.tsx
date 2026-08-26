import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ListTodo, Filter, AlertTriangle, CalendarX2 } from "lucide-react";
import { http } from "@/lib/api";
import { Spinner, EmptyState, Button, Segmented, useToast, PageHeader } from "@/components/ui";
import { TaskItem, TaskEditor } from "@/components/tasks";
import type { Priority, Task, Project, Tag, TaskStatus } from "@/lib/types";
import { localKey } from "@/lib/dates";

type FilterVal = "all" | "today" | "upcoming" | "overdue" | "high" | "unscheduled";

function priorityRank(p: Priority): number {
  switch (p) {
    case "URGENT": return 0;
    case "HIGH": return 1;
    case "NORMAL": return 2;
    case "LOW": return 3;
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

/** Día de caducidad → prioridad alta a baja → hora más próxima. Sin fecha, al final. */
function compareOpenTasks(a: Task, b: Task): number {
  const aDay = a.dueDate ? localKey(new Date(a.dueDate)) : "9999-99-99";
  const bDay = b.dueDate ? localKey(new Date(b.dueDate)) : "9999-99-99";
  const byDay = aDay.localeCompare(bDay);
  if (byDay) return byDay;

  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority) return byPriority;

  const byRemaining = remainingMs(a) - remainingMs(b);
  if (byRemaining) return byRemaining;

  return a.createdAt.localeCompare(b.createdAt);
}

function remainingMs(task: Task): number {
  if (!task.dueDate) return Number.POSITIVE_INFINITY;
  const d = new Date(task.dueDate);
  if (!task.hasTime) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function Tasks() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [view, setView] = useState<FilterVal>(() => {
    const p = new URLSearchParams(window.location.hash.replace("#", "?"));
    return ((["overdue", "today", "upcoming", "high", "unscheduled"] as FilterVal[]).includes(p.get("due") as FilterVal)) ? (p.get("due") as FilterVal) : "all";
  });
  const [filter, setFilter] = useState<"all" | TaskStatus | "completed">("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "list", projectFilter, priorityFilter, q],
    queryFn: () => http.get<{ tasks: Task[] }>("/api/tasks", {
      projectId: projectFilter || undefined,
      priority: priorityFilter || undefined,
      q: q || undefined,
      includeCompleted: "true",
    }),
  });
  useQuery({ queryKey: ["projects"], queryFn: () => http.get<{ projects: Project[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });
  useQuery({ queryKey: ["tags"], queryFn: () => http.get<{ tags: Tag[] }>("/api/tags").then((d) => { setTags(d.tags); return d; }) });

  const { data: smart } = useQuery({ queryKey: ["tasks", "smart"], queryFn: () => http.get<{ count: { overdue: number; today: number; unscheduled: number } }>("/api/tasks/smart") });

  const tasks = data?.tasks ?? [];
  const todayKey = localKey(new Date());

  const openTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === "COMPLETED") return false;
      if (filter === "completed") return false;
      if (filter !== "all" && t.status !== filter) return false;
      if (view === "today") return !!t.dueDate && localKey(new Date(t.dueDate)) === todayKey;
      if (view === "upcoming") return !!t.dueDate && new Date(t.dueDate).getTime() > Date.now();
      if (view === "overdue") return !!t.dueDate && new Date(t.dueDate).getTime() < Date.now();
      if (view === "unscheduled") return !t.dueDate;
      if (view === "high") return t.priority === "HIGH" || t.priority === "URGENT";
      return true;
    }).sort(compareOpenTasks);
  }, [tasks, filter, view, todayKey]);

  const doneTasks = useMemo(() => {
    if (filter !== "all" && filter !== "completed") return [];
    return [...tasks.filter((t) => t.status === "COMPLETED")]
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.createdAt.localeCompare(b.createdAt));
  }, [tasks, filter]);

  const clearFilters = () => { setView("all"); setFilter("all"); setProjectFilter(""); setPriorityFilter(""); setQ(""); };

  return (
    <div className="page-shell">
      <PageHeader
        title="Tareas"
        actions={<Button onClick={() => { setEditing(null); setEditorNonce((n) => n + 1); setCreateOpen(true); }}><Plus className="w-4 h-4" />Nueva tarea</Button>}
      />

      <Display smart={smart} onView={setView} activeView={view} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Segmented options={[{ value: "all", label: "Todas" }, { value: "today", label: "Hoy" }, { value: "upcoming", label: "Próximas" }, { value: "overdue", label: "Atrasadas" }, { value: "high", label: "Importantes" }]} value={view} onChange={setView} />
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}><Filter className="w-4 h-4" />Filtros</Button>
      </div>

      {showFilters && (
        <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as never)}>
            <option value="all">Estado: todas</option><option value="PENDING">Pendientes</option><option value="IN_PROGRESS">En progreso</option><option value="POSTPONED">Pospuestas</option><option value="completed">Completadas</option>
          </select>
          <select className="input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Proyecto: todos</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">Prioridad: todas</option><option value="URGENT">Urgente</option><option value="HIGH">Alta</option><option value="NORMAL">Normal</option><option value="LOW">Baja</option>
          </select>
        </div>
      )}

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        filter !== "completed" && openTasks.length === 0 && doneTasks.length === 0 ? (
          <EmptyState
            icon={view === "high" ? <AlertTriangle className="w-6 h-6" /> : <ListTodo className="w-6 h-6" />}
            title={
              view === "overdue" ? "Nada atrasado"
                : view === "high" || !!projectFilter || !!priorityFilter || !!q
                  ? "Sin resultados"
                  : "No hay tareas aquí"
            }
            hint={
              view === "high" || !!projectFilter || !!priorityFilter || !!q
                ? "Prueba con otros filtros."
                : "Perfecto. Todo está bajo control."
            }
            action={<Button size="sm" onClick={() => { setEditing(null); setEditorNonce((n) => n + 1); setCreateOpen(true); }}><Plus className="w-4 h-4" />Crear tarea</Button>}
          />
        ) : filter === "completed" && doneTasks.length === 0 ? (
          <EmptyState icon={<ListTodo className="w-6 h-6" />} title="Sin tareas completadas" hint="Cuando completes una, aparecerá aquí." />
        ) : (
          <div className="space-y-5">
            {filter !== "completed" && (
              <section>
                <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Pendientes ({openTasks.length})</h2>
                <div className="card divide-y divide-border/60 px-1 overflow-visible">
                  {openTasks.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted text-center">Ninguna tarea pendiente</p>
                  ) : openTasks.map((t) => (
                    <div key={t.id} className="px-2"><TaskItem task={t} onOpen={(task) => { setCreateOpen(false); setEditing(task); }} /></div>
                  ))}
                </div>
              </section>
            )}
            {doneTasks.length > 0 && (
              <section>
                <h2 className="font-semibold text-text mb-2 text-sm uppercase tracking-wide text-faint">Completadas ({doneTasks.length})</h2>
                <div className="card divide-y divide-border/60 px-1 overflow-visible opacity-70">
                  {doneTasks.map((t) => (
                    <div key={t.id} className="px-2"><TaskItem task={t} onOpen={(task) => { setCreateOpen(false); setEditing(task); }} /></div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )
      }

      <TaskEditor
        key={editing?.id ?? `new-${editorNonce}`}
        open={createOpen || !!editing}
        onClose={() => { setCreateOpen(false); setEditing(null); }}
        task={editing}
        projects={projects}
        tags={tags}
      />
    </div>
  );
}

function Display({ smart, onView, activeView }: { smart: { count: { overdue: number; today: number; unscheduled: number } } | undefined; onView: (v: FilterVal) => void; activeView: FilterVal }) {
  if (!smart) return null;
  if (smart.count.overdue > 0 && activeView !== "overdue") {
    return (
      <button onClick={() => onView("overdue")} className="w-full mb-4 flex items-center gap-3 rounded-xl bg-danger/10 text-danger px-4 py-3 text-sm font-medium hover:bg-danger/15 transition-colors">
        <AlertTriangle className="w-4 h-4" />{smart.count.overdue} tarea{smart.count.overdue > 1 ? "s" : ""} atrasada{smart.count.overdue > 1 ? "s" : ""} · revisa
      </button>
    );
  }
  if (smart.count.unscheduled > 0 && activeView === "all") {
    return (
      <button onClick={() => onView("unscheduled")} className="w-full mb-4 flex items-center gap-3 rounded-xl bg-surface border border-border px-4 py-3 text-sm text-muted hover:text-text transition-colors">
        <CalendarX2 className="w-4 h-4" />{smart.count.unscheduled} tarea{smart.count.unscheduled > 1 ? "s" : ""} sin fecha · adelántalas
      </button>
    );
  }
  return null;
}