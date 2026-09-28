import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ListTodo, Filter, AlertTriangle, ArrowDownWideNarrow, CalendarX2, Search, Sparkles, Tags } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SortableBoard } from "@/components/SortableBoard";
import { applyManualOrder, mergeVisibleOrder, swapPositions } from "@/lib/boardOrder";
import { AiRescheduleModal } from "@/components/AiAssist";
import { useAiEnabled } from "@/lib/ai";
import { useSearchParams } from "react-router-dom";
import { http } from "@/lib/api";
import { Spinner, EmptyState, Button, Input, Select, SelectControl, Segmented, PageHeader, useToast } from "@/components/ui";
import { LayoutGrid, Rows3 } from "lucide-react";
import { TaskItem, TaskEditor } from "@/components/tasks";
import { TagManager } from "@/components/TagManager";
import type { Priority, Task, Project, Tag, TaskStatus } from "@/lib/types";
import { localKey, spansLocalDay, taskDeadlineMs } from "@/lib/dates";

type FilterVal = "all" | "today" | "upcoming" | "overdue" | "high" | "unscheduled";
type Layout = "list" | "cards";
const LAYOUT_KEY = "dayly.tasks.layout";

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
}

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
  if (!a.dueDate && !b.dueDate) {
    return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt);
  }
  const aDay = a.dueDate ? localKey(new Date(a.dueDate)) : "9999-99-99";
  const bDay = b.dueDate ? localKey(new Date(b.dueDate)) : "9999-99-99";
  const byDay = aDay.localeCompare(bDay);
  if (byDay) return byDay;

  if (!a.hasTime && !b.hasTime) {
    return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt);
  }
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority) return byPriority;

  const byRemaining = taskDeadlineMs(a) - taskDeadlineMs(b);
  if (byRemaining) return byRemaining;

  return a.createdAt.localeCompare(b.createdAt);
}

export function Tasks() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<FilterVal>(() => {
    const value = searchParams.get("due") as FilterVal | null;
    return value && (["overdue", "today", "upcoming", "high", "unscheduled"] as FilterVal[]).includes(value) ? value : "all";
  });
  const [filter, setFilter] = useState<"all" | TaskStatus | "completed">(() => {
    const value = searchParams.get("status");
    return value === "COMPLETED" ? "completed" : (["PENDING", "IN_PROGRESS", "POSTPONED", "CANCELLED"] as TaskStatus[]).includes(value as TaskStatus) ? value as TaskStatus : "all";
  });
  const [projectFilter, setProjectFilter] = useState(() => searchParams.get("projectId") ?? "");
  const [priorityFilter, setPriorityFilter] = useState(() => searchParams.get("priority") ?? "");
  const [tagFilter, setTagFilter] = useState(() => searchParams.get("tagId") ?? "");
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [completedToday, setCompletedToday] = useState(() => searchParams.get("completed") === "today");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);

  /**
   * `?t=<id>` opens that task straight away: it is where the "Editar" of a
   * quick add and the link of a notification point, so neither leaves you
   * hunting for the row. The parameter is consumed once, so a refresh does not
   * reopen what you already closed.
   */
  const openedFor = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "list", filter, projectFilter, priorityFilter, tagFilter, q, completedToday],
    queryFn: () => http.get<{ tasks: Task[] }>("/api/tasks", {
      status: filter === "completed" ? "COMPLETED" : filter !== "all" ? filter : undefined,
      projectId: projectFilter || undefined,
      priority: priorityFilter || undefined,
      tagId: tagFilter || undefined,
      q: q || undefined,
      completed: completedToday ? "today" : undefined,
      includeCompleted: "true",
    }),
  });
  const tasks = data?.tasks ?? [];

  useEffect(() => {
    const wanted = searchParams.get("t");
    if (!wanted || openedFor.current === wanted) return;
    const found = tasks.find((t) => t.id === wanted);
    if (!found) return; // still loading, or filtered out of this view
    openedFor.current = wanted;
    setCreateOpen(false);
    setEditing(found);
    const next = new URLSearchParams(searchParams);
    next.delete("t");
    setSearchParams(next, { replace: true });
  }, [searchParams, tasks, setSearchParams]);

  const { data: projectsData } = useQuery({ queryKey: ["projects"], queryFn: () => http.get<{ projects: Project[] }>("/api/projects") });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => http.get<{ tags: Tag[] }>("/api/tags") });
  const projects = projectsData?.projects ?? [];
  const tags = tagsData?.tags ?? [];

  const { data: smart } = useQuery({ queryKey: ["tasks", "smart"], queryFn: () => http.get<{ count: { overdue: number; today: number; unscheduled: number } }>("/api/tasks/smart") });

  const todayKey = localKey(new Date());

  const openTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (t.status === "COMPLETED") return false;
      if (filter === "completed") return false;
      if (filter !== "all" && t.status !== filter) return false;
      if (view === "today") return !!t.dueDate && spansLocalDay(t.dueDate, t.dueEndDate, todayKey);
      if (view === "upcoming") return !!t.dueDate && taskDeadlineMs(t) > Date.now();
      if (view === "overdue") return !!t.dueDate && taskDeadlineMs(t) < Date.now();
      if (view === "unscheduled") return !t.dueDate;
      if (view === "high") return t.priority === "HIGH" || t.priority === "URGENT";
      return true;
    }).sort(compareOpenTasks);
    return applyManualOrder(filtered);
  }, [tasks, filter, view, todayKey]);

  /** Every open task in board order: a reorder in a filtered view is written back into it. */
  const boardIds = useMemo(
    () => applyManualOrder(tasks.filter((t) => t.status !== "COMPLETED").sort(compareOpenTasks)).map((t) => t.id),
    [tasks],
  );
  const hasManualOrder = tasks.some((t) => t.boardOrder != null);

  // Project, tag, priority, status and search filters are applied by the server: then only part of the board is loaded.
  const partialBoard = Boolean(projectFilter || priorityFilter || tagFilter || q || filter !== "all");

  const saveBoardOrder = async (visibleIds: string[]) => {
    const swapped = partialBoard ? swapPositions(visibleIds, new Map(tasks.map((t) => [t.id, t.boardOrder]))) : null;
    const ids = swapped ? visibleIds : mergeVisibleOrder(boardIds, visibleIds);
    const positions = swapped ?? ids.map((_, index) => index);
    const position = new Map(ids.map((id, index) => [id, positions[index]!]));
    // Show the new order at once; the server confirms in the background.
    qc.setQueriesData<{ tasks: Task[] }>({ queryKey: ["tasks", "list"] }, (old) => old && {
      ...old,
      tasks: old.tasks.map((t) => (position.has(t.id) ? { ...t, boardOrder: position.get(t.id)! } : t)),
    });
    try {
      await http.put("/api/tasks/board-order", { ids, positions });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar el orden.");
    } finally {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  };

  const resetBoardOrder = async () => {
    try {
      await http.del("/api/tasks/board-order");
      push("success", "Orden automático restablecido");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo restablecer el orden.");
    } finally {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  };

  const doneTasks = useMemo(() => {
    if (filter !== "all" && filter !== "completed") return [];
    return [...tasks.filter((t) => t.status === "COMPLETED")]
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.createdAt.localeCompare(b.createdAt));
  }, [tasks, filter]);

  const [layout, setLayout] = useState<Layout>(readLayout);
  const pickLayout = (next: Layout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* private mode */ }
  };

  const clearFilters = () => { setView("all"); setFilter("all"); setProjectFilter(""); setPriorityFilter(""); setTagFilter(""); setQ(""); setCompletedToday(false); };

  return (
    <div className="page-shell">
      <PageHeader
        title="Tareas"
        // Nothing left for it to hold on a phone: the title was already hidden
        // and both buttons live elsewhere now.
        className="hidden md:flex"
        actions={(
          <div className="hidden flex-wrap justify-end gap-2 md:flex">
            <Button variant="secondary" onClick={() => setTagsOpen(true)}><Tags aria-hidden="true" className="w-4 h-4" />Etiquetas</Button>
            <Button onClick={() => { setEditing(null); setEditorNonce((n) => n + 1); setCreateOpen(true); }}><Plus aria-hidden="true" className="w-4 h-4" />Nueva tarea</Button>
          </div>
        )}
      />

      <Display smart={smart} onView={setView} activeView={view} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Two equal 1fr tracks in an auto-sized grid: the search takes exactly the width of the view tabs. */}
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 md:inline-grid md:w-auto md:grid-cols-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-accent" aria-hidden />
            <Input
              className="h-[2.625rem] border-accent/50 pl-10 font-medium shadow-soft placeholder:text-muted"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar tareas…"
              aria-label="Buscar tareas"
            />
          </div>
          <Segmented options={[{ value: "all", label: "Todas" }, { value: "today", label: "Hoy" }, { value: "upcoming", label: "Próximas" }, { value: "overdue", label: "Atrasadas" }, { value: "high", label: "Importantes" }, { value: "unscheduled", label: "Sin fecha" }]} value={view} onChange={setView} />
        </div>
        <div className="w-full sm:w-56 shrink-0">
          <SelectControl
            dense
            aria-label="Proyecto"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">Todos los proyectos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectControl>
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setShowFilters(!showFilters)}><Filter className="w-4 h-4" />Filtros</Button>
        <Button variant="secondary" size="sm" className="md:hidden" onClick={() => setTagsOpen(true)}><Tags className="w-4 h-4" aria-hidden="true" />Etiquetas</Button>
        <div className="flex items-center gap-0.5 rounded-xl border border-border p-0.5" role="group" aria-label="Forma de ver las tareas">
          <Button
            variant={layout === "list" ? "secondary" : "ghost"}
            size="sm"
            icon
            onClick={() => pickLayout("list")}
            aria-pressed={layout === "list"}
            title="Ver en lista"
            aria-label="Ver en lista"
          >
            <Rows3 className="w-4 h-4" />
          </Button>
          <Button
            variant={layout === "cards" ? "secondary" : "ghost"}
            size="sm"
            icon
            onClick={() => pickLayout("cards")}
            aria-pressed={layout === "cards"}
            title="Ver en tarjetas"
            aria-label="Ver en tarjetas"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-fade-in">
          <Select label="Estado" value={filter} onChange={(e) => setFilter(e.target.value as "all" | TaskStatus | "completed")}>
            <option value="all">Todos los estados</option><option value="PENDING">Pendiente</option><option value="IN_PROGRESS">En progreso</option><option value="POSTPONED">Pospuesta</option><option value="completed">Completada</option><option value="CANCELLED">Cancelada</option>
          </Select>
          <Select label="Prioridad" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="">Todas las prioridades</option><option value="URGENT">Urgente</option><option value="HIGH">Alta</option><option value="NORMAL">Normal</option><option value="LOW">Baja</option>
          </Select>
          <Select label="Etiqueta" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">Todas las etiquetas</option>{tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
          </Select>
          <div className="flex items-end">
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
          </div>
        </div>
      )}

      {isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> :
        filter !== "completed" && openTasks.length === 0 && doneTasks.length === 0 ? (
          <EmptyState
            icon={view === "high" ? <AlertTriangle className="w-6 h-6" /> : <ListTodo className="w-6 h-6" />}
            title={
              view === "overdue" ? "Nada atrasado"
                : view === "high" || !!projectFilter || !!priorityFilter || !!tagFilter || !!q || filter !== "all"
                  ? "Sin resultados"
                  : "No hay tareas aquí"
            }
            hint={
              view === "high" || !!projectFilter || !!priorityFilter || !!tagFilter || !!q || filter !== "all"
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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="section-title">Pendientes ({openTasks.length})</h2>
                  {layout === "cards" && openTasks.length > 1 && (
                    hasManualOrder ? (
                      <Button variant="ghost" size="sm" onClick={() => void resetBoardOrder()} title="Volver a ordenar por prioridad y fecha">
                        <ArrowDownWideNarrow className="w-4 h-4" />Orden automático
                      </Button>
                    ) : (
                      <span className="hidden text-xs text-faint sm:inline">Arrastra las tarjetas para ordenarlas a tu manera</span>
                    )
                  )}
                </div>
                {openTasks.length === 0 ? (
                  <div className="card px-1 overflow-visible">
                    <p className="px-4 py-6 text-sm text-muted text-center">Ninguna tarea pendiente</p>
                  </div>
                ) : layout === "cards" ? (
                  <SortableBoard
                    className="task-board"
                    items={openTasks}
                    onReorder={(ids) => void saveBoardOrder(ids)}
                    render={(t) => <TaskItem task={t} variant="card" onOpen={(task) => { setCreateOpen(false); setEditing(task); }} />}
                  />
                ) : (
                  <div className="card divide-y divide-border/60 px-1 overflow-visible">
                    {openTasks.map((t) => (
                      <div key={t.id} className="px-2"><TaskItem task={t} onOpen={(task) => { setCreateOpen(false); setEditing(task); }} /></div>
                    ))}
                  </div>
                )}
              </section>
            )}
            {doneTasks.length > 0 && (
              <section>
                <h2 className="section-title mb-3">Completadas ({doneTasks.length})</h2>
                {layout === "cards" ? (
                  <div className="task-board opacity-70">
                    {doneTasks.map((t) => (
                      <TaskItem key={t.id} task={t} variant="card" onOpen={(task) => { setCreateOpen(false); setEditing(task); }} />
                    ))}
                  </div>
                ) : (
                  <div className="card divide-y divide-border/60 px-1 overflow-visible opacity-70">
                    {doneTasks.map((t) => (
                      <div key={t.id} className="px-2"><TaskItem task={t} onOpen={(task) => { setCreateOpen(false); setEditing(task); }} /></div>
                    ))}
                  </div>
                )}
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
      <TagManager
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        onDeleted={(id) => { if (tagFilter === id) setTagFilter(""); }}
      />
    </div>
  );
}

function Display({ smart, onView, activeView }: { smart: { count: { overdue: number; today: number; unscheduled: number } } | undefined; onView: (v: FilterVal) => void; activeView: FilterVal }) {
  const aiEnabled = useAiEnabled();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  if (!smart) return null;
  if (smart.count.overdue > 0 && (activeView !== "overdue" || aiEnabled)) {
    return (
      <div className="mb-4 flex items-stretch gap-2">
      {activeView !== "overdue" && (
      // Opaque surface with a solid red edge: a translucent tint vanished over photo wallpapers.
      <button onClick={() => onView("overdue")} className="flex-1 flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger shadow-soft transition-colors hover:border-danger">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-danger text-white" aria-hidden="true"><AlertTriangle className="h-4 w-4" /></span>{smart.count.overdue} tarea{smart.count.overdue > 1 ? "s" : ""} atrasada{smart.count.overdue > 1 ? "s" : ""} · revisa
      </button>
      )}
      {aiEnabled && (
        <button
          type="button"
          onClick={() => setRescheduleOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-danger/60 bg-surface px-4 py-3 text-sm font-semibold text-danger shadow-soft transition-colors hover:border-danger"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />Reprogramar con IA
        </button>
      )}
      <AiRescheduleModal open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} />
      </div>
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
