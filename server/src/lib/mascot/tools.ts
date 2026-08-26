import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { webSearch as webSearch } from "./search.js";
import { formatLocal as formatLocal, parseFlexibleInstant as parseFlexibleInstant, zonedDayRange as zonedDayRange } from "./time.js";
import { weatherLookup, type WeatherKind } from "./weather.js";

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
  spec("list_tasks", "Lista tareas. when: today | tomorrow | overdue | open.", {
    when: { type: "string", enum: ["today", "tomorrow", "overdue", "open"] },
    query: { type: "string" },
    projectName: { type: "string" },
  }, ["when"]),
  spec("create_task", "Crea una tarea. dueDate/dueAt: ISO, 'hoy' o 'mañana'. projectId o projectName opcional.", {
    title: { type: "string" },
    dueAt: { type: "string" },
    dueDate: { type: "string" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    projectId: { type: "string" },
    projectName: { type: "string" },
  }, ["title"]),
  spec("complete_task", "Tacha una tarea por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("cancel_task", "Cancela una tarea por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("delete_task", "Envía una tarea a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("update_task", "Cambia título, fecha, prioridad o proyecto.", {
    id: { type: "string" },
    title: { type: "string" },
    newTitle: { type: "string" },
    dueAt: { type: "string" },
    dueDate: { type: "string" },
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
    projectId: { type: "string" },
    projectName: { type: "string" },
  }),
  spec("list_projects", "Lista proyectos (id, nombre, estado).", {}),
  spec("create_project", "Crea un proyecto.", { name: { type: "string" }, color: { type: "string" } }, ["name"]),
  spec("list_notes", "Lista notas. query filtra por título.", { query: { type: "string" } }),
  spec("create_note", "Crea una nota.", { title: { type: "string" }, content: { type: "string" } }, ["title"]),
  spec("delete_note", "Envía una nota a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("list_events", "Lista eventos. range: today | week.", { range: { type: "string", enum: ["today", "week"] } }),
  spec("create_event", "Crea un evento. startAt ISO o 'hoy 18:00'.", {
    title: { type: "string" },
    startAt: { type: "string" },
    endAt: { type: "string" },
  }, ["title", "startAt"]),
  spec("update_event", "Cambia título o fechas de un evento.", {
    id: { type: "string" },
    title: { type: "string" },
    newTitle: { type: "string" },
    startAt: { type: "string" },
    endAt: { type: "string" },
  }),
  spec("delete_event", "Envía un evento a la papelera por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("create_reminder", "Crea un recordatorio. remindAt ISO o 'mañana 21:00'.", {
    title: { type: "string" },
    remindAt: { type: "string" },
    remindDate: { type: "string" },
  }, ["title"]),
  spec("list_reminders", "Lista recordatorios próximos. days 1-14.", { days: { type: "number" } }),
  spec("delete_reminder", "Borra un recordatorio por id o título.", { id: { type: "string" }, title: { type: "string" } }),
  spec("web_search", "Solo recetas/menús, ejercicio básico o datos prácticos de una tarea (horario de un comercio, farmacia…). Nunca noticias, código ni temas ajenos.", { query: { type: "string" } }, ["query"]),
  spec("weather_lookup", "Clima y temperatura (Open-Meteo). place vacío = ciudad de la zona horaria. kind: now | today | tomorrow | week.", {
    place: { type: "string" },
    kind: { type: "string", enum: ["now", "today", "tomorrow", "week"] },
  }),
  spec("memory_get", "Lee los datos que recuerdas sobre el usuario (gustos, preferencias, nombres, horarios fijos).", {}),
  spec("memory_set", "Guarda un dato que el usuario quiera que recuerdes. key: etiqueta corta (p. ej. 'preferencia', 'nombre_frecuente', 'horario'), value: el dato. También para actualizar uno existente.", {
    key: { type: "string" },
    value: { type: "string" },
  }, ["key", "value"]),
];

type Args = Record<string, unknown>;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
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
    try { return JSON.parse(raw || "{}") as Args; } catch { return {}; }
  }
  return {};
}

export async function runMascotTool(userId: string, timezone: string, name: string, args: Args): Promise<string> {
  const tz = timezone || "Europe/Madrid";
  try {
    switch (name) {
      case "list_tasks":
        return await listTasks(userId, tz, str(args.when, "open"), str(args.query), str(args.projectName));
      case "create_task":
        return await createTask(userId, tz, args);
      case "complete_task":
        return await setTaskStatus(userId, tz, args, "COMPLETED");
      case "cancel_task":
        return await setTaskStatus(userId, tz, args, "CANCELLED");
      case "delete_task":
        return await deleteTask(userId, tz, args);
      case "update_task":
        return await updateTask(userId, tz, args);
      case "list_projects":
        return await listProjects(userId);
      case "create_project":
        return await createProject(userId, args);
      case "list_notes":
        return await listNotes(userId, str(args.query));
      case "create_note":
        return await createNote(userId, args);
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
      case "web_search":
        return await webSearch(str(args.query), tz);
      case "weather_lookup": {
        const kindRaw = str(args.kind, "now");
        const kind = (["now", "today", "tomorrow", "week"].includes(kindRaw) ? kindRaw : "now") as WeatherKind;
        const place = str(args.place) || str(args.city) || str(args.location);
        return await weatherLookup(place, kind, tz);
      }
      case "memory_get": {
        const rows = await prisma.mascotMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 30 });
        if (!rows.length) return "No recuerdo nada tuyo todavía.";
        return rows.map((r) => `${r.key}: ${r.value}`).join("\n");
      }
      case "memory_set": {
        const key = clip(str(args.key), 120);
        const value = clip(str(args.value), 2000);
        if (!key || !value) return "Necesito una clave y un valor.";
        await prisma.mascotMemory.upsert({
          where: { userId_key: { userId, key } },
          update: { value },
          create: { userId, key, value },
        });
        return `OK id=${key}`;
      }
      default:
        return `Herramienta desconocida: ${name}`;
    }
  } catch (err) {
    logger.warn({ err, name }, "mascot tool failed");
    return `Error al ejecutar ${name}: ${err instanceof Error ? err.message : "fallo interno"}.`;
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

async function listTasks(userId: string, tz: string, when: string, query: string, projectName: string): Promise<string> {
  const where: Prisma.TaskWhereInput = { userId, deletedAt: null, status: { not: "COMPLETED" } };
  if (when === "today") {
    const { start, end } = zonedDayRange(tz, 0);
    where.dueDate = { gte: start, lt: end };
  } else if (when === "tomorrow") {
    const { start, end } = zonedDayRange(tz, 1);
    where.dueDate = { gte: start, lt: end };
  } else if (when === "overdue") {
    const { start } = zonedDayRange(tz, 0);
    where.dueDate = { lt: start };
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
    select: { id: true, title: true, dueDate: true, status: true, priority: true },
  });
  if (tasks.length === 0) return when === "tomorrow" ? "No hay tareas para mañana." : "No hay tareas en ese filtro.";
  return tasks.map((t) => `${t.id} | ${t.title} | ${t.status} | ${t.dueDate ? formatLocal(t.dueDate, tz) : "sin fecha"}`).join("\n");
}

async function createTask(userId: string, tz: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300);
  if (!title) return "Falta el título de la tarea.";
  const dueRaw = pickStr(args, ["dueAt", "dueDate", "due"]);
  const due = instantFromDueAlias(args, tz);
  if (dueRaw && !due) return "No entendí la fecha. Usa ISO o 'hoy'/'mañana'.";
  const prio = str(args.priority, "NORMAL");
  const priority = (["LOW", "NORMAL", "HIGH", "URGENT"].includes(prio) ? prio : "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "URGENT";
  const proj = await resolveProject(userId, args);
  if (!proj.ok) return proj.msg;
  const maxOrder = await prisma.task.aggregate({
    where: { userId, deletedAt: null, projectId: proj.id },
    _max: { sortOrder: true },
  });
  const task = await prisma.task.create({
    data: {
      userId,
      title,
      dueDate: due,
      hasTime: Boolean(dueRaw && looksLikeTime(dueRaw)),
      priority,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      projectId: proj.id,
    },
  });
  const when = task.dueDate ? ` para ${formatLocal(task.dueDate, tz)}` : " (sin fecha)";
  return `OK id=${task.id} | Tarea creada: «${task.title}»${when}.`;
}

async function setTaskStatus(userId: string, tz: string, args: Args, status: "COMPLETED" | "CANCELLED"): Promise<string> {
  const found = await findTask(userId, args);
  if (typeof found === "string") return found;
  const now = new Date();
  const task = await prisma.task.update({
    where: { id: found.id },
    data: { status, completedAt: status === "COMPLETED" ? now : null, statusChangedAt: now },
  });
  const verb = status === "COMPLETED" ? "Tachada" : "Cancelada";
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
  const dueRaw = pickStr(args, ["dueAt", "dueDate", "due"]);
  if (dueRaw) {
    const due = parseFlexibleInstant(dueRaw, tz);
    if (!due) return "No entendí la fecha nueva.";
    data.dueDate = due;
    data.hasTime = looksLikeTime(dueRaw);
  }
  const prio = str(args.priority);
  if (prio && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(prio)) data.priority = prio as "LOW" | "NORMAL" | "HIGH" | "URGENT";
  const proj = await resolveProject(userId, args);
  if (!proj.ok) return proj.msg;
  if (proj.id) data.project = { connect: { id: proj.id } };
  const task = await prisma.task.update({ where: { id: found.id }, data });
  return `OK id=${task.id} | Tarea actualizada: «${task.title}»${task.dueDate ? ` · ${formatLocal(task.dueDate, tz)}` : ""}.`;
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
  const project = await prisma.project.create({ data: { userId, name, color: str(args.color) || null } });
  return `OK id=${project.id} | Proyecto creado: «${project.name}».`;
}

async function listNotes(userId: string, query: string): Promise<string> {
  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null, ...(query ? { title: { contains: query } } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 20,
    select: { id: true, title: true },
  });
  if (notes.length === 0) return "No hay notas.";
  return notes.map((n) => `${n.id} | ${n.title}`).join("\n");
}

async function createNote(userId: string, args: Args): Promise<string> {
  const title = clip(str(args.title), 300) || "Sin título";
  const note = await prisma.note.create({ data: { userId, title, content: str(args.content) || null } });
  return `OK id=${note.id} | Nota creada: «${note.title}».`;
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
  const event = await prisma.event.create({ data: { userId, title, startAt, endAt } });
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
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { title: newTitle ? clip(newTitle, 300) : undefined, startAt: startAt ?? undefined, endAt: endAt ?? undefined },
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
