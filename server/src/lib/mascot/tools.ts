import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { webSearch as webSearch } from "./search.js";
import { formatLocal as formatLocal, parseFlexibleInstant as parseFlexibleInstant, zonedDayRange as zonedDayRange } from "./time.js";
import { footballLookup as footballLookup, type FootballKind as FootballKind } from "./football.js";
import { weatherLookup, type WeatherKind } from "./weather.js";
import { APP_NAME } from "../brand.js";

function spec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}) } },
  };
}

export const MASCOT_TOOLS = [
  spec("list_tasks", "Lista tareas. when: today | tomorrow | overdue | open | completed. Incluye tareas completadas si se pide.", {
    when: { type: "string", enum: ["today", "tomorrow", "overdue", "open", "completed"] },
    query: { type: "string" },
    projectName: { type: "string" },
    includeCompleted: { type: "boolean" },
  }, ["when"]),
  spec("get_task", "Muestra todos los detalles de una tarea, incluidas descripción, notas, subtareas, etiquetas y proyecto.", { id: { type: "string" }, title: { type: "string" } }),
  spec("create_task", "Crea una tarea. Admite descripción, notas, fecha, prioridad, estado, proyecto, estimación, etiquetas, subtareas y aviso de Telegram (notifyTelegram).", {
    title: { type: "string" },
    description: { type: "string" },
    notes: { type: "string" },
    dueAt: { type: "string" },
    dueDate: { type: "string" },
    hasTime: { type: "boolean" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"] },
    projectId: { type: "string" },
    projectName: { type: "string" },
    estimateMinutes: { type: "number" },
    tagIds: { type: "array", items: { type: "string" } },
    subtasks: { type: "array", items: { type: "string" } },
    notifyTelegram: { type: "boolean", description: "true para activar el aviso de Telegram de esta tarea." },
  }, ["title"]),
  spec("complete_task", "Tacha una tarea por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("cancel_task", "Cancela una tarea por id o título. Si ya está cancelada, confirma que ya estaba así.", { id: { type: "string" }, title: { type: "string" } }),
  spec("set_task_status", "Cambia el estado de una tarea por id o título.", { id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"] } }, ["status"]),
  spec("delete_task", "Envía una tarea a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("update_task", "Edita una tarea: título, descripción, notas, fecha, hora, prioridad, estado, proyecto, estimación, color, etiquetas y aviso de Telegram (notifyTelegram true/false).", {
    id: { type: "string" },
    title: { type: "string" },
    newTitle: { type: "string" },
    description: { type: "string" },
    notes: { type: "string" },
    dueAt: { type: "string" },
    dueDate: { type: "string" },
    clearDueDate: { type: "boolean" },
    hasTime: { type: "boolean" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "POSTPONED", "COMPLETED", "CANCELLED"] },
    projectId: { type: "string" },
    projectName: { type: "string" },
    clearProject: { type: "boolean" },
    estimateMinutes: { type: "number" },
    tagIds: { type: "array", items: { type: "string" } },
    notifyTelegram: { type: "boolean", description: "true activa el aviso de Telegram; false lo desactiva." },
  }),
  spec("add_subtask", "Añade una subtarea a una tarea.", { taskId: { type: "string" }, taskTitle: { type: "string" }, title: { type: "string" } }, ["title"]),
  spec("update_subtask", "Edita o marca/desmarca una subtarea.", { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" }, newTitle: { type: "string" } }),
  spec("delete_subtask", "Envía una subtarea a la papelera de su tarea.", { id: { type: "string" }, title: { type: "string" }, taskId: { type: "string" } }),
  spec("list_projects", "Lista proyectos (id, nombre, estado).", {}),
  spec("get_project", "Muestra todos los detalles de un proyecto y sus tareas.", { id: { type: "string" }, name: { type: "string" } }),
  spec("create_project", "Crea un proyecto.", { name: { type: "string" }, description: { type: "string" }, color: { type: "string" }, status: { type: "string", enum: ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] } }, ["name"]),
  spec("update_project", "Edita nombre, descripción, color, estado o fechas de un proyecto.", { id: { type: "string" }, name: { type: "string" }, newName: { type: "string" }, description: { type: "string" }, color: { type: "string" }, status: { type: "string", enum: ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] }, dueDate: { type: "string" }, startDate: { type: "string" } }),
  spec("delete_project", "Envía un proyecto a la papelera por id o nombre.", { id: { type: "string" }, name: { type: "string" } }),
  spec("list_notes", "Lista notas. query filtra por título o contenido.", { query: { type: "string" } }),
  spec("get_note", "Muestra el contenido y todos los detalles de una nota.", { id: { type: "string" }, title: { type: "string" } }),
  spec("create_note", "Crea una nota con título, contenido, estado y organización.", { title: { type: "string" }, content: { type: "string" }, pinned: { type: "boolean" }, archived: { type: "boolean" }, favorite: { type: "boolean" }, projectId: { type: "string" } }, ["title"]),
  spec("update_note", "Edita título, contenido, fijación, archivado, favorito, color o proyecto de una nota.", { id: { type: "string" }, title: { type: "string" }, newTitle: { type: "string" }, content: { type: "string" }, pinned: { type: "boolean" }, archived: { type: "boolean" }, favorite: { type: "boolean" }, color: { type: "string" }, projectId: { type: "string" }, clearProject: { type: "boolean" } }),
  spec("delete_note", "Envía una nota a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("list_events", "Lista eventos. range: today | week.", { range: { type: "string", enum: ["today", "week"] } }),
  spec("create_event", "Crea un evento completo. startAt ISO o 'hoy 18:00'.", {
    title: { type: "string" },
    description: { type: "string" },
    startAt: { type: "string" },
    endAt: { type: "string" },
    allDay: { type: "boolean" },
    location: { type: "string" },
    category: { type: "string" },
    color: { type: "string" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    projectId: { type: "string" },
    reminderMin: { type: "number" },
  }, ["title", "startAt"]),
  spec("update_event", "Edita cualquier detalle de un evento.", {
    id: { type: "string" },
    title: { type: "string" },
    newTitle: { type: "string" },
    description: { type: "string" },
    startAt: { type: "string" },
    endAt: { type: "string" },
    allDay: { type: "boolean" },
    location: { type: "string" },
    category: { type: "string" },
    color: { type: "string" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    projectId: { type: "string" },
  }),
  spec("delete_event", "Envía un evento a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("create_reminder", "Crea un recordatorio. remindAt ISO o 'mañana 21:00'.", {
    title: { type: "string" },
    remindAt: { type: "string" },
    remindDate: { type: "string" },
  }, ["title"]),
  spec("list_reminders", "Lista recordatorios próximos. days 1-14.", { days: { type: "number" } }),
  spec("delete_reminder", "Borra un recordatorio por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("update_reminder", "Edita el título, fecha o repetición de un recordatorio.", { id: { type: "string" }, title: { type: "string" }, newTitle: { type: "string" }, remindAt: { type: "string" }, scheduleDaily: { type: "boolean" } }),
  spec("list_habits", "Lista tus hábitos y sus rachas.", {}),
  spec("create_habit", "Crea un hábito.", { name: { type: "string" }, color: { type: "string" }, icon: { type: "string" }, scheduleDayBits: { type: "number" }, reminderMinuteOfDay: { type: "number" } }, ["name"]),
  spec("update_habit", "Edita un hábito.", { id: { type: "string" }, name: { type: "string" }, color: { type: "string" }, icon: { type: "string" }, scheduleDayBits: { type: "number" }, reminderMinuteOfDay: { type: "number" } }),
  spec("log_habit", "Marca o desmarca un hábito para una fecha YYYY-MM-DD.", { id: { type: "string" }, name: { type: "string" }, date: { type: "string" }, done: { type: "boolean" } }, ["date"]),
  spec("list_goals", "Lista objetivos y su progreso.", {}),
  spec("create_goal", "Crea un objetivo.", { title: { type: "string" }, description: { type: "string" }, dueDate: { type: "string" }, manualProgress: { type: "number" }, status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"] } }, ["title"]),
  spec("update_goal", "Edita un objetivo, su progreso, estado o fecha.", { id: { type: "string" }, title: { type: "string" }, newTitle: { type: "string" }, description: { type: "string" }, dueDate: { type: "string" }, manualProgress: { type: "number" }, status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"] } }),
  spec("capture_inbox", "Guarda una idea en la bandeja de entrada.", { content: { type: "string" } }, ["content"]),
  spec("list_inbox", "Lista elementos de la bandeja de entrada.", { archived: { type: "boolean" } }),
  spec("archive_inbox", "Archiva un elemento de la bandeja.", { id: { type: "string" } }, ["id"]),
  spec("convert_inbox", "Convierte un elemento de la bandeja en tarea, evento o nota.", { id: { type: "string" }, type: { type: "string", enum: ["TASK", "EVENT", "NOTE"] }, title: { type: "string" }, dueDate: { type: "string" }, startAt: { type: "string" } }, ["id", "type"]),
  spec("list_trash", "Lista elementos enviados a la papelera.", {}),
  spec("restore_from_trash", "Restaura un elemento de la papelera.", { type: { type: "string", enum: ["task", "event", "note", "project", "goal"] }, id: { type: "string" } }, ["type", "id"]),
  spec("start_timer", "Inicia un temporizador, opcionalmente para una tarea.", { taskId: { type: "string" }, taskTitle: { type: "string" }, projectId: { type: "string" }, note: { type: "string" } }),
  spec("stop_timer", "Detiene el temporizador en curso.", { id: { type: "string" } }),
  spec("time_summary", "Resume el tiempo registrado hoy y esta semana.", {}),
  spec("list_radio_stations", `Lista las emisoras disponibles para el reproductor de ${APP_NAME}.`, {}),
  spec("radio_control", `Controla la radio de ${APP_NAME}. Usa play para reproducir, pause para pausar y set_station para cambiar de emisora. Indica stationName o stationId. Remember / Remember The Music FM es remember-music, no Loca FM Remember (loca-remember).`, {
    action: { type: "string", enum: ["play", "pause", "set_station"] },
    stationId: { type: "string" },
    stationName: { type: "string" },
    station: { type: "string" },
  }, ["action"]),
  spec("web_search", "Solo recetas/menús, ejercicio básico o datos prácticos de una tarea (horario de un comercio, farmacia…). Nunca fútbol ni clima.", { query: { type: "string" } }, ["query"]),
  spec("football_lookup", "Fútbol: próximo partido o resultados. Úsala SIEMPRE para fútbol.", {
    team: { type: "string" },
    kind: { type: "string", enum: ["next", "last", "upcoming", "results"] },
  }, ["team"]),
  spec("weather_lookup", "Clima y temperatura (Open-Meteo). place vacío = ciudad de la zona horaria. kind: now | today | tomorrow | week.", {
    place: { type: "string" },
    kind: { type: "string", enum: ["now", "today", "tomorrow", "week"] },
  }),
  spec("search_agenda", "Busca por palabra clave en tareas, notas, eventos, proyectos, objetivos y hábitos.", { query: { type: "string" } }, ["query"]),
  spec("link_task_to_goal", "Vincula una tarea existente a un objetivo para que sume en su progreso.", { taskId: { type: "string" }, goalId: { type: "string" } }, ["taskId", "goalId"]),
  spec("memory_get", "Lee los datos que recuerdas sobre el usuario (gustos, preferencias, nombres, horarios fijos).", {}),
  spec("memory_set", "Guarda o actualiza un dato que el usuario quiera que recuerdes. key: etiqueta corta (p. ej. 'preferencia', 'horario'), value: el dato.", {
    key: { type: "string" },
    value: { type: "string" },
  }, ["key", "value"]),
];

type Args = Record<string, unknown>;

export type MascotToolContext = { footballApiKey?: string | null };

type RadioActionName = "play" | "pause" | "set_station";

export type MascotRadioAction = {
  type: "radio";
  action: RadioActionName;
  stationId?: string;
};

const RADIO_STATIONS = [
  { id: "loca-urban", name: "Loca FM Urban", note: "Urbano, reguetón y latin" },
  { id: "loca-fm", name: "Loca FM", note: "Electrónica y dance en directo" },
  { id: "loca-dance", name: "Loca FM Dance", note: "Dance y éxitos de club" },
  { id: "loca-remember", name: "Loca FM Remember", note: "Clásicos dance y mákina" },
  { id: "loca-house", name: "Loca FM House", note: "House" },
  { id: "loca-chill", name: "Loca FM Chill Out", note: "Chill out" },
  { id: "loca-hard", name: "Loca FM Hard", note: "Hard dance" },
  { id: "loca-techno", name: "Loca FM Techno", note: "Techno" },
  { id: "loca-80s", name: "Loca FM 80s", note: "Electrónica de los 80" },
  { id: "loca-90s", name: "Loca FM 90s", note: "Electrónica de los 90" },
  { id: "gozadera", name: "Gozadera FM", note: "Reguetón y música urbana" },
  { id: "los40", name: "LOS40", note: "Éxitos y fórmula musical" },
  { id: "cadena-dial", name: "Cadena Dial", note: "Música en español" },
  { id: "los40-dance", name: "LOS40 Dance", note: "Dance y electrónica" },
  { id: "remember-music", name: "Remember The Music FM", note: "Remember desde Valencia" },
  { id: "wifon-fm", name: "Wifon FM", note: "Remember murciano 24 h" },
] as const;

function compactRadioText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Keep in sync with matchRadioStation in client/src/lib/radioStations.ts. "Remember" must not hit Loca FM Remember first. */
function resolveRadioStation(args: Args) {
  const id = str(args.stationId);
  if (id) return RADIO_STATIONS.find((station) => station.id === id) ?? null;
  const raw = str(args.stationName) || str(args.station);
  if (!raw) return null;
  const compact = compactRadioText(raw);
  if (!compact) return null;

  let best: { station: (typeof RADIO_STATIONS)[number]; score: number } | null = null;
  for (const station of RADIO_STATIONS) {
    const nameCompact = compactRadioText(station.name);
    const nameNoFm = nameCompact.replace(/fm/g, "");
    const idCompact = compactRadioText(station.id);
    const nameTokens = station.name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((token) => token && token !== "fm");
    let score = 0;
    if (nameCompact === compact || idCompact === compact || nameNoFm === compact) {
      score = 1000 + nameCompact.length;
    } else if (nameCompact.startsWith(compact) || nameNoFm.startsWith(compact)) {
      score = 800 + compact.length;
    } else if (compact.includes(nameCompact) || compact.includes(nameNoFm)) {
      score = 600 + nameNoFm.length;
    } else if (compact.length >= 6 && (nameCompact.includes(compact) || nameNoFm.includes(compact))) {
      score = 400 + compact.length;
    } else if (nameTokens.length > 0 && nameTokens.every((token) => compact.includes(compactRadioText(token)))) {
      score = 300 + nameTokens.join("").length;
    }
    if (score > (best?.score ?? 0)) best = { station, score };
  }
  return best?.station ?? null;
}

export function radioActionFromToolResult(toolName: string, result: string): MascotRadioAction | null {
  if (toolName !== "radio_control") return null;
  const match = /^OK id=radio action=(play|pause|set_station)(?: stationId=([^\s|]+))?/.exec(result);
  if (!match) return null;
  return {
    type: "radio",
    action: match[1] as RadioActionName,
    ...(match[2] ? { stationId: match[2] } : {}),
  };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

async function searchAgenda(userId: string, q: string): Promise<string> {
  if (!q) return "NO_OK code=invalid_args | ¿Qué busco?";
  const like = { contains: q };
  const [tasks, notes, events, projects, goals, habits] = await Promise.all([
    prisma.task.findMany({ where: { userId, deletedAt: null, title: like }, take: 5, select: { id: true, title: true } }),
    prisma.note.findMany({ where: { userId, deletedAt: null, OR: [{ title: like }, { content: like }] }, take: 5, select: { id: true, title: true } }),
    prisma.event.findMany({ where: { userId, deletedAt: null, title: like }, take: 5, select: { id: true, title: true } }),
    prisma.project.findMany({ where: { userId, deletedAt: null, name: like }, take: 5, select: { id: true, name: true } }),
    prisma.goal.findMany({ where: { userId, deletedAt: null, title: like }, take: 5, select: { id: true, title: true } }),
    prisma.habit.findMany({ where: { userId, name: like }, take: 5, select: { id: true, name: true } }),
  ]);
  const list = (label: string, rows: { id: string; name: string }[]) => rows.length ? [`${label}: ${rows.map((r) => `${r.name} (id=${r.id})`).join(", ")}`] : [];
  const parts = [
    ...list("Tareas", tasks.map((t) => ({ id: t.id, name: t.title }))),
    ...list("Notas", notes.map((n) => ({ id: n.id, name: n.title }))),
    ...list("Eventos", events.map((e) => ({ id: e.id, name: e.title }))),
    ...list("Proyectos", projects),
    ...list("Objetivos", goals.map((g) => ({ id: g.id, name: g.title }))),
    ...list("Hábitos", habits),
  ];
  return parts.length ? parts.join("\n") : `Nada con «${q}».`;
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

function pickStr(args: Args, keys: string[]): string {
  for (const k of keys) {
    const v = str(args[k]);
    if (v) return v;
  }
  return "";
}

/** true/false from tool args; undefined if the model omitted the field. */
export function pickBool(args: Args, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "boolean") return v;
    if (v === 1) return true;
    if (v === 0) return false;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["true", "yes", "si", "sí", "1", "on"].includes(s)) return true;
      if (["false", "no", "0", "off"].includes(s)) return false;
    }
  }
  return undefined;
}

function pickInstant(args: Args, keys: string[], tz: string) {
  const raw = pickStr(args, keys);
  return raw ? parseFlexibleInstant(raw, tz) : null;
}

/** Alias dueAt / dueDate / due for tests and create_task. */
export function instantFromDueAlias(args: Args, tz: string): Date | null {
  return pickInstant(args, ["dueAt", "dueDate", "due"], tz);
}

function looksLikeTime(raw: string): boolean {
  return /T\d{2}:/.test(raw) || /\d{1,2}[:h]\d{2}/i.test(raw) || /\ba\s*las?\s*\d/i.test(raw);
}

export function parseToolArgs(raw: unknown): Args {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Args;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Args : { __parseError: true };
    } catch { return { __parseError: true }; }
  }
  return { __parseError: true };
}

export async function runMascotTool(userId: string, timezone: string, name: string, args: Args, ctx: MascotToolContext = {}): Promise<string> {
  const tz = timezone || "Europe/Madrid";
  if (args.__parseError) return "NO_OK code=invalid_args | No entendí los parámetros de la acción. Vuelve a intentarlo con los datos concretos.";
  try {
    switch (name) {
      case "list_tasks":
        return await listTasks(userId, tz, str(args.when, "open"), str(args.query), str(args.projectName), args.includeCompleted === true);
      case "get_task":
        return await getTask(userId, tz, args);
      case "create_task":
        return await createTask(userId, tz, args);
      case "complete_task":
        return await setTaskStatus(userId, tz, args, "COMPLETED");
      case "cancel_task":
        return await setTaskStatus(userId, tz, args, "CANCELLED");
      case "set_task_status": {
        const next = str(args.status);
        if (!["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"].includes(next)) return "NO_OK code=invalid_status | Ese estado no existe.";
        return await setTaskStatus(userId, tz, args, next as "PENDING" | "IN_PROGRESS" | "POSTPONED" | "COMPLETED" | "CANCELLED");
      }
      case "delete_task":
        return await deleteTask(userId, tz, args);
      case "update_task":
        return await updateTask(userId, tz, args);
      case "add_subtask":
        return await addSubtask(userId, args);
      case "update_subtask":
        return await updateSubtask(userId, args);
      case "delete_subtask":
        return await deleteSubtask(userId, args);
      case "list_projects":
        return await listProjects(userId);
      case "get_project":
        return await getProject(userId, args);
      case "create_project":
        return await createProject(userId, args);
      case "update_project":
        return await updateProject(userId, args);
      case "delete_project":
        return await deleteProject(userId, args);
      case "list_notes":
        return await listNotes(userId, str(args.query));
      case "get_note":
        return await getNote(userId, args);
      case "create_note":
        return await createNote(userId, args);
      case "update_note":
        return await updateNote(userId, args);
      case "delete_note":
        return await deleteNote(userId, args);
      case "list_events":
        return await listEvents(userId, tz, str(args.range, "week"));
      case "create_event":
        return await createEvent(userId, tz, args);
      case "update_event":
        return await updateEvent(userId, tz, args);
      case "delete_event":
        return await deleteEvent(userId, args);
      case "create_reminder":
        return await createReminder(userId, tz, args);
      case "list_reminders":
        return await listReminders(userId, tz, typeof args.days === "number" ? args.days : 7);
      case "delete_reminder":
        return await deleteReminder(userId, args);
      case "update_reminder":
        return await updateReminder(userId, tz, args);
      case "list_habits":
        return await listHabits(userId);
      case "create_habit":
        return await createHabit(userId, args);
      case "update_habit":
        return await updateHabit(userId, args);
      case "log_habit":
        return await logHabit(userId, args);
      case "list_goals":
        return await listGoals(userId);
      case "create_goal":
        return await createGoal(userId, tz, args);
      case "update_goal":
        return await updateGoal(userId, tz, args);
      case "capture_inbox":
        return await captureInbox(userId, args);
      case "list_inbox":
        return await listInbox(userId, args);
      case "archive_inbox":
        return await archiveInbox(userId, args);
      case "convert_inbox":
        return await convertInbox(userId, tz, args);
      case "list_trash":
        return await listTrash(userId);
      case "restore_from_trash":
        return await restoreFromTrash(userId, args);
      case "start_timer":
        return await startTimer(userId, args);
      case "stop_timer":
        return await stopTimer(userId, args);
      case "time_summary":
        return await timeSummary(userId);
      case "list_radio_stations":
        return listRadioStations();
      case "radio_control":
        return radioControl(args);
      case "web_search":
        return await webSearch(str(args.query), tz, ctx.footballApiKey);
      case "football_lookup": {
        const kindRaw = str(args.kind, "next");
        const kind = (["next", "last", "upcoming", "results"].includes(kindRaw) ? kindRaw : "next") as FootballKind;
        return await footballLookup(str(args.team), kind, tz, ctx.footballApiKey);
      }
      case "weather_lookup": {
        const kindRaw = str(args.kind, "now");
        const kind = (["now", "today", "tomorrow", "week"].includes(kindRaw) ? kindRaw : "now") as WeatherKind;
        const place = str(args.place) || str(args.city) || str(args.location);
        return await weatherLookup(place, kind, tz);
      }
      case "search_agenda":
        return await searchAgenda(userId, str(args.query).trim());
      case "link_task_to_goal": {
        const task = await prisma.task.findFirst({ where: { id: str(args.taskId), userId, deletedAt: null }, select: { id: true, title: true } });
        const goal = await prisma.goal.findFirst({ where: { id: str(args.goalId), userId, deletedAt: null }, select: { id: true, title: true } });
        if (!task) return "NO_OK code=not_found | No encuentro esa tarea.";
        if (!goal) return "NO_OK code=not_found | No encuentro ese objetivo.";
        await prisma.task.update({ where: { id: task.id }, data: { goals: { connect: { id: goal.id } } } });
        return `OK id=${goal.id} | Tarea «${task.title}» vinculada a «${goal.title}».`;
      }
      case "memory_get": {
        const rows = await prisma.mascotMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 30 });
        return rows.length ? rows.map((r) => `${r.key}: ${r.value}`).join("\n") : "No recuerdo nada tuyo todavía.";
      }
      case "memory_set": {
        const key = clip(str(args.key).trim(), 120);
        const value = clip(str(args.value).trim(), 2000);
        if (!key || !value) return "NO_OK code=invalid_args | Necesito una clave y un valor.";
        await prisma.mascotMemory.upsert({ where: { userId_key: { userId, key } }, update: { value }, create: { userId, key, value } });
        return `OK id=${key} | Lo recordaré.`;
      }
      default:
        return `NO_OK code=unknown_tool | No tengo esa acción disponible. Puedo trabajar con tus tareas, notas, proyectos, eventos, recordatorios, hábitos, objetivos y bandeja.`;
    }
  } catch (err) {
    logger.warn({ err, name }, "mascot tool failed");
    return `NO_OK code=internal | No se pudo completar ${name}: ${err instanceof Error ? err.message : "fallo interno"}. Comprueba los datos e inténtalo de nuevo.`;
  }
}

type IdOrErr = { ok: true; id: string | null } | { ok: false; msg: string };

async function resolveProject(userId: string, args: Args): Promise<IdOrErr> {
  const id = str(args.projectId);
  if (id) {
    const p = await prisma.project.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
    return p ? { ok: true, id: p.id } : { ok: false, msg: "No encuentro ese proyecto." };
  }
  const name = str(args.projectName);
  if (!name) return { ok: true, id: null };
  const hits = await prisma.project.findMany({
    where: { userId, deletedAt: null, name: { contains: name } },
    take: 6,
    select: { id: true, name: true },
  });
  if (hits.length === 0) return { ok: false, msg: `No hay proyectos que coincidan con «${name}».` };
  if (hits.length > 1) {
    return { ok: false, msg: `Hay varios proyectos:\n${hits.map((p) => `${p.id} | ${p.name}`).join("\n")}\nIndica el id.` };
  }
  return { ok: true, id: hits[0]!.id };
}

async function findTask(userId: string, args: Args) {
  const id = str(args.id) || str(args.taskId);
  if (id) {
    const t = await prisma.task.findFirst({ where: { id, userId, deletedAt: null } });
    return t ?? "No encuentro esa tarea.";
  }
  const q = str(args.title) || str(args.query);
  if (!q) return "Indica el id o el título de la tarea.";
  const hits = await prisma.task.findMany({
    where: { userId, deletedAt: null, title: { contains: q } },
    take: 8,
    select: { id: true, title: true, status: true, dueDate: true },
  });
  if (hits.length === 0) return `No hay tareas que coincidan con «${q}».`;
  if (hits.length > 1) {
    return `Hay varias tareas:\n${hits.map((t) => `${t.id} | ${t.title} | ${t.status}`).join("\n")}\nDi el id.`;
  }
  return prisma.task.findFirstOrThrow({ where: { id: hits[0]!.id } });
}

async function listTasks(userId: string, tz: string, when: string, query: string, projectName: string, includeCompleted: boolean): Promise<string> {
  const where: Prisma.TaskWhereInput = { userId, deletedAt: null, ...(includeCompleted || when === "completed" ? {} : { status: { not: "COMPLETED" } }) };
  if (when === "today") {
    const { start, end } = zonedDayRange(tz, 0);
    where.dueDate = { gte: start, lt: end };
  } else if (when === "tomorrow") {
    const { start, end } = zonedDayRange(tz, 1);
    where.dueDate = { gte: start, lt: end };
  } else if (when === "overdue") {
    const { start } = zonedDayRange(tz, 0);
    where.dueDate = { lt: start };
  } else if (when === "completed") {
    where.status = "COMPLETED";
  }
  if (query) where.title = { contains: query };
  if (projectName) {
    const proj = await resolveProject(userId, { projectName });
    if (!proj.ok) return proj.msg;
    if (proj.id) where.projectId = proj.id;
  }
  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 20,
    select: { id: true, title: true, dueDate: true, status: true, priority: true, notifyTelegram: true },
  });
  if (tasks.length === 0) return when === "tomorrow" ? "No hay tareas para mañana." : "No hay tareas en ese filtro.";
  return tasks.map((t) => `${t.id} | ${t.title} | ${t.status} | ${t.dueDate ? formatLocal(t.dueDate, tz) : "sin fecha"}${t.notifyTelegram ? " | aviso Telegram" : ""}`).join("\n");
}

async function createTask(userId: string, tz: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  if (!title) return "Falta el título de la tarea.";
  const dueRaw = pickStr(args, ["dueAt", "dueDate", "due"]);
  const due = instantFromDueAlias(args, tz);
  if (dueRaw && !due) return "No entendí la fecha. Usa ISO o 'hoy'/'mañana'.";
  const prio = str(args.priority, "NORMAL");
  const priority = (["LOW", "NORMAL", "HIGH", "URGENT"].includes(prio) ? prio : "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "URGENT";
  const statusRaw = str(args.status, "PENDING");
  const status = (["PENDING", "IN_PROGRESS", "POSTPONED", "COMPLETED", "CANCELLED"].includes(statusRaw) ? statusRaw : "PENDING") as "PENDING" | "IN_PROGRESS" | "POSTPONED" | "COMPLETED" | "CANCELLED";
  const proj = await resolveProject(userId, args);
  if (!proj.ok) return proj.msg;
  const tagIds = Array.isArray(args.tagIds) ? args.tagIds.filter((id): id is string => typeof id === "string" && id.trim() !== "") : [];
  if (tagIds.length) {
    const tagCount = await prisma.tag.count({ where: { id: { in: tagIds }, userId } });
    if (tagCount !== tagIds.length) return "NO_OK code=invalid_tag | Alguna etiqueta no pertenece a tu cuenta.";
  }
  const subtasks = Array.isArray(args.subtasks)
    ? args.subtasks.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => ({ title: clip(value.trim(), 300) })).slice(0, 200)
    : [];
  const estimate = typeof args.estimateMinutes === "number" && Number.isFinite(args.estimateMinutes) && args.estimateMinutes >= 0
    ? Math.round(args.estimateMinutes)
    : null;
  const dueHasTime = dueRaw ? looksLikeTime(dueRaw) : false;
  const hasTime = typeof args.hasTime === "boolean" ? args.hasTime : dueHasTime;
  const notifyTelegram = pickBool(args, ["notifyTelegram", "telegram", "telegramAlert"]) === true;
  const maxOrder = await prisma.task.aggregate({
    where: { userId, deletedAt: null, projectId: proj.id },
    _max: { sortOrder: true },
  });
  const task = await prisma.task.create({
    data: {
      userId,
      title,
      description: str(args.description) ? clip(str(args.description), 5000) : null,
      notes: str(args.notes) ? clip(str(args.notes), 5000) : null,
      dueDate: due,
      hasTime,
      notifyTelegram,
      priority,
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
      estimateMinutes: estimate,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      projectId: proj.id,
      ...(tagIds.length ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
      ...(subtasks.length ? { subtasks: { create: subtasks.map((subtask, i) => ({ ...subtask, userId, sortOrder: i })) } } : {}),
    },
  });
  const when = task.dueDate ? ` para ${formatLocal(task.dueDate, tz)}` : " (sin fecha)";
  return `OK id=${task.id} | Tarea creada: «${task.title}»${when}${subtasks.length ? ` con ${subtasks.length} subtarea${subtasks.length === 1 ? "" : "s"}` : ""}${notifyTelegram ? ". Aviso de Telegram activado" : ""}.`;
}

async function getTask(userId: string, tz: string, args: Args): Promise<string> {
  const found = await findTask(userId, args);
  if (typeof found === "string") return `NO_OK code=not_found | ${found}`;
  const task = await prisma.task.findFirst({
    where: { id: found.id, userId, deletedAt: null },
    include: {
      subtasks: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      tags: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!task) return "NO_OK code=not_found | No encuentro esa tarea.";
  const due = task.dueDate ? formatLocal(task.dueDate, tz) : "sin fecha";
  const subtasks = task.subtasks.length
    ? `\nSubtareas:\n${task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.id} | ${s.title}`).join("\n")}`
    : "";
  return [
    `ID: ${task.id}`,
    `Título: ${task.title}`,
    `Estado: ${task.status}`,
    `Prioridad: ${task.priority}`,
    `Fecha: ${due}`,
    `Aviso Telegram: ${task.notifyTelegram ? "activado" : "desactivado"}`,
    `Proyecto: ${task.project?.name ?? "sin proyecto"}`,
    `Descripción: ${task.description || "sin descripción"}`,
    `Notas: ${task.notes || "sin notas"}`,
    `Estimación: ${task.estimateMinutes ?? "sin estimar"} minutos`,
    `Etiquetas: ${task.tags.map((tag) => `#${tag.name}`).join(", ") || "ninguna"}`,
    subtasks,
  ].filter(Boolean).join("\n");
}

async function setTaskStatus(userId: string, tz: string, args: Args, status: "PENDING" | "IN_PROGRESS" | "POSTPONED" | "COMPLETED" | "CANCELLED"): Promise<string> {
  const found = await findTask(userId, args);
  if (typeof found === "string") return found;
  if (found.status === status) return `OK id=${found.id} | La tarea «${found.title}» ya estaba en estado ${status}.`;
  const now = new Date();
  const task = await prisma.task.update({
    where: { id: found.id },
    data: { status, completedAt: status === "COMPLETED" ? now : null, statusChangedAt: now },
  });
  const verb = status === "COMPLETED" ? "Tachada" : status === "CANCELLED" ? "Cancelada" : "Estado actualizado";
  return `OK id=${task.id} | ${verb}: «${task.title}» (${formatLocal(now, tz)}).`;
}

async function deleteTask(userId: string, tz: string, args: Args): Promise<string> {
  const found = await findTask(userId, args);
  if (typeof found === "string") return found;
  await prisma.task.update({ where: { id: found.id }, data: { deletedAt: new Date() } });
  return `OK id=${found.id} | Tarea a la papelera: «${found.title}» (${formatLocal(new Date(), tz)}).`;
}

async function updateTask(userId: string, tz: string, args: Args): Promise<string> {
  const found = await findTask(userId, args);
  if (typeof found === "string") return found;
  const data: Prisma.TaskUpdateInput = {};
  const newTitle = str(args.newTitle);
  if (newTitle) data.title = clip(newTitle, 300);
  if (typeof args.description === "string") data.description = str(args.description) ? clip(str(args.description), 5000) : null;
  if (typeof args.notes === "string") data.notes = str(args.notes) ? clip(str(args.notes), 5000) : null;
  if (typeof args.hasTime === "boolean") data.hasTime = args.hasTime;
  if (typeof args.estimateMinutes === "number" && Number.isFinite(args.estimateMinutes) && args.estimateMinutes >= 0) {
    data.estimateMinutes = Math.round(args.estimateMinutes);
  }
  const dueRaw = pickStr(args, ["dueAt", "dueDate", "due"]);
  if (args.clearDueDate === true) {
    data.dueDate = null;
    data.hasTime = false;
  } else if (dueRaw) {
    const due = parseFlexibleInstant(dueRaw, tz);
    if (!due) return "No entendí la fecha nueva.";
    data.dueDate = due;
    if (typeof args.hasTime !== "boolean") data.hasTime = looksLikeTime(dueRaw);
  }
  const prio = str(args.priority);
  if (prio && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(prio)) data.priority = prio as "LOW" | "NORMAL" | "HIGH" | "URGENT";
  const nextStatus = str(args.status);
  if (nextStatus && ["PENDING", "IN_PROGRESS", "POSTPONED", "COMPLETED", "CANCELLED"].includes(nextStatus)) {
    data.status = nextStatus as "PENDING" | "IN_PROGRESS" | "POSTPONED" | "COMPLETED" | "CANCELLED";
    data.completedAt = nextStatus === "COMPLETED" ? new Date() : null;
    data.statusChangedAt = new Date();
  }
  if (args.clearProject === true) {
    data.project = { disconnect: true };
  } else if (str(args.projectId) || str(args.projectName)) {
    const proj = await resolveProject(userId, args);
    if (!proj.ok) return proj.msg;
    data.project = proj.id ? { connect: { id: proj.id } } : { disconnect: true };
  }
  if (Array.isArray(args.tagIds)) {
    const tagIds = args.tagIds.filter((id): id is string => typeof id === "string" && id.trim() !== "");
    const tagCount = await prisma.tag.count({ where: { id: { in: tagIds }, userId } });
    if (tagCount !== tagIds.length) return "NO_OK code=invalid_tag | Alguna etiqueta no pertenece a tu cuenta.";
    data.tags = { set: tagIds.map((id) => ({ id })) };
  }
  const notifyTelegram = pickBool(args, ["notifyTelegram", "telegram", "telegramAlert"]);
  if (notifyTelegram !== undefined) data.notifyTelegram = notifyTelegram;
  if (Object.keys(data).length === 0) return `OK id=${found.id} | No había cambios que aplicar a «${found.title}».`;
  const task = await prisma.task.update({ where: { id: found.id }, data });
  const telegramNote = notifyTelegram === true ? " Aviso de Telegram activado." : notifyTelegram === false ? " Aviso de Telegram desactivado." : "";
  return `OK id=${task.id} | Tarea actualizada: «${task.title}»${task.dueDate ? ` · ${formatLocal(task.dueDate, tz)}` : ""}.${telegramNote}`;
}

async function addSubtask(userId: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  if (!title) return "NO_OK code=missing_title | Indica el título de la subtarea.";
  const task = await findTask(userId, { id: str(args.taskId), title: str(args.taskTitle) });
  if (typeof task === "string") return `NO_OK code=task_not_found | ${task}`;
  const count = await prisma.subtask.count({ where: { taskId: task.id, deletedAt: null } });
  const subtask = await prisma.subtask.create({ data: { userId, taskId: task.id, title, sortOrder: count } });
  return `OK id=${subtask.id} | Subtarea añadida a «${task.title}»: «${subtask.title}».`;
}

async function updateSubtask(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  let subtask = id ? await prisma.subtask.findFirst({ where: { id, userId, deletedAt: null }, include: { task: { select: { title: true } } } }) : null;
  if (!subtask && str(args.title)) {
    const hits = await prisma.subtask.findMany({ where: { userId, deletedAt: null, title: { contains: str(args.title) } }, take: 6, include: { task: { select: { title: true } } } });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varias subtareas:\n${hits.map((s) => `${s.id} | ${s.title} | tarea: ${s.task.title}`).join("\n")}\nIndica el id.`;
    subtask = hits[0] ?? null;
  }
  if (!subtask) return "NO_OK code=not_found | Indica el id o título de la subtarea.";
  const data: Prisma.SubtaskUpdateInput = {};
  if (typeof args.done === "boolean") data.done = args.done;
  if (typeof args.newTitle === "string" && str(args.newTitle)) data.title = clip(str(args.newTitle), 300);
  if (Object.keys(data).length === 0) return `OK id=${subtask.id} | No había cambios que aplicar.`;
  const updated = await prisma.subtask.update({ where: { id: subtask.id }, data });
  return `OK id=${updated.id} | Subtarea actualizada: «${updated.title}»${updated.done ? " (completada)" : ""}.`;
}

async function deleteSubtask(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  let subtask = id ? await prisma.subtask.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!subtask && str(args.title)) {
    const hits = await prisma.subtask.findMany({ where: { userId, deletedAt: null, title: { contains: str(args.title) }, ...(str(args.taskId) ? { taskId: str(args.taskId) } : {}) }, take: 6 });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varias subtareas:\n${hits.map((s) => `${s.id} | ${s.title}`).join("\n")}\nIndica el id.`;
    subtask = hits[0] ?? null;
  }
  if (!subtask) return "NO_OK code=not_found | No encuentro esa subtarea.";
  await prisma.subtask.update({ where: { id: subtask.id }, data: { deletedAt: new Date() } });
  return `OK id=${subtask.id} | Subtarea enviada a la papelera: «${subtask.title}».`;
}

async function listProjects(userId: string): Promise<string> {
  const projects = await prisma.project.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, name: true, status: true },
  });
  if (projects.length === 0) return "No hay proyectos.";
  return projects.map((p) => `${p.id} | ${p.name} | ${p.status}`).join("\n");
}

async function createProject(userId: string, args: Args): Promise<string> {
  const name = clip(str(args.name) || str(args.title), 200);
  if (!name) return "Falta el nombre del proyecto.";
  const status = str(args.status, "PLANNING");
  const project = await prisma.project.create({
    data: {
      userId,
      name,
      description: str(args.description) ? clip(str(args.description), 5000) : null,
      color: str(args.color) || null,
      status: (["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(status) ? status : "PLANNING") as "PLANNING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED",
    },
  });
  return `OK id=${project.id} | Proyecto creado: «${project.name}».`;
}

async function findProject(userId: string, args: Args) {
  const id = str(args.id) || str(args.projectId);
  const q = str(args.name) || str(args.projectName) || str(args.title);
  let project = id ? await prisma.project.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!project && q) {
    const hits = await prisma.project.findMany({ where: { userId, deletedAt: null, name: { contains: q } }, take: 6, select: { id: true, name: true, status: true } });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varios proyectos:\n${hits.map((p) => `${p.id} | ${p.name} | ${p.status}`).join("\n")}\nIndica el id.`;
    if (hits.length === 1) project = await prisma.project.findFirst({ where: { id: hits[0]!.id, userId, deletedAt: null } });
  }
  return project ?? "NO_OK code=not_found | No encuentro ese proyecto.";
}

async function getProject(userId: string, args: Args): Promise<string> {
  const found = await findProject(userId, args);
  if (typeof found === "string") return found;
  const project = await prisma.project.findFirst({
    where: { id: found.id, userId, deletedAt: null },
    include: { tasks: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, title: true, status: true } } },
  });
  if (!project) return "NO_OK code=not_found | No encuentro ese proyecto.";
  return [`ID: ${project.id}`, `Nombre: ${project.name}`, `Estado: ${project.status}`, `Descripción: ${project.description || "sin descripción"}`, `Tareas:\n${project.tasks.map((t) => `- ${t.id} | ${t.title} | ${t.status}`).join("\n") || "(ninguna)"}`].join("\n");
}

async function updateProject(userId: string, args: Args): Promise<string> {
  const found = await findProject(userId, args);
  if (typeof found === "string") return found;
  const data: Prisma.ProjectUpdateInput = {};
  const name = str(args.newName);
  if (name) data.name = clip(name, 200);
  if (typeof args.description === "string") data.description = str(args.description) ? clip(str(args.description), 5000) : null;
  if (typeof args.color === "string") data.color = str(args.color) || null;
  const status = str(args.status);
  if (status && ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(status)) data.status = status as "PLANNING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  if (typeof args.startDate === "string") data.startDate = parseFlexibleInstant(args.startDate, "UTC");
  if (typeof args.dueDate === "string") data.dueDate = parseFlexibleInstant(args.dueDate, "UTC");
  if (Object.keys(data).length === 0) return `OK id=${found.id} | No había cambios que aplicar a «${found.name}».`;
  const updated = await prisma.project.update({ where: { id: found.id }, data });
  return `OK id=${updated.id} | Proyecto actualizado: «${updated.name}».`;
}

async function deleteProject(userId: string, args: Args): Promise<string> {
  const found = await findProject(userId, args);
  if (typeof found === "string") return found;
  await prisma.project.update({ where: { id: found.id }, data: { deletedAt: new Date() } });
  return `OK id=${found.id} | Proyecto enviado a la papelera: «${found.name}».`;
}

async function listNotes(userId: string, query: string): Promise<string> {
  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null, ...(query ? { OR: [{ title: { contains: query } }, { content: { contains: query } }] } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 20,
    select: { id: true, title: true },
  });
  if (notes.length === 0) return "No hay notas.";
  return notes.map((n) => `${n.id} | ${n.title}`).join("\n");
}

async function createNote(userId: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300) || "Sin título";
  const projectId = str(args.projectId);
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } });
    if (!project) return "NO_OK code=invalid_project | Ese proyecto no pertenece a tu cuenta.";
  }
  const note = await prisma.note.create({
    data: {
      userId,
      title,
      content: typeof args.content === "string" ? clip(args.content, 200000) : null,
      pinned: args.pinned === true,
      archived: args.archived === true,
      favorite: args.favorite === true,
      projectId: projectId || null,
    },
  });
  return `OK id=${note.id} | Nota creada: «${note.title}».`;
}

async function getNote(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title) || str(args.query);
  let note = id ? await prisma.note.findFirst({ where: { id, userId, deletedAt: null }, include: { project: { select: { name: true } } } }) : null;
  if (!note && q) {
    const hits = await prisma.note.findMany({ where: { userId, deletedAt: null, OR: [{ title: { contains: q } }, { content: { contains: q } }] }, take: 6, select: { id: true, title: true } });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varias notas:\n${hits.map((n) => `${n.id} | ${n.title}`).join("\n")}\nIndica el id.`;
    if (hits.length === 1) note = await prisma.note.findFirst({ where: { id: hits[0]!.id, userId, deletedAt: null }, include: { project: { select: { name: true } } } });
  }
  if (!note) return "NO_OK code=not_found | No encuentro esa nota.";
  return [
    `ID: ${note.id}`,
    `Título: ${note.title}`,
    `Contenido:\n${note.content || "(vacía)"}`,
    `Fijada: ${note.pinned ? "sí" : "no"} · Favorita: ${note.favorite ? "sí" : "no"} · Archivada: ${note.archived ? "sí" : "no"}`,
    `Proyecto: ${note.project?.name ?? "sin proyecto"}`,
  ].join("\n");
}

async function updateNote(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title) || str(args.query);
  let note = id ? await prisma.note.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!note && q) {
    const hits = await prisma.note.findMany({ where: { userId, deletedAt: null, OR: [{ title: { contains: q } }, { content: { contains: q } }] }, take: 6, select: { id: true, title: true } });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varias notas:\n${hits.map((n) => `${n.id} | ${n.title}`).join("\n")}\nIndica el id.`;
    if (hits.length === 1) note = await prisma.note.findFirst({ where: { id: hits[0]!.id, userId, deletedAt: null } });
  }
  if (!note) return "NO_OK code=not_found | No encuentro esa nota.";
  const data: Prisma.NoteUpdateInput = {};
  const newTitle = str(args.newTitle);
  if (newTitle) data.title = clip(newTitle, 300);
  if (typeof args.content === "string") data.content = clip(args.content, 200000);
  if (typeof args.pinned === "boolean") data.pinned = args.pinned;
  if (typeof args.archived === "boolean") data.archived = args.archived;
  if (typeof args.favorite === "boolean") data.favorite = args.favorite;
  if (typeof args.color === "string") data.color = str(args.color) || null;
  if (args.clearProject === true) data.project = { disconnect: true };
  else if (str(args.projectId)) {
    const project = await prisma.project.findFirst({ where: { id: str(args.projectId), userId, deletedAt: null }, select: { id: true } });
    if (!project) return "NO_OK code=invalid_project | Ese proyecto no pertenece a tu cuenta.";
    data.project = { connect: { id: project.id } };
  }
  if (Object.keys(data).length === 0) return `OK id=${note.id} | No había cambios que aplicar a «${note.title}».`;
  const updated = await prisma.note.update({ where: { id: note.id }, data });
  return `OK id=${updated.id} | Nota actualizada: «${updated.title}».`;
}

async function deleteNote(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title) || str(args.query);
  let note = id ? await prisma.note.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!note && q) {
    const hits = await prisma.note.findMany({ where: { userId, deletedAt: null, title: { contains: q } }, take: 6, select: { id: true, title: true } });
    if (hits.length === 0) return `No hay notas que coincidan con «${q}».`;
    if (hits.length > 1) return `Hay varias notas:\n${hits.map((n) => `${n.id} | ${n.title}`).join("\n")}\nDi el id.`;
    note = await prisma.note.findFirst({ where: { id: hits[0]!.id } });
  }
  if (!note) return "Indica el id o el título de la nota.";
  await prisma.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
  return `OK id=${note.id} | Nota a la papelera: «${note.title}».`;
}

async function listEvents(userId: string, tz: string, range: string): Promise<string> {
  const { start } = zonedDayRange(tz, 0);
  const { end } = zonedDayRange(tz, range === "today" ? 0 : 6);
  const events = await prisma.event.findMany({
    where: { userId, deletedAt: null, startAt: { gte: start, lt: end } },
    orderBy: { startAt: "asc" },
    take: 20,
    select: { id: true, title: true, startAt: true },
  });
  if (events.length === 0) return "No hay eventos en ese rango.";
  return events.map((e) => `${e.id} | ${e.title} | ${formatLocal(e.startAt, tz)}`).join("\n");
}

async function createEvent(userId: string, tz: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  const startAt = pickInstant(args, ["startAt", "startDate", "start"], tz);
  if (!title || !startAt) return "Faltan título o inicio del evento.";
  const endAt = pickInstant(args, ["endAt", "endDate", "end"], tz) ?? new Date(startAt.getTime() + 90 * 60 * 1000);
  if (endAt <= startAt) return "La hora final debe ser posterior a la inicial.";
  const projectId = str(args.projectId);
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } });
    if (!project) return "NO_OK code=invalid_project | Ese proyecto no pertenece a tu cuenta.";
  }
  const priority = str(args.priority, "NORMAL");
  const event = await prisma.event.create({
    data: {
      userId,
      title,
      description: str(args.description) ? clip(str(args.description), 5000) : null,
      startAt,
      endAt,
      allDay: args.allDay === true,
      location: str(args.location) || null,
      category: str(args.category) || null,
      color: str(args.color) || null,
      priority: (["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority) ? priority : "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "URGENT",
      projectId: projectId || null,
    },
  });
  if (typeof args.reminderMin === "number" && Number.isFinite(args.reminderMin) && args.reminderMin >= 0) {
    await prisma.reminder.create({ data: { userId, title: event.title, remindAt: new Date(startAt.getTime() - Math.round(args.reminderMin) * 60_000), targetType: "EVENT", targetId: event.id } });
  }
  return `OK id=${event.id} | Evento creado: «${event.title}» ${formatLocal(startAt, tz)}.`;
}

async function updateEvent(userId: string, tz: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title);
  let event = id ? await prisma.event.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!event && q) {
    const hits = await prisma.event.findMany({ where: { userId, deletedAt: null, title: { contains: q } }, take: 6 });
    if (hits.length === 0) return `No hay eventos que coincidan con «${q}».`;
    if (hits.length > 1) return `Hay varios eventos:\n${hits.map((e) => `${e.id} | ${e.title}`).join("\n")}\nDi el id.`;
    event = hits[0]!;
  }
  if (!event) return "Indica el id o el título del evento.";
  const newTitle = str(args.newTitle);
  const startAt = pickInstant(args, ["startAt", "startDate"], tz);
  const endAt = pickInstant(args, ["endAt", "endDate"], tz);
  if ((startAt ?? event.startAt) >= (endAt ?? event.endAt)) return "NO_OK code=invalid_range | La hora final debe ser posterior a la inicial.";
  const data: Prisma.EventUpdateInput = {
    title: newTitle ? clip(newTitle, 300) : undefined,
    description: typeof args.description === "string" ? (str(args.description) ? clip(str(args.description), 5000) : null) : undefined,
    startAt: startAt ?? undefined,
    endAt: endAt ?? undefined,
    allDay: typeof args.allDay === "boolean" ? args.allDay : undefined,
    location: typeof args.location === "string" ? str(args.location) || null : undefined,
    category: typeof args.category === "string" ? str(args.category) || null : undefined,
    color: typeof args.color === "string" ? str(args.color) || null : undefined,
  };
  const priority = str(args.priority);
  if (priority && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) data.priority = priority as "LOW" | "NORMAL" | "HIGH" | "URGENT";
  if (str(args.projectId)) {
    const project = await prisma.project.findFirst({ where: { id: str(args.projectId), userId, deletedAt: null }, select: { id: true } });
    if (!project) return "NO_OK code=invalid_project | Ese proyecto no pertenece a tu cuenta.";
    data.project = { connect: { id: project.id } };
  }
  if (Object.values(data).every((value) => value === undefined)) return `OK id=${event.id} | No había cambios que aplicar a «${event.title}».`;
  const updated = await prisma.event.update({
    where: { id: event.id },
    data,
  });
  return `OK id=${updated.id} | Evento actualizado: «${updated.title}» ${formatLocal(updated.startAt, tz)}.`;
}

async function deleteEvent(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title);
  let event = id ? await prisma.event.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!event && q) {
    const hits = await prisma.event.findMany({ where: { userId, deletedAt: null, title: { contains: q } }, take: 6 });
    if (hits.length === 0) return `No hay eventos que coincidan con «${q}».`;
    if (hits.length > 1) return `Hay varios:\n${hits.map((e) => `${e.id} | ${e.title}`).join("\n")}\nDi el id.`;
    event = hits[0]!;
  }
  if (!event) return "Indica el id o el título del evento.";
  await prisma.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });
  return `OK id=${event.id} | Evento a la papelera: «${event.title}».`;
}

async function createReminder(userId: string, tz: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  const remindAt = pickInstant(args, ["remindAt", "remindDate", "at"], tz);
  if (!title || !remindAt) return "Faltan título o fecha del recordatorio.";
  const rem = await prisma.reminder.create({ data: { userId, title, remindAt, targetType: "NONE" } });
  return `OK id=${rem.id} | Recordatorio: «${title}» ${formatLocal(remindAt, tz)}.`;
}

async function listReminders(userId: string, tz: string, days: number): Promise<string> {
  const n = Math.min(14, Math.max(1, days));
  const until = new Date(Date.now() + n * 86400000);
  const items = await prisma.reminder.findMany({
    where: { userId, remindAt: { gte: new Date(), lte: until } },
    orderBy: { remindAt: "asc" },
    take: 20,
  });
  if (items.length === 0) return "No hay recordatorios próximos.";
  return items.map((r) => `${r.id} | ${r.title ?? "Recordatorio"} | ${formatLocal(r.remindAt, tz)}`).join("\n");
}

async function deleteReminder(userId: string, args: Args): Promise<string> {
  const id = str(args.id);
  const q = str(args.title);
  let rem = id ? await prisma.reminder.findFirst({ where: { id, userId } }) : null;
  if (!rem && q) {
    const hits = await prisma.reminder.findMany({ where: { userId, title: { contains: q } }, take: 6 });
    if (hits.length === 0) return `No hay recordatorios que coincidan con «${q}».`;
    if (hits.length > 1) return `Hay varios:\n${hits.map((r) => `${r.id} | ${r.title}`).join("\n")}\nDi el id.`;
    rem = hits[0]!;
  }
  if (!rem) return "Indica el id o el título del recordatorio.";
  await prisma.reminder.delete({ where: { id: rem.id } });
  return `OK id=${rem.id} | Recordatorio eliminado: «${rem.title ?? ""}».`;
}

async function updateReminder(userId: string, tz: string, args: Args): Promise<string> {
  const id = str(args.id);
  let rem = id ? await prisma.reminder.findFirst({ where: { id, userId } }) : null;
  if (!rem && str(args.title)) {
    const hits = await prisma.reminder.findMany({ where: { userId, title: { contains: str(args.title) } }, take: 6 });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varios recordatorios:\n${hits.map((r) => `${r.id} | ${r.title}`).join("\n")}\nIndica el id.`;
    rem = hits[0] ?? null;
  }
  if (!rem) return "NO_OK code=not_found | No encuentro ese recordatorio.";
  const remindAt = pickInstant(args, ["remindAt", "remindDate", "at"], tz);
  if (pickStr(args, ["remindAt", "remindDate", "at"]) && !remindAt) return "NO_OK code=invalid_date | No entendí la fecha del recordatorio.";
  const updated = await prisma.reminder.update({
    where: { id: rem.id },
    data: {
      title: typeof args.newTitle === "string" ? str(args.newTitle) || null : undefined,
      remindAt: remindAt ?? undefined,
      scheduleDaily: typeof args.scheduleDaily === "boolean" ? args.scheduleDaily : undefined,
    },
  });
  return `OK id=${updated.id} | Recordatorio actualizado: «${updated.title ?? "Recordatorio"}» ${formatLocal(updated.remindAt, tz)}.`;
}

async function findHabit(userId: string, args: Args) {
  const id = str(args.id);
  const q = str(args.name) || str(args.title);
  let habit = id ? await prisma.habit.findFirst({ where: { id, userId } }) : null;
  if (!habit && q) {
    const hits = await prisma.habit.findMany({ where: { userId, name: { contains: q } }, take: 6 });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varios hábitos:\n${hits.map((h) => `${h.id} | ${h.name}`).join("\n")}\nIndica el id.`;
    habit = hits[0] ?? null;
  }
  return habit ?? "NO_OK code=not_found | No encuentro ese hábito.";
}

async function listHabits(userId: string): Promise<string> {
  const habits = await prisma.habit.findMany({ where: { userId }, include: { logs: { where: { done: true }, orderBy: { date: "desc" }, take: 30 } }, orderBy: { createdAt: "asc" } });
  if (habits.length === 0) return "No tienes hábitos.";
  return habits.map((h) => `${h.id} | ${h.name} | ${h.logs.length} registros recientes | días=${h.scheduleDayBits}`).join("\n");
}

async function createHabit(userId: string, args: Args): Promise<string> {
  const name = clip(str(args.name), 120);
  if (!name) return "NO_OK code=missing_name | Indica el nombre del hábito.";
  const habit = await prisma.habit.create({
    data: {
      userId,
      name,
      color: str(args.color) || null,
      icon: str(args.icon) || null,
      scheduleDayBits: typeof args.scheduleDayBits === "number" ? Math.max(0, Math.min(127, Math.round(args.scheduleDayBits))) : 127,
      reminderMinuteOfDay: typeof args.reminderMinuteOfDay === "number" ? Math.max(0, Math.min(1439, Math.round(args.reminderMinuteOfDay))) : null,
    },
  });
  return `OK id=${habit.id} | Hábito creado: «${habit.name}».`;
}

async function updateHabit(userId: string, args: Args): Promise<string> {
  const found = await findHabit(userId, args);
  if (typeof found === "string") return found;
  const data: Prisma.HabitUpdateInput = {};
  if (typeof args.name === "string" && str(args.name)) data.name = clip(str(args.name), 120);
  if (typeof args.color === "string") data.color = str(args.color) || null;
  if (typeof args.icon === "string") data.icon = str(args.icon) || null;
  if (typeof args.scheduleDayBits === "number") data.scheduleDayBits = Math.max(0, Math.min(127, Math.round(args.scheduleDayBits)));
  if (typeof args.reminderMinuteOfDay === "number") data.reminderMinuteOfDay = Math.max(0, Math.min(1439, Math.round(args.reminderMinuteOfDay)));
  if (Object.keys(data).length === 0) return `OK id=${found.id} | No había cambios que aplicar a «${found.name}».`;
  const habit = await prisma.habit.update({ where: { id: found.id }, data });
  return `OK id=${habit.id} | Hábito actualizado: «${habit.name}».`;
}

async function logHabit(userId: string, args: Args): Promise<string> {
  const found = await findHabit(userId, args);
  if (typeof found === "string") return found;
  const date = str(args.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "NO_OK code=invalid_date | Usa una fecha con formato YYYY-MM-DD.";
  const day = new Date(`${date}T12:00:00.000Z`);
  const done = typeof args.done === "boolean" ? args.done : true;
  const existing = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: found.id, date: day } } });
  if (existing) await prisma.habitLog.update({ where: { id: existing.id }, data: { done } });
  else await prisma.habitLog.create({ data: { habitId: found.id, userId, date: day, done } });
  return `OK id=${found.id} | Hábito «${found.name}» ${done ? "marcado" : "desmarcado"} el ${date}.`;
}

async function listGoals(userId: string): Promise<string> {
  const goals = await prisma.goal.findMany({ where: { userId, deletedAt: null }, include: { tasks: { where: { deletedAt: null }, select: { status: true } } }, orderBy: { dueDate: "asc" } });
  if (goals.length === 0) return "No tienes objetivos.";
  return goals.map((g) => {
    const progress = g.manualProgress >= 0 ? g.manualProgress : g.status === "COMPLETED" ? 100 : g.tasks.length ? Math.round(g.tasks.filter((t) => t.status === "COMPLETED").length / g.tasks.length * 100) : 0;
    return `${g.id} | ${g.title} | ${g.status} | ${progress}%`;
  }).join("\n");
}

async function findGoal(userId: string, args: Args) {
  const id = str(args.id);
  const q = str(args.title) || str(args.query);
  let goal = id ? await prisma.goal.findFirst({ where: { id, userId, deletedAt: null } }) : null;
  if (!goal && q) {
    const hits = await prisma.goal.findMany({ where: { userId, deletedAt: null, title: { contains: q } }, take: 6, select: { id: true, title: true } });
    if (hits.length > 1) return `NO_OK code=ambiguous | Hay varios objetivos:\n${hits.map((g) => `${g.id} | ${g.title}`).join("\n")}\nIndica el id.`;
    goal = hits[0] ? await prisma.goal.findFirst({ where: { id: hits[0].id, userId, deletedAt: null } }) : null;
  }
  return goal ?? "NO_OK code=not_found | No encuentro ese objetivo.";
}

async function createGoal(userId: string, tz: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  if (!title) return "NO_OK code=missing_title | Indica el título del objetivo.";
  const dueDate = pickInstant(args, ["dueDate", "dueAt"], tz);
  if (pickStr(args, ["dueDate", "dueAt"]) && !dueDate) return "NO_OK code=invalid_date | No entendí la fecha del objetivo.";
  const status = str(args.status, "PENDING");
  const goal = await prisma.goal.create({
    data: {
      userId,
      title,
      description: str(args.description) ? clip(str(args.description), 5000) : null,
      dueDate,
      manualProgress: typeof args.manualProgress === "number" ? Math.max(0, Math.min(100, Math.round(args.manualProgress))) : -1,
      status: (["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"].includes(status) ? status : "PENDING") as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "POSTPONED" | "CANCELLED",
    },
  });
  return `OK id=${goal.id} | Objetivo creado: «${goal.title}».`;
}

async function updateGoal(userId: string, tz: string, args: Args): Promise<string> {
  const found = await findGoal(userId, args);
  if (typeof found === "string") return found;
  const data: Prisma.GoalUpdateInput = {};
  const title = str(args.newTitle);
  if (title) data.title = clip(title, 300);
  if (typeof args.description === "string") data.description = str(args.description) ? clip(str(args.description), 5000) : null;
  if (typeof args.manualProgress === "number") data.manualProgress = Math.max(0, Math.min(100, Math.round(args.manualProgress)));
  const status = str(args.status);
  if (status && ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"].includes(status)) data.status = status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "POSTPONED" | "CANCELLED";
  if (typeof args.dueDate === "string") {
    const dueDate = parseFlexibleInstant(args.dueDate, tz);
    if (!dueDate) return "NO_OK code=invalid_date | No entendí la fecha del objetivo.";
    data.dueDate = dueDate;
  }
  if (Object.keys(data).length === 0) return `OK id=${found.id} | No había cambios que aplicar a «${found.title}».`;
  const goal = await prisma.goal.update({ where: { id: found.id }, data });
  return `OK id=${goal.id} | Objetivo actualizado: «${goal.title}».`;
}

async function captureInbox(userId: string, args: Args): Promise<string> {
  const content = clip(str(args.content), 2000);
  if (!content) return "NO_OK code=missing_content | Escribe algo para guardar en la bandeja.";
  const item = await prisma.inboxItem.create({ data: { userId, content } });
  return `OK id=${item.id} | Guardado en la bandeja de entrada.`;
}

async function listInbox(userId: string, args: Args): Promise<string> {
  const items = await prisma.inboxItem.findMany({ where: { userId, archived: args.archived === true }, orderBy: { createdAt: "desc" }, take: 50 });
  if (items.length === 0) return "La bandeja está vacía.";
  return items.map((item) => `${item.id} | ${item.content}`).join("\n");
}

async function archiveInbox(userId: string, args: Args): Promise<string> {
  const item = await prisma.inboxItem.findFirst({ where: { id: str(args.id), userId } });
  if (!item) return "NO_OK code=not_found | No encuentro ese elemento de la bandeja.";
  await prisma.inboxItem.update({ where: { id: item.id }, data: { archived: true } });
  return `OK id=${item.id} | Elemento archivado.`;
}

async function convertInbox(userId: string, tz: string, args: Args): Promise<string> {
  const item = await prisma.inboxItem.findFirst({ where: { id: str(args.id), userId } });
  const type = str(args.type);
  if (!item) return "NO_OK code=not_found | No encuentro ese elemento de la bandeja.";
  if (!["TASK", "EVENT", "NOTE"].includes(type)) return "NO_OK code=invalid_type | Elige tarea, evento o nota.";
  const title = clip(str(args.title) || item.content, 300);
  if (type === "TASK") {
    const due = pickInstant(args, ["dueDate", "dueAt"], tz);
    const task = await prisma.task.create({ data: { userId, title, dueDate: due, hasTime: Boolean(due && looksLikeTime(pickStr(args, ["dueDate", "dueAt"]))) } });
    await prisma.inboxItem.update({ where: { id: item.id }, data: { taskId: task.id, archived: true } });
    return `OK id=${task.id} | Elemento convertido en tarea: «${task.title}».`;
  }
  if (type === "NOTE") {
    const note = await prisma.note.create({ data: { userId, title, content: item.content } });
    await prisma.inboxItem.update({ where: { id: item.id }, data: { noteId: note.id, archived: true } });
    return `OK id=${note.id} | Elemento convertido en nota: «${note.title}».`;
  }
  const start = pickInstant(args, ["startAt", "startDate", "start"], tz) ?? new Date();
  const event = await prisma.event.create({ data: { userId, title, startAt: start, endAt: new Date(start.getTime() + 60 * 60 * 1000) } });
  await prisma.inboxItem.update({ where: { id: item.id }, data: { eventId: event.id, archived: true } });
  return `OK id=${event.id} | Elemento convertido en evento: «${event.title}».`;
}

async function listTrash(userId: string): Promise<string> {
  const [tasks, events, notes, projects, goals] = await Promise.all([
    prisma.task.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, title: true } }),
    prisma.event.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, title: true } }),
    prisma.note.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, title: true } }),
    prisma.project.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, name: true } }),
    prisma.goal.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, title: true } }),
  ]);
  const rows = [
    ...tasks.map((x) => `task | ${x.id} | ${x.title}`),
    ...events.map((x) => `event | ${x.id} | ${x.title}`),
    ...notes.map((x) => `note | ${x.id} | ${x.title}`),
    ...projects.map((x) => `project | ${x.id} | ${x.name}`),
    ...goals.map((x) => `goal | ${x.id} | ${x.title}`),
  ];
  return rows.length ? rows.join("\n") : "La papelera está vacía.";
}

async function restoreFromTrash(userId: string, args: Args): Promise<string> {
  const type = str(args.type);
  const id = str(args.id);
  if (!id || !["task", "event", "note", "project", "goal"].includes(type)) return "NO_OK code=invalid_args | Indica tipo e id del elemento de la papelera.";
  const trashType = type as "task" | "event" | "note" | "project" | "goal";
  let count = 0;
  switch (trashType) {
    case "task": count = (await prisma.task.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } })).count; break;
    case "event": count = (await prisma.event.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } })).count; break;
    case "note": count = (await prisma.note.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } })).count; break;
    case "project": count = (await prisma.project.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } })).count; break;
    case "goal": count = (await prisma.goal.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } })).count; break;
    default: {
      const _never: never = trashType;
      return _never;
    }
  }
  return count ? `OK id=${id} | Elemento restaurado de la papelera.` : "NO_OK code=not_found | No encuentro ese elemento en la papelera.";
}

async function startTimer(userId: string, args: Args): Promise<string> {
  let taskId = str(args.taskId);
  if (!taskId && str(args.taskTitle)) {
    const found = await findTask(userId, { title: str(args.taskTitle) });
    if (typeof found === "string") return `NO_OK code=task_not_found | ${found}`;
    taskId = found.id;
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, userId, deletedAt: null }, select: { id: true, title: true } });
    if (!task) return "NO_OK code=invalid_task | No encuentro esa tarea.";
  }
  const projectId = str(args.projectId);
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } });
    if (!project) return "NO_OK code=invalid_project | Ese proyecto no pertenece a tu cuenta.";
  }
  await prisma.timeEntry.updateMany({ where: { userId, running: true }, data: { running: false, endedAt: new Date() } });
  const entry = await prisma.timeEntry.create({ data: { userId, taskId: taskId || null, projectId: projectId || null, startedAt: new Date(), running: true, source: "MANUAL", note: str(args.note) || null } });
  return `OK id=${entry.id} | Temporizador iniciado.`;
}

async function stopTimer(userId: string, args: Args): Promise<string> {
  const entry = await prisma.timeEntry.findFirst({ where: { userId, running: true, ...(str(args.id) ? { id: str(args.id) } : {}) }, orderBy: { startedAt: "desc" } });
  if (!entry) return "NO_OK code=not_found | No hay ningún temporizador en curso.";
  const endedAt = new Date();
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - entry.startedAt.getTime()) / 1000));
  const updated = await prisma.timeEntry.update({ where: { id: entry.id }, data: { running: false, endedAt, durationSec } });
  if (entry.taskId) await prisma.task.update({ where: { id: entry.taskId }, data: { timeSpentMinutes: { increment: Math.ceil(durationSec / 60) } } });
  return `OK id=${updated.id} | Temporizador detenido: ${Math.ceil(durationSec / 60)} minutos.`;
}

async function timeSummary(userId: string): Promise<string> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const [today, week, running] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: todayStart } }, _sum: { durationSec: true } }),
    prisma.timeEntry.aggregate({ where: { userId, startedAt: { gte: weekStart } }, _sum: { durationSec: true } }),
    prisma.timeEntry.findFirst({ where: { userId, running: true }, include: { task: { select: { title: true } } } }),
  ]);
  return `Hoy: ${Math.round((today._sum.durationSec ?? 0) / 60)} minutos\nEsta semana: ${Math.round((week._sum.durationSec ?? 0) / 60)} minutos\nEn curso: ${running?.task?.title ?? (running ? "sin tarea" : "ninguno")}`;
}

function listRadioStations(): string {
  return RADIO_STATIONS.map((station) => `${station.id} | ${station.name} | ${station.note}`).join("\n");
}

function radioControl(args: Args): string {
  const action = str(args.action);
  if (!["play", "pause", "set_station"].includes(action)) {
    return "NO_OK code=invalid_radio_action | Elige reproducir, pausar o cambiar de emisora.";
  }
  if (action === "pause") {
    return "OK id=radio action=pause | Radio pausada.";
  }

  const requested = str(args.stationId) || str(args.stationName) || str(args.station);
  const station = requested ? resolveRadioStation(args) : null;
  if (requested && !station) {
    return `NO_OK code=station_not_found | No encuentro esa emisora. Usa list_radio_stations para ver las disponibles.`;
  }
  if (action === "set_station" && !station) {
    return "NO_OK code=missing_station | Indica qué emisora quieres seleccionar.";
  }
  if (station) {
    return `OK id=radio action=${action} stationId=${station.id} | ${action === "play" ? "Reproduciendo" : "Emisora seleccionada"}: «${station.name}».`;
  }
  return "OK id=radio action=play | Reproduciendo la emisora seleccionada.";
}
