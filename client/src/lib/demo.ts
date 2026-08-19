/**
 * DAYLY DEMO MODE — frontend-only mock of the API.
 *
 * When VITE_APP_DEMO=1 the client never touches the real backend: every
 * request is answered by this in-memory store. The store lives ONLY in the
 * JS module, so EVERY PAGE RELOAD re-seeds it and wipes any changes — i.e.
 * "no data is real and reloading restores the demo data". Great for a public
 * GitHub Pages showcase.
 */
import type { Task, EventItem, Note, Project, Habit, Goal, Reminder, NotificationItem, InboxItem, Tag, Priority, TaskStatus } from "./types";

/* ------------------------------------------------------------------ */
/* Seeded demo data (local calendar dates => deterministic across days) */
/* ------------------------------------------------------------------ */
function today(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d: Date, n: number) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function at(d: Date, h: number, m = 0) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); }
function iso(d: Date) { return d.toISOString(); }
function keyOf(d: Date) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

const T0 = today();
let seq = 0;
const nid = (p: string) => `${p}${++seq}${Math.floor(Math.random() * 1e6).toString(36)}`;
const uid = () => "u-demo";

const tagSeed = [
  { id: nid("tag"), name: "Trabajo", color: "#6366f1" },
  { id: nid("tag"), name: "Personal", color: "#10b981" },
  { id: nid("tag"), name: "DJ", color: "#ec4899" },
  { id: nid("tag"), name: "Estudio", color: "#f59e0b" },
];
const projectSeed = [{ id: nid("prj"), name: "Web djhummer.es", description: "Renovar la web del DJ", color: "#6366f1", status: "ACTIVE", startDate: iso(T0), dueDate: iso(addDays(T0, 30)) }];

const taskSeed: Task[] = [
  { id: nid("tsk"), title: "Preparar set para el fin de semana", description: "Seleccionar tracklist de latin tech house", dueDate: iso(T0), hasTime: true, priority: "HIGH", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), projectId: projectSeed[0].id, color: "#6366f1", subtasks: [], tags: [tagSeed[1]], goals: [] },
  { id: nid("tsk"), title: "Responder emails de booking", dueDate: iso(T0), hasTime: true, priority: "URGENT", status: "IN_PROGRESS", timeSpentMinutes: 15, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[0]], goals: [] },
  { id: nid("tsk"), title: "Comprar cables de audio", priority: "LOW", status: "PENDING", dueDate: iso(addDays(T0, 1)), hasTime: false, timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[1]], goals: [] },
  { id: nid("tsk"), title: "Estudiar técnicas de mezcla", dueDate: iso(T0), hasTime: true, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[3]], goals: [] },
  { id: nid("tsk"), title: "Diseñar página de contacto", description: "Sección con formulario y redes", dueDate: iso(addDays(T0, 2)), hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), projectId: projectSeed[0].id, color: "#6366f1", subtasks: [
      { id: nid("sub"), title: "Crear estructura", done: true, sortOrder: 0 },
      { id: nid("sub"), title: "Diseñar interfaz", done: false, sortOrder: 1 },
      { id: nid("sub"), title: "Programar backend", done: false, sortOrder: 2 },
    ], tags: [tagSeed[0]], goals: [] },
  { id: nid("tsk"), title: "Llamar a la sala para confirmar fecha", dueDate: undefined as unknown as string, hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[2]], goals: [] },
];

const eventSeed: EventItem[] = [
  { id: nid("evt"), title: "Reunión de booking", startAt: iso(at(T0, 9, 0)), endAt: iso(at(T0, 9, 45)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#ef4444", category: "Reunión", location: "Videollamada", tags: [], },
  { id: nid("evt"), title: "Diseñar página de contacto", startAt: iso(at(T0, 10, 30)), endAt: iso(at(T0, 12, 0)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#6366f1", projectId: projectSeed[0].id, tags: [] },
  { id: nid("evt"), title: "Almuerzo", startAt: iso(at(T0, 12, 0)), endAt: iso(at(T0, 12, 45)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#f59e0b", tags: [] },
  { id: nid("evt"), title: "Ensayo técnica de mezcla", startAt: iso(at(T0, 15, 0)), endAt: iso(at(T0, 16, 30)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#10b981", tags: [] },
  { id: nid("evt"), title: "Reunión semanal", startAt: iso(at(addDays(T0, 1), 9, 0)), endAt: iso(at(addDays(T0, 1), 9, 30)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#ef4444", tags: [], recurrence: { frequency: "WEEKLY" } },
];

const noteSeed: Note[] = [
  { id: nid("nte"), title: "Ideas para el nuevo EP", content: "# Ideas\n\n- **Sabor a Playa** remix\n- Colaboración con vocalista\n- Publicar en verano", pinned: true, archived: false, favorite: true, color: "#ec4899", createdAt: iso(T0), updatedAt: iso(T0), tags: [tagSeed[2]] },
  { id: nid("nte"), title: "Lista de la compra", content: "- Cables RCA\n- Monitor pequeño\n- Auriculares nuevos", pinned: false, archived: false, favorite: false, createdAt: iso(T0), updatedAt: iso(T0), tags: [tagSeed[1]] },
];

const habitSeed: Habit[] = [
  { id: nid("hbt"), name: "Beber agua", color: "#3b82f6", scheduleDayBits: 127 },
  { id: nid("hbt"), name: "Leer 20 min", color: "#10b981", scheduleDayBits: 127 },
  { id: nid("hbt"), name: "Entrenar", color: "#f59e0b", scheduleDayBits: 62 },
  { id: nid("hbt"), name: "Estudiar música", color: "#ec4899", scheduleDayBits: 127 },
];
// habit logs for the last 6 days (some gaps to show streaks)
const habitLogSeed: Record<string, string[]> = {};

const goalSeed: Goal[] = [
  { id: nid("goal"), title: "Lanzar mi nueva web", description: "Web profesional lista para producción", dueDate: iso(addDays(T0, 30)), manualProgress: -1, status: "PENDING", projectId: projectSeed[0].id, tasks: [{ id: taskSeed[4].id, title: taskSeed[4].title, status: taskSeed[4].status }] },
  { id: nid("goal"), title: "Publicar EP en verano", description: "Terminar el tracklist y masterizar", dueDate: iso(addDays(T0, 60)), manualProgress: 40, status: "PENDING", tasks: [] },
];

const inboxSeed: InboxItem[] = [
  { id: nid("inb"), content: "Revisar factura del hosting", archived: false, createdAt: iso(T0) },
  { id: nid("inb"), content: "Comprar regalo de cumpleaños", archived: false, createdAt: iso(T0) },
];

const reminderSeed: Reminder[] = [
  { id: nid("rem"), title: "Llamar a la sala", remindAt: iso(at(T0, 17, 30)), scheduleDaily: false, targetType: "NONE" },
  { id: nid("rem"), title: "Estirar y descansar la vista", remindAt: iso(at(T0, 11, 0)), scheduleDaily: true, targetType: "NONE" },
];

const notificationSeed: NotificationItem[] = [
  { id: nid("not"), type: "TASK", title: "Tienes 2 tareas para hoy", body: "Preparar set y responder emails", read: false, createdAt: iso(T0) },
  { id: nid("not"), type: "EVENT", title: "Reunión de booking a las 9:00", body: "Videollamada · 45 min", read: true, createdAt: iso(T0) },
  { id: nid("not"), type: "REMINDER", title: "Recuerda estirar la vista a las 11:00", read: false, createdAt: iso(T0) },
];

/* ------------------------------------------------------------------ */
/* In-memory store — reset on every reload (module re-eval)            */
/* ------------------------------------------------------------------ */
interface DemoState {
  tasks: Task[]; events: EventItem[]; notes: Note[]; projects: Project[]; tags: Tag[];
  habits: Habit[]; habitLogs: Record<string, string[]>; goals: Goal[]; inbox: InboxItem[];
  reminders: Reminder[]; notifications: NotificationItem[]; timeRunning: string | null; timeStart: number | null;
}
const S: DemoState = {
  tasks: JSON.parse(JSON.stringify(taskSeed)),
  events: JSON.parse(JSON.stringify(eventSeed)),
  notes: JSON.parse(JSON.stringify(noteSeed)),
  projects: JSON.parse(JSON.stringify(projectSeed)),
  tags: JSON.parse(JSON.stringify(tagSeed)),
  habits: JSON.parse(JSON.stringify(habitSeed)),
  habitLogs: habitLogSeed,
  goals: JSON.parse(JSON.stringify(goalSeed)),
  inbox: JSON.parse(JSON.stringify(inboxSeed)),
  reminders: JSON.parse(JSON.stringify(reminderSeed)),
  notifications: JSON.parse(JSON.stringify(notificationSeed)),
  timeRunning: null, timeStart: null,
};

const demoUser = {
  id: "u-demo", email: "demo@dayly.app", name: "Alexis Demo", roleId: "user", roleName: "USER",
  emailVerifiedAt: iso(T0), twoFactorEnabled: false, timezone: "Europe/Madrid", language: "es",
  firstDayOfWeek: 1, timeFormat24: true, theme: "SYSTEM", density: "comfortable",
  calendarStartHour: 8, calendarEndHour: 20, avatarUrl: null, mustChangePassword: false,
};

function projectById(id?: string | null) { return S.projects.find((p) => p.id === id); }

/* ------------------------------------------------------------------ */
/* Helpers to compute expected response shapes                         */
/* ------------------------------------------------------------------ */
function decorateTask(t: Task): Task {
  return {
    ...t,
    project: t.projectId ? { id: t.projectId, name: projectById(t.projectId)?.name ?? "—", color: projectById(t.projectId)?.color ?? null } : undefined,
    tags: t.tags ?? [],
    subtasks: t.subtasks ?? [],
  };
}
function dashboard() {
  const start = T0; const end = addDays(start, 1);
  const now = new Date();
  const pending = S.tasks.filter((t) => t.status !== "COMPLETED").length;
  const completed = S.tasks.filter((t) => t.status === "COMPLETED" && t.completedAt).length;
  const overdue = S.tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < now).length;
  const events = S.events.filter((e) => new Date(e.startAt) >= start && new Date(e.startAt) < end);
  const todaysTasks = S.tasks.filter((t) => t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end && t.status !== "COMPLETED");
  return { pending, completed, overdue, activeProjects: 1, activeGoals: S.goals.filter((g) => g.status !== "COMPLETED").length, events, todaysTasks, habitCompletionsToday: 6, timeTodaySeconds: 54 * 60 + 12, startOfDay: iso(start) };
}
function myDay(dateKey?: string) {
  const base = dateKey ? new Date(dateKey + "T12:00:00") : T0;
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = addDays(start, 1);
  const now = new Date();
  type Item = { id: string; title: string; kind: "event" | "task"; at: string; end?: string; color?: string | null };
  const events = S.events.filter((e) => new Date(e.startAt) >= start && new Date(e.startAt) < end);
  const tasks = S.tasks.filter((t) => t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end && t.status !== "CANCELLED");
  const eItems: Item[] = events.map((e) => ({ id: e.id, title: e.title, kind: "event", at: e.startAt, end: e.endAt, color: e.color }));
  const tItems: Item[] = tasks.map((t) => ({ id: t.id, title: t.title, kind: "task", at: t.dueDate!, color: t.color }));
  const all = [...eItems, ...tItems];
  const nowItems = all.filter((i) => now >= new Date(i.at) && (!i.end || now <= new Date(i.end)));
  const next = all.filter((i) => now < new Date(i.at)).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 8);
  const done = tasks.filter((t) => t.status === "COMPLETED");
  const ovd = tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < now);
  const total = tasks.length; const progress = total ? Math.round((done.length / total) * 100) : 0;
  return { date: iso(start), now: nowItems, next, done, overdue: ovd, progress, counts: { total, done: done.length, overdue: ovd.length } };
}
function stats() {
  const mk = (completed: number, timeSeconds: number, habit: number) => ({ completed, created: 14, completionRate: Math.round((completed / 16) * 100), completedProjects: 1, timeSeconds, habitCompletions: habit, overdue: 1 });
  return { today: mk(4, 54 * 60, 3), week: mk(18, 6 * 3600 + 42 * 60, 21), month: mk(62, 26 * 3600, 84), pendingByPriority: [{ priority: "URGENT", _count: { _all: 1 } }, { priority: "HIGH", _count: { _all: 2 } }, { priority: "NORMAL", _count: { _all: 3 } }, { priority: "LOW", _count: { _all: 1 } }] };
}
function search(q: string) {
  const lq = q.toLowerCase();
  const f = (s: string) => s.toLowerCase().includes(lq);
  return {
    tasks: S.tasks.filter((t) => f(t.title)).slice(0, 8).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, color: t.color })),
    events: S.events.filter((e) => f(e.title)).slice(0, 8).map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, color: e.color })),
    notes: S.notes.filter((n) => f(n.title)).slice(0, 8).map((n) => ({ id: n.id, title: n.title, pinned: n.pinned })),
    projects: S.projects.filter((p) => f(p.name)).slice(0, 8).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    goals: S.goals.filter((g) => f(g.title)).slice(0, 8).map((g) => ({ id: g.id, title: g.title })),
    habits: S.habits.filter((h) => f(h.name)).slice(0, 8).map((h) => ({ id: h.id, name: h.name, color: h.color })),
  };
}
function habitsList() {
  const todayK = keyOf(T0);
  return S.habits.map((h) => {
    const logs = S.habitLogs[h.id] ?? [];
    let current = 0; let cursor = todayK; let c = new Date();
    const has = (k: string) => logs.includes(k);
    if (!has(todayK)) { cursor = keyOf(addDays(c, -1)); }
    while (has(cursor)) { current++; c = addDays(c, -1); cursor = keyOf(c); }
    const doneKeys = logs;
    return { ...h, current, longest: cacheLongest(h.id), logs: doneKeys.map((k) => ({ date: k + "T12:00:00.000Z", done: true })) };
  });
}
const longestCache: Record<string, number> = {};
function cacheLongest(id: string) { return longestCache[id] ?? 6; }

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */
export async function demoHandle(method: string, urlPath: string, body: unknown, query: Record<string, string>): Promise<unknown> {
  const p = urlPath.replace(/^\/api/, "");
  const send = (code: number, data: unknown) => { if (code >= 400) { const e = new Error("demo error"); (e as any).status = code; throw e; } return data; };
  const ok = (d: unknown) => send(200, d);

  // ---------- Auth ----------
  if (method === "GET" && p === "/auth/me") return ok({ user: demoUser, sessionId: "demo" });
  if (method === "POST" && p === "/auth/login") return ok({ token: "demo", user: demoUser });
  if (method === "POST" && p === "/auth/register") return ok({ token: "demo", user: demoUser });
  if (method === "POST" && p === "/auth/logout") return ok({ ok: true });
  if (method === "POST" && p === "/auth/forgot-password") return ok({ ok: true });
  if (method === "POST" && p === "/auth/reset-password") return ok({ ok: true });

  // ---------- User / prefs ----------
  if (method === "PATCH" && p === "/users/me/preferences" || method === "PATCH" && p === "/users/me") return ok({ user: demoUser });
  if (method === "GET" && p === "/users/me") return ok({ user: demoUser });

  // ---------- Dashboard / calendar ----------
  if (method === "GET" && p === "/calendar/dashboard") return ok(dashboard());
  if (method === "GET" && p === "/calendar/my-day") return ok(myDay(query.date));
  if (method === "GET" && p === "/calendar") {
    const ev = S.events.filter((e) => !query.from || new Date(e.endAt) >= new Date(query.from)).filter((e) => !query.to || new Date(e.startAt) <= new Date(query.to));
    const tk = S.tasks.filter((t) => t.dueDate && !query.from || (t.dueDate && new Date(t.dueDate) >= new Date(query.from))).filter((t) => !query.to || (t.dueDate && new Date(t.dueDate) <= new Date(query.to)) && t.status !== "COMPLETED");
    return ok({ events: ev, tasks: tk });
  }

  // ---------- Tasks ----------
  if (method === "GET" && p === "/tasks") {
    let list = [...S.tasks];
    if (query.due === "today" || query.view === "today") list = list.filter((t) => t.dueDate && keyOf(new Date(t.dueDate)) === keyOf(T0));
    if (query.due === "overdue" || query.view === "overdue") list = list.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < new Date());
    if (query.due === "upcoming" || query.view === "upcoming") list = list.filter((t) => t.dueDate && new Date(t.dueDate) > new Date());
    if (query.due === "nominal" || query.view === "unscheduled") list = list.filter((t) => !t.dueDate);
    if (query.priority) list = list.filter((t) => t.priority === query.priority);
    if (query.projectId) list = list.filter((t) => t.projectId === query.projectId);
    if (query.q) list = list.filter((t) => t.title.toLowerCase().includes((query.q as string).toLowerCase()));
    if (query.includeCompleted !== "true") { /* keep incl */ }
    return ok({ tasks: list.map(decorateTask) });
  }
  if (method === "GET" && p === "/tasks/smart") {
    const now = new Date();
    const start = T0; const end = addDays(T0, 1);
    const base = (t: Task) => t.status !== "COMPLETED";
    const overdue = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) < now).length;
    const todayL = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end);
    const upcoming = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) >= end).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()).slice(0, 12);
    const important = S.tasks.filter((t) => base(t) && (t.priority === "HIGH" || t.priority === "URGENT"));
    const unscheduled = S.tasks.filter((t) => base(t) && !t.dueDate).length;
    return ok({ count: { overdue, today: todayL.length, unscheduled }, today: todayL.map(decorateTask), upcoming: upcoming.map(decorateTask), important: important.map(decorateTask) });
  }
  let m: RegExpMatchArray | null;
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/complete$/))) { const t = own(S.tasks, m![1]); t.status = "COMPLETED"; t.completedAt = iso(new Date()); return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/postpone$/))) { const t = own(S.tasks, m![1]); t.dueDate = iso(addDays(t.dueDate ? new Date(t.dueDate) : T0, (body as any)?.days ?? 1)); t.status = t.status === "COMPLETED" ? "PENDING" : "POSTPONED"; return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/subtasks$/))) { const t = own(S.tasks, m![1]); const sub = { id: nid("sub"), title: (body as { title: string }).title, done: false, sortOrder: (t.subtasks?.length ?? 0) }; t.subtasks = [...(t.subtasks ?? []), sub]; return ok({ subtask: sub }); }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/subtasks\/(.+)$/))) { for (const t of S.tasks) { const sub = (t.subtasks ?? []).find((s) => s.id === m![1]); if (sub) { sub.done = (body as any).done ?? sub.done; return ok({ subtask: sub }); } } return ok({ ok: true }); }
  if (method === "GET" && (m = p.match(/^\/tasks\/(.+)$/))) return ok({ task: decorateTask(own(S.tasks, m![1])) });
  if (method === "POST" && p === "/tasks") { const b = body as any; const t: Task = { id: nid("tsk"), title: b.title, description: b.description ?? null, dueDate: b.dueDate ?? null, hasTime: b.hasTime ?? !!b.dueDate, priority: b.priority ?? "NORMAL", status: b.status ?? "PENDING", timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), projectId: b.projectId ?? null, color: b.color ?? null, subtasks: (b.subtasks ?? []).map((s: any, i: number) => ({ id: nid("sub"), title: s.title, done: false, sortOrder: i })), tags: [], goals: [] }; S.tasks.push(t); return ok({ task: decorateTask(t) }); }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/(.+)\/move$/))) { const t = own(S.tasks, m![1]); t.dueDate = (body as any).dueDate ?? t.dueDate; return ok({ task: decorateTask(t) }); }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/(.+)$/))) { const t = own(S.tasks, m![1]); const b = body as any; Object.assign(t, { title: b.title ?? t.title, description: b.description ?? t.description, priority: b.priority ?? t.priority, status: b.status ?? t.status, projectId: b.projectId ?? t.projectId, dueDate: b.dueDate ?? t.dueDate }); if (b.status === "COMPLETED") t.completedAt = iso(new Date()); return ok({ task: decorateTask(t) }); }
  if (method === "DELETE" && (m = p.match(/^\/tasks\/(.+)\/permanent$/))) { S.tasks = S.tasks.filter((t) => t.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/tasks\/(.+)$/))) { const t = own(S.tasks, m![1]); t.deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Events ----------
  if (method === "POST" && p === "/events") { const b = body as any; const e: EventItem = { id: nid("evt"), title: b.title, description: b.description ?? null, startAt: b.startAt, endAt: b.endAt, allDay: b.allDay ?? false, priority: b.priority ?? "NORMAL", status: "PENDING", color: b.color ?? "#1d4ed8", category: b.category ?? null, location: b.location ?? null, tags: [] }; S.events.push(e); return ok({ event: e }); }
  if (method === "PATCH" && (m = p.match(/^\/events\/(.+)\/move$/))) { const e = own(S.events, m![1]); e.startAt = (body as any).startAt ?? e.startAt; e.endAt = (body as any).endAt ?? e.endAt; return ok({ event: e }); }
  if (method === "POST" && (m = p.match(/^\/events\/(.+)\/to-task$/))) { const e = own(S.events, m![1]); const t: Task = { id: nid("tsk"), title: e.title, description: e.description, dueDate: e.startAt, hasTime: true, priority: e.priority, status: "PENDING", timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), color: e.color, projectId: e.projectId ?? null, subtasks: [], tags: [], goals: [] }; S.tasks.push(t); return ok({ task: decorateTask(t) }); }
  if (method === "PATCH" && (m = p.match(/^\/events\/(.+)$/))) { const e = own(S.events, m![1]); const b = body as any; Object.assign(e, { title: b.title ?? e.title, startAt: b.startAt ?? e.startAt, endAt: b.endAt ?? e.endAt, color: b.color ?? e.color, allDay: b.allDay ?? e.allDay }); return ok({ event: e }); }
  if (method === "DELETE" && (m = p.match(/^\/events\/(.+)\/permanent$/))) { S.events = S.events.filter((e) => e.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/events\/(.+)$/))) { const e = own(S.events, m![1]); e.deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Notes ----------
  if (method === "GET" && p === "/notes") return ok({ notes: S.notes.filter((n) => query.archived === "true" ? n : !n.archived).map((n) => ({ ...n, tags: n.tags ?? [] })) });
  if (method === "POST" && p === "/notes") { const n: Note = { id: nid("nte"), title: (body as any).title ?? "Sin título", content: (body as any).content ?? "", pinned: false, archived: false, favorite: false, createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: [] }; S.notes.unshift(n); return ok({ note: n }); }
  if (method === "PATCH" && (m = p.match(/^\/notes\/(.+)\/autosave$/))) { const n = own(S.notes, m![1]); n.content = (body as any).content ?? n.content; n.title = (body as any).title ?? n.title; n.updatedAt = iso(new Date()); return ok({ note: n }); }
  if (method === "PATCH" && (m = p.match(/^\/notes\/(.+)$/))) { const n = own(S.notes, m![1]); Object.assign(n, { title: (body as any).title ?? n.title, content: (body as any).content ?? n.content, pinned: (body as any).pinned ?? n.pinned, archived: (body as any).archived ?? n.archived, favorite: (body as any).favorite ?? n.favorite }); return ok({ note: n }); }
  if (method === "POST" && (m = p.match(/^\/notes\/(.+)\/duplicate$/))) { const src = own(S.notes, m![1]); const n = { ...JSON.parse(JSON.stringify(src)), id: nid("nte"), title: src.title + " (copia)" }; S.notes.unshift(n); return ok({ note: n }); }
  if (method === "DELETE" && (m = p.match(/^\/notes\/(.+)\/permanent$/))) { S.notes = S.notes.filter((n) => n.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/notes\/(.+)$/))) { const n = own(S.notes, m![1]); n.archived = true; return ok({ ok: true }); }

  // ---------- Projects ----------
  if (method === "GET" && p === "/projects") return ok({ projects: S.projects.map((p) => ({ ...p, _count: { tasks: S.tasks.filter((t) => t.projectId === p.id).length }, progress: projectProgress(p.id) })) });
  if (method === "GET" && (m = p.match(/^\/projects\/(.+)\/tasks$/))) return ok({ tasks: S.tasks.filter((t) => t.projectId === m![1]).map(decorateTask), hasMore: false });
  if (method === "GET" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); const tasks = S.tasks.filter((t) => t.projectId === pr.id).map(decorateTask); return ok({ project: { ...pr, tasks, progress: projectProgress(pr.id) } }); }
  if (method === "POST" && p === "/projects") { const pr: Project = { id: nid("prj"), name: (body as any).name, description: (body as any).description ?? null, color: (body as any).color ?? "#6366f1", status: "PLANNING" }; S.projects.push(pr); return ok({ project: { ...pr, _count: { tasks: 0 } } }); }
  if (method === "PATCH" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); Object.assign(pr, { name: (body as any).name ?? pr.name, color: (body as any).color ?? pr.color, description: (body as any).description ?? pr.description, status: (body as any).status ?? pr.status }); return ok({ project: { ...pr, _count: { tasks: S.tasks.filter((t) => t.projectId === pr.id).length } } }); }
  if (method === "DELETE" && (m = p.match(/^\/projects\/(.+)\/permanent$/))) { S.projects = S.projects.filter((x) => x.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); (pr as any).deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Tags / Habits / Goals ----------
  if (method === "GET" && p === "/tags") return ok({ tags: S.tags });
  if (method === "POST" && p === "/tags") { const t = { id: nid("tag"), name: (body as any).name, color: (body as any).color ?? "#6366f1" }; S.tags.push(t); return ok({ tag: t }); }
  if (method === "GET" && p === "/habits") return ok({ habits: habitsList() });
  if (method === "POST" && p === "/habits") { const h: Habit = { id: nid("hbt"), name: (body as any).name, color: (body as any).color ?? "#6366f1", scheduleDayBits: (body as any).scheduleDayBits ?? 127 }; S.habits.push(h); return ok({ habit: h }); }
  if (method === "PATCH" && (m = p.match(/^\/habits\/(.+)$/))) { const h = own(S.habits, m![1]); Object.assign(h, { name: (body as any).name ?? h.name, color: (body as any).color ?? h.color, scheduleDayBits: (body as any).scheduleDayBits ?? h.scheduleDayBits }); return ok({ habit: h }); }
  if (method === "POST" && (m = p.match(/^\/habits\/(.+)\/log$/))) { const id = m![1]; const date = (body as any).date as string; S.habitLogs[id] = S.habitLogs[id] ?? []; const toggled = !S.habitLogs[id].includes(date); if (toggled) S.habitLogs[id].push(date); else S.habitLogs[id] = S.habitLogs[id].filter((k) => k !== date); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/habits\/(.+)$/))) { S.habits = S.habits.filter((h) => h.id !== m![1]); return ok({ ok: true }); }
  if (method === "GET" && p === "/goals") return ok({ goals: S.goals.map((g) => ({ ...g, progress: goalProgress(g) })) });
  if (method === "POST" && p === "/goals") { const g: Goal = { id: nid("goal"), title: (body as any).title, dueDate: (body as any).dueDate ?? null, manualProgress: -1, status: "PENDING", tasks: [] }; S.goals.push(g); return ok({ goal: { ...g, progress: 0 } }); }
  if (method === "PATCH" && (m = p.match(/^\/goals\/(.+)$/))) { const g = own(S.goals, m![1]); Object.assign(g, { title: (body as any).title ?? g.title, manualProgress: (body as any).manualProgress ?? g.manualProgress, status: (body as any).status ?? g.status }); return ok({ goal: { ...g, progress: g.manualProgress } }); }
  if (method === "DELETE" && (m = p.match(/^\/goals\/(.+)\/permanent$/))) { S.goals = S.goals.filter((g) => g.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/goals\/(.+)$/))) { const g = own(S.goals, m![1]); (g as any).deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Inbox ----------
  if (method === "GET" && p === "/inbox") return ok({ items: S.inbox });
  if (method === "POST" && p === "/inbox") { const it = { id: nid("inb"), content: (body as any).content, archived: false, createdAt: iso(new Date()) }; S.inbox.unshift(it); return ok({ item: it }); }
  if (method === "POST" && (m = p.match(/^\/inbox\/(.+)\/archive$/))) { const it = own(S.inbox, m![1]); it.archived = true; return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/inbox\/(.+)$/))) { S.inbox = S.inbox.filter((i) => i.id !== m![1]); return ok({ ok: true }); }
  if (method === "POST" && (m = p.match(/^\/inbox\/(.+)\/convert$/))) { const it = own(S.inbox, m![1]); const type = (body as any).type; it.archived = true; const title = (body as any).title ?? it.content; if (type === "TASK") { const t: Task = { id: nid("tsk"), title, dueDate: (body as any).dueDate ?? null, hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), subtasks: [], tags: [], goals: [] }; S.tasks.push(t); return ok({ task: decorateTask(t) }); } if (type === "EVENT") { const st = (body as any).startAt ? new Date((body as any).startAt) : new Date(); const e: EventItem = { id: nid("evt"), title, startAt: iso(st), endAt: iso(new Date(st.getTime() + 3600000)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#1d4ed8", tags: [] }; S.events.push(e); return ok({ event: e }); } const n: Note = { id: nid("nte"), title, content: title, pinned: false, archived: false, favorite: false, createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: [] }; S.notes.unshift(n); return ok({ note: n }); }

  // ---------- Stats / Time / Notifications / Reminders / Search ----------
  if (method === "GET" && p === "/stats") return ok(stats());
  if (method === "GET" && p === "/time/stats") return ok({ todaySeconds: 54 * 60, weekSeconds: 6 * 3600, byProject: [], byTask: [] });
  if (method === "GET" && p === "/time/running") return ok({ entries: [] });
  if (method === "POST" && p === "/time/start") { S.timeRunning = (body as any).taskId ?? "none"; S.timeStart = Date.now(); return ok({ entry: { id: nid("time"), taskId: S.timeRunning, running: true, startedAt: iso(new Date()), durationSec: 0 } }); }
  if (method === "POST" && p === "/time/stop") { const dur = S.timeStart ? Math.max(1, Math.round((Date.now() - S.timeStart) / 1000)) : 30; const task = S.tasks.find((t) => t.id === S.timeRunning); if (task) task.timeSpentMinutes += Math.ceil(dur / 60); S.timeStart = null; S.timeRunning = null; return ok({ entry: { id: nid("time"), running: false, startedAt: iso(T0), durationSec: dur } }); }
  if (method === "POST" && p === "/time/manual") {
    const b = body as { taskId?: string; minutes?: number };
    const mins = Number(b.minutes ?? 0);
    const task = b.taskId ? S.tasks.find((t) => t.id === b.taskId) : undefined;
    if (task && mins > 0) task.timeSpentMinutes += mins;
    return ok({ entry: { id: nid("time"), taskId: b.taskId ?? null, running: false, durationSec: Math.max(0, mins) * 60 } });
  }
  if (method === "GET" && p === "/transfer/export") {
    const types = String(query.types ?? "tasks,events,notes").split(",");
    return ok({
      version: 1,
      exportedAt: iso(new Date()),
      tasks: types.includes("tasks") ? S.tasks.filter((t) => !t.deletedAt) : [],
      events: types.includes("events") ? S.events.filter((e) => !e.deletedAt) : [],
      notes: types.includes("notes") ? S.notes.filter((n) => !n.archived) : [],
    });
  }
  if (method === "POST" && p === "/transfer/import") {
    const text = String((body as { text?: string })?.text ?? "");
    const created = { tasks: 0, events: 0, notes: 0 };
    try {
      const data = JSON.parse(text) as { tasks?: Task[]; events?: EventItem[]; notes?: Note[] };
      for (const t of data.tasks ?? []) {
        S.tasks.push({
          ...t,
          id: nid("tsk"),
          createdAt: iso(new Date()),
          updatedAt: iso(new Date()),
          subtasks: t.subtasks ?? [],
          tags: t.tags ?? [],
          goals: t.goals ?? [],
        });
        created.tasks += 1;
      }
      for (const e of data.events ?? []) {
        S.events.push({ ...e, id: nid("evt"), tags: e.tags ?? [] });
        created.events += 1;
      }
      for (const n of data.notes ?? []) {
        S.notes.unshift({ ...n, id: nid("nte"), createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: n.tags ?? [] });
        created.notes += 1;
      }
    } catch { /* demo: JSON only */ }
    return ok({ created });
  }
  if (method === "GET" && p === "/notifications") return ok({ notifications: S.notifications, unreadCount: S.notifications.filter((n) => !n.read).length });
  if (method === "POST" && p === "/notifications/read") { S.notifications.forEach((n) => (n.read = true)); return ok({ ok: true }); }
  if (method === "GET" && p === "/reminders") return ok({ reminders: S.reminders });
  if (method === "POST" && p === "/reminders") { const r: Reminder = { id: nid("rem"), title: (body as any).title ?? null, remindAt: (body as any).remindAt, scheduleDaily: (body as any).scheduleDaily ?? false, targetType: "NONE" }; S.reminders.push(r); return ok({ reminder: r }); }
  if (method === "DELETE" && (m = p.match(/^\/reminders\/(.+)$/))) { S.reminders = S.reminders.filter((r) => r.id !== m![1]); return ok({ ok: true }); }
  if (method === "GET" && p === "/search") return ok(search(String(query.q ?? "")));

  // ---------- Trash ----------
  if (method === "GET" && p === "/trash") {
    return ok({ tasks: S.tasks.filter((t) => t.deletedAt).map((t) => ({ id: t.id, title: t.title, deletedAt: t.deletedAt })), events: S.events.filter((e) => e.deletedAt).map((e) => ({ id: e.id, title: e.title, deletedAt: e.deletedAt })), notes: [], projects: S.projects.filter((p) => (p as any).deletedAt).map((p) => ({ id: p.id, name: p.name, deletedAt: (p as any).deletedAt })), goals: S.goals.filter((g) => (g as any).deletedAt).map((g) => ({ id: g.id, title: g.title, deletedAt: (g as any).deletedAt })) });
  }
  if (method === "POST" && p === "/trash/restore") { const b = body as any; const byType: Record<string, string[]> = { task: S.tasks.map((x) => x.id), event: S.events.map((x) => x.id), project: S.projects.map((x) => x.id), goal: S.goals.map((x) => x.id) }; if ([...["task", "event", "note", "project", "goal"]].includes(b.type)) { if (b.type === "task") own(S.tasks, b.id).deletedAt = undefined as unknown as string; } void byType; return ok({ ok: true }); }
  if (method === "DELETE" && p === "/trash/permanent") { const b = body as any; if (b.type === "task") S.tasks = S.tasks.filter((t) => t.id !== b.id); if (b.type === "event") S.events = S.events.filter((e) => e.id !== b.id); return ok({ ok: true }); }

  if (method === "POST" && p === "/alerts/tick") {
    const now = Date.now();
    const fired: { id: string; type: string; title: string; body: string; actionUrl: string }[] = [];
    for (const r of S.reminders) {
      if (r.sentAt) continue;
      if (new Date(r.remindAt).getTime() > now) continue;
      const id = nid("ntf");
      S.notifications.unshift({ id, type: "REMINDER", title: r.title || "Recordatorio", body: "Es el momento que programaste.", read: false, createdAt: iso(new Date()) });
      fired.push({ id, type: "REMINDER", title: r.title || "Recordatorio", body: "Es el momento que programaste.", actionUrl: "/reminders" });
      if (r.scheduleDaily) r.remindAt = iso(addDays(new Date(r.remindAt), 1));
      else r.sentAt = iso(new Date());
    }
    return ok({ fired });
  }
  if (method === "GET" && p === "/push/vapid") return ok({ publicKey: null });
  if (method === "POST" && p === "/push/subscribe") return ok({ ok: true });
  if (method === "POST" && p === "/push/unsubscribe") return ok({ ok: true });
  if (method === "POST" && p === "/auth/2fa/recovery-codes") return ok({ ok: true, recoveryCodes: ["DEMO1CODE0", "DEMO2CODE0"] });
  if (method === "GET" && p === "/auth/verify-email") return ok({ ok: true, emailConfirmed: true });

  // Fallback
  console.warn("[dayly-demo] no handler:", method, p);
  return send(404, { error: { code: "NOT_FOUND", message: "Demo: ruta no implementada.", details: { method, p } } });
}

function own<T extends { id: string }>(arr: T[], id: string): T {
  const it = arr.find((x) => x.id === id);
  if (!it) throw Object.assign(new Error("not found"), { status: 404 });
  return it;
}
function goalProgress(g: Goal): number {
  if (g.manualProgress >= 0) return g.manualProgress;
  const tasks = g.tasks ?? [];
  if (tasks.length) return Math.round((tasks.filter((t) => t.status === "COMPLETED").length / tasks.length) * 100);
  if (!g.dueDate) return 0;
  const span = Math.max(1, Date.parse(g.dueDate) - T0.getTime());
  return Math.round(Math.min(100, Math.max(0, ((Date.now() - T0.getTime()) / span) * 100)));
}
function projectProgress(projectId: string): number {
  const tasks = S.tasks.filter((t) => t.projectId === projectId);
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((t) => t.status === "COMPLETED").length / tasks.length) * 100);
}