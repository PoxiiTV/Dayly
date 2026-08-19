import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ListTodo, Filter, AlertTriangle, CalendarX2 } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { Spinner, EmptyState, Button, Segmented, useToast } from "@/components/ui";
import { TaskItem, TaskEditor } from "@/components/tasks";
import type { Task, Project, Tag, Priority, TaskStatus } from "@/lib/types";
import { relativeDay } from "@/lib/dates";

type FilterVal = "all" | "today" | "upcoming" | "overdue" | "high" | "unscheduled";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const due = view === "today" ? "today" : view === "upcoming" ? "upcoming" : view === "overdue" ? "overdue" : view === "unscheduled" ? "nominal" : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "list", view, filter, projectFilter, priorityFilter, q],
    queryFn: () => http.get<{ tasks: Task[] }>("/api/tasks", { view, due, projectId: projectFilter || undefined, priority: priorityFilter || undefined, q: q || undefined, includeCompleted: filter === "completed" ? "true" : undefined }),
  });
  useQuery({ queryKey: ["projects"], queryFn: () => http.get<{ projects: Project[] }>("/api/projects").then((d) => { setProjects(d.projects); return d; }) });
  useQuery({ queryKey: ["tags"], queryFn: () => http.get<{ tags: Tag[] }>("/api/tags").then((d) => { setTags(d.tags); return d; }) });

  const { data: smart } = useQuery({ queryKey: ["tasks", "smart"], queryFn: () => http.get<{ count: { overdue: number; today: number; unscheduled: number } }>("/api/tasks/smart") });

  const tasks = data?.tasks ?? [];

  const filtered = tasks.filter((t) => {
    if (filter === "all") return t.status !== "COMPLETED" || true;
    if (filter === "completed") return t.status === "COMPLETED";
    return t.status === filter;
  });

  const clearFilters = () => { setView("all"); setFilter("all"); setProjectFilter(""); setPriorityFilter(""); setQ(""); };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-text tracking-tight">Tareas</h1>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nueva tarea</Button>
      </div>

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
        filtered.length === 0 ? (
          <EmptyState
            icon={view === "high" || filter === "completed" ? <AlertTriangle className="w-6 h-6" /> : <ListTodo className="w-6 h-6" />}
            title={
              view === "overdue" ? "Nada atrasado"
                : view === "high" || filter === "completed" || !!projectFilter || !!priorityFilter || !!q
                  ? "Sin resultados"
                  : "No hay tareas aquí"
            }
            hint={
              view === "high" || filter === "completed" || !!projectFilter || !!priorityFilter || !!q
                ? "Prueba con otros filtros."
                : "Perfecto. Todo está bajo control."
            }
            action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear tarea</Button>}
          />
        ) : (
          <div className="card divide-y divide-border/60">
            {filtered.map((t) => <div key={t.id} className="px-2"><TaskItem task={t} onOpen={setEditing} /></div>)}
          </div>
        )
      }

      <TaskEditor open={createOpen} onClose={() => setCreateOpen(false)} projects={projects} tags={tags} />
      <TaskEditor open={!!editing} onClose={() => setEditing(null)} task={editing} projects={projects} tags={tags} />
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