import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import { taskOverdueWhere } from "../lib/dateRange.js";
import { describeNow, localYmd, addDaysYmd, wallToUtc } from "../lib/mascot/time.js";
import {
  aiAvailable,
  aiDueParts,
  askAi,
  asTaskData,
  budgetFor,
  extractStrings,
  cleanDescription,
  cleanTitle,
  DATA_ONLY_RULE,
  extractItems,
  extractJson,
  resolveUserAi,
} from "../lib/ai/assist.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const TITLE_RULE =
  "Devuelve solo el título: una línea, claro y descriptivo, con lo esencial de la tarea, empezando por un verbo cuando tenga sentido, " +
  "máximo 70 caracteres, sin comillas, sin punto final y sin explicaciones.";

const DESCRIPTION_RULE =
  "Reescribe la descripción para que se entienda de un vistazo: lo importante primero, sin repeticiones ni relleno, " +
  "en el mismo idioma. Si es larga o desordenada, resúmela y ordénala en frases cortas o guiones. " +
  "Conserva todos los datos concretos: nombres, correos, teléfonos, cifras, importes, fechas, direcciones y enlaces.";

const taskText = z.object({
  title: z.string().max(300).optional().default(""),
  description: z.string().max(5000).optional().default(""),
}).refine((b) => b.title.trim() || b.description.trim(), { message: "Escribe algo sobre la tarea." });

/** The parsed body `validate` leaves behind, with its defaults applied. */
function body<T>(req: Request): T {
  return (req as Request & { validatedBody: T }).validatedBody;
}

/** Local calendar day + optional HH:MM → instant, or null when the model invented something odd. */
export function aiDueDate(date: unknown, time: unknown, tz: string): { dueDate: Date; hasTime: boolean } | null {
  const parts = aiDueParts(date, time);
  if (!parts) return null;
  const dueDate = wallToUtc(parts.ymd, parts.hm ? `${parts.hm}:00` : "09:00:00", tz);
  return Number.isNaN(dueDate.getTime()) ? null : { dueDate, hasTime: parts.hm !== null };
}

/**
 * Short numbered list the model can refer to. Models copy long ids badly;
 * a number from 1 to n is hard to get wrong and easy to validate.
 */
function numbered<T>(items: T[], describe: (item: T) => Record<string, unknown>): string {
  return JSON.stringify(items.map((item, i) => ({ n: i + 1, ...describe(item) })));
}

function pickByNumber<T>(items: T[], value: unknown): T | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1]! : null;
}

function safeTitle(title: string): string {
  return title.replace(/<\/?\s*tarea\s*>/gi, "");
}

function isWeekday(ymd: string): boolean {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/**
 * Deterministic spread for whatever the model leaves out: most urgent first,
 * `perDay` per working day from tomorrow, on top of what the model placed.
 */
export function spreadOverdue<T extends { id: string; priority: string }>(
  tasks: T[],
  tz: string,
  taken: Map<string, number> = new Map(),
  perDay = 3,
): { task: T; ymd: string }[] {
  const ordered = [...tasks].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2));
  const out: { task: T; ymd: string }[] = [];
  let ymd = addDaysYmd(localYmd(tz), 1);
  for (const task of ordered) {
    while (!isWeekday(ymd) || (taken.get(ymd) ?? 0) >= perDay) ymd = addDaysYmd(ymd, 1);
    taken.set(ymd, (taken.get(ymd) ?? 0) + 1);
    out.push({ task, ymd });
  }
  return out;
}

aiRouter.get("/status", asyncHandler(async (req, res) => {
  res.json({ available: await aiAvailable(req.user!.id) });
}));

aiRouter.use(aiLimiter);

// Token budgets are generous on purpose: reasoning models spend part of
// them thinking before they write the answer.

// ---------- Title for a task just created ----------
aiRouter.post("/tasks/:id/title", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.task as never, req.params.id);
  const current = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id }, select: { title: true, description: true } });
  if (!current.description?.trim()) throw ApiError.badRequest("La tarea no tiene descripción de la que sacar un título.");
  const ai = await resolveUserAi(req.user!.id);
  const reply = await askAi(ai, req.user!.id,
    `Escribes títulos de tareas en español. ${DATA_ONLY_RULE} ` +
    TITLE_RULE,
    asTaskData({ "Título provisional": current.title, "Descripción": current.description }),
    { maxTokens: 500, timeoutMs: 25_000 });
  const title = cleanTitle(reply);
  if (!title) throw ApiError.badRequest("La IA no devolvió un título válido.");
  const task = await prisma.task.update({ where: { id: req.params.id }, data: { title }, select: { id: true, title: true } });
  res.json({ task, previousTitle: current.title });
}));

// ---------- Title for a form that is still being written (nothing saved) ----------
aiRouter.post("/title", validate(taskText), asyncHandler(async (req, res) => {
  const b = body<z.infer<typeof taskText>>(req);
  const ai = await resolveUserAi(req.user!.id);
  const reply = await askAi(ai, req.user!.id,
    `Escribes títulos de tareas en español. ${DATA_ONLY_RULE} ${TITLE_RULE}`,
    asTaskData({ "Título actual": b.title, "Descripción": b.description }),
    { maxTokens: 500, timeoutMs: 25_000 });
  const title = cleanTitle(reply);
  if (!title) throw ApiError.badRequest("La IA no devolvió un título válido.");
  res.json({ title });
}));

// ---------- Rewrite the description ----------
aiRouter.post("/improve-description", validate(taskText), asyncHandler(async (req, res) => {
  const b = body<z.infer<typeof taskText>>(req);
  if (!b.description.trim()) throw ApiError.badRequest("Escribe primero una descripción.");
  const ai = await resolveUserAi(req.user!.id);
  const reply = await askAi(ai, req.user!.id,
    `Mejoras descripciones de tareas en español. ${DATA_ONLY_RULE} ${DESCRIPTION_RULE} ` +
    "Devuelve solo la descripción, sin título, sin comentarios y sin formato de código.",
    asTaskData({ "Título": b.title, "Descripción": b.description }),
    { maxTokens: budgetFor(b.description, 1500, 6000), timeoutMs: 60_000 });
  const description = cleanDescription(reply, b.description);
  if (!description) throw ApiError.badRequest("La IA no devolvió una descripción válida.");
  res.json({ description });
}));

// ---------- Classify: project, tags, priority, date ----------
aiRouter.post("/classify", validate(taskText), asyncHandler(async (req, res) => {
  const b = body<z.infer<typeof taskText>>(req);
  const userId = req.user!.id;
  const [projects, tags] = await Promise.all([
    prisma.project.findMany({ where: { userId, deletedAt: null, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, take: 60 }),
    prisma.tag.findMany({ where: { userId }, select: { id: true, name: true }, take: 80 }),
  ]);
  const ai = await resolveUserAi(userId);
  const now = describeNow(ai.timezone);
  const reply = await askAi(ai, userId,
    `Clasificas tareas. ${DATA_ONLY_RULE} Hoy es ${now.wall} (${now.ymd}, zona ${now.zone}). ` +
    "Responde solo con un objeto JSON: {\"project\": número|null, \"tags\": número[], \"priority\": \"LOW\"|\"NORMAL\"|\"HIGH\"|\"URGENT\"|null, " +
    "\"date\": \"YYYY-MM-DD\"|null, \"time\": \"HH:MM\"|null}. project y tags son los números n de las listas; si nada encaja, null o []. " +
    "Pon fecha u hora solo si el texto las menciona. Prioridad solo si el texto la sugiere.\n" +
    `Proyectos: ${numbered(projects, (p) => ({ name: p.name }))}\nEtiquetas: ${numbered(tags, (t) => ({ name: t.name }))}`,
    asTaskData({ "Título": b.title, "Descripción": b.description }),
    { maxTokens: budgetFor(b.description, 800, 3000), timeoutMs: 30_000 });
  const raw = extractJson(reply) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw ApiError.badRequest("La IA no devolvió sugerencias válidas.");
  const due = aiDueDate(raw.date, raw.time, ai.timezone);
  const project = pickByNumber(projects, raw.project);
  const pickedTags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((n) => pickByNumber(tags, n))
    .filter((t): t is { id: string; name: string } => Boolean(t));
  res.json({
    projectId: project?.id ?? null,
    tagIds: [...new Set(pickedTags.map((t) => t.id))].slice(0, 5),
    priority: PRIORITIES.includes(raw.priority as typeof PRIORITIES[number]) ? raw.priority : null,
    dueDate: due?.dueDate.toISOString() ?? null,
    hasTime: due?.hasTime ?? false,
  });
}));

// ---------- Split into subtasks ----------
aiRouter.post("/subtasks", validate(taskText), asyncHandler(async (req, res) => {
  const b = body<z.infer<typeof taskText>>(req);
  const ai = await resolveUserAi(req.user!.id);
  const reply = await askAi(ai, req.user!.id,
    `Divides tareas en pasos. ${DATA_ONLY_RULE} ` +
    "Responde solo con un objeto JSON {\"subtasks\": string[]} con entre 2 y 8 pasos concretos, en español, " +
    "cada uno de menos de 100 caracteres, en el orden en que se harían.",
    asTaskData({ "Título": b.title, "Descripción": b.description }),
    { maxTokens: budgetFor(b.description, 1200, 4000), timeoutMs: 45_000 });
  const suggestions = cleanSubtasks(extractStrings(reply, "subtasks"));
  if (!suggestions.length) throw ApiError.badRequest("La IA no devolvió subtareas válidas.");
  res.json({ suggestions });
}));

function cleanSubtasks(list: string[], existing: string[] = []): string[] {
  const taken = new Set(existing.map((s) => s.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/^[-*\d.\s]+/, "").trim();
    if (!s || s.length > 120 || /```|<\/?script/i.test(s) || taken.has(s.toLowerCase())) continue;
    taken.add(s.toLowerCase());
    out.push(s);
  }
  return out.slice(0, 8);
}

// ---------- Optimise a saved task (proposal only) ----------
aiRouter.post("/tasks/:id/optimize", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await assertOwned(req, prisma.task as never, req.params.id);
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: req.params.id },
    select: {
      title: true, description: true, priority: true, projectId: true,
      tags: { select: { id: true } },
      subtasks: { select: { title: true } },
    },
  });
  // What the user already chose by hand stays: project and tags are only proposed when empty.
  const wantProject = !task.projectId;
  const wantTags = task.tags.length === 0;
  const [projects, tags] = await Promise.all([
    wantProject ? prisma.project.findMany({ where: { userId, deletedAt: null, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, take: 60 }) : [],
    wantTags ? prisma.tag.findMany({ where: { userId }, select: { id: true, name: true }, take: 80 }) : [],
  ]);
  const ai = await resolveUserAi(userId);
  const description = task.description ?? "";
  const reply = await askAi(ai, userId,
    `Optimizas tareas de una agenda. ${DATA_ONLY_RULE} ` +
    "Responde solo con un objeto JSON: {\"title\": string, \"description\": string, \"subtasks\": string[], " +
    "\"project\": número|null, \"tags\": número[], \"priority\": \"LOW\"|\"NORMAL\"|\"HIGH\"|\"URGENT\"}. " +
    `title: ${TITLE_RULE} description: ${DESCRIPTION_RULE} Si no hay descripción, "". ` +
    "subtasks: entre 2 y 8 pasos concretos de menos de 100 caracteres solo si la tarea tiene varios pasos claros; si no, []. " +
    "No repitas subtareas que ya tenga. priority: según la urgencia e importancia que se deduzca del texto. " +
    (wantProject ? `project: el número n del proyecto que encaje, o null. Proyectos: ${numbered(projects, (p) => ({ name: p.name }))}. ` : "project: null. ") +
    (wantTags ? `tags: números n de las etiquetas que encajen, o []. Etiquetas: ${numbered(tags, (t) => ({ name: t.name }))}.` : "tags: []."),
    asTaskData({
      "Título": task.title,
      "Descripción": description,
      "Subtareas que ya tiene": task.subtasks.map((s) => s.title).join("; "),
    }),
    { maxTokens: budgetFor(description, 2500, 8000), timeoutMs: 75_000 });
  const raw = extractJson(reply) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw ApiError.badRequest("La IA no devolvió una propuesta válida. Prueba de nuevo.");
  const title = typeof raw.title === "string" ? cleanTitle(raw.title) : null;
  const nextDescription = typeof raw.description === "string" && description.trim()
    ? cleanDescription(raw.description, description)
    : null;
  const project = wantProject ? pickByNumber(projects, raw.project) : null;
  const tagIds = wantTags
    ? [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((n) => pickByNumber(tags, n)?.id).filter((id): id is string => Boolean(id)))].slice(0, 5)
    : [];
  const priority = PRIORITIES.includes(raw.priority as typeof PRIORITIES[number]) ? raw.priority as string : null;
  const proposal = {
    title: title && title !== task.title ? title : null,
    description: nextDescription && nextDescription !== description.trim() ? nextDescription : null,
    subtasks: cleanSubtasks(Array.isArray(raw.subtasks) ? raw.subtasks.filter((s): s is string => typeof s === "string") : [], task.subtasks.map((s) => s.title)),
    projectId: project?.id ?? null,
    tagIds,
    priority: priority && priority !== task.priority ? priority : null,
  };
  const empty = !proposal.title && !proposal.description && !proposal.subtasks.length && !proposal.projectId && !proposal.tagIds.length && !proposal.priority;
  res.json({ proposal, empty });
}));

// ---------- Reschedule overdue tasks (proposal only) ----------
aiRouter.post("/reschedule-overdue", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { userId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, ...taskOverdueWhere(now) },
    select: { id: true, title: true, priority: true, dueDate: true, estimateMinutes: true },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    take: 30,
  });
  if (!tasks.length) {
    res.json({ proposals: [] });
    return;
  }
  const ai = await resolveUserAi(userId);
  const today = describeNow(ai.timezone);
  const tomorrow = addDaysYmd(localYmd(ai.timezone), 1);
  const lastDay = addDaysYmd(localYmd(ai.timezone), 60);
  let items: Record<string, unknown>[] = [];
  try {
    const reply = await askAi(ai, userId,
      `Replanificas tareas atrasadas. ${DATA_ONLY_RULE} Hoy es ${today.wall} (${today.ymd}, zona ${today.zone}). ` +
      "Asigna a cada tarea un día laborable desde mañana: las URGENT y HIGH antes, como mucho 3 por día. " +
      `Fechas entre ${tomorrow} y ${lastDay}. La hora la ajusta la agenda a los huecos libres. Responde solo con un objeto JSON ` +
      "{\"proposals\": [{\"n\": número de la tarea, \"date\": \"YYYY-MM-DD\", \"reason\": motivo de menos de 40 caracteres}]}.",
      `<tarea>\n${numbered(tasks, (t) => ({ title: safeTitle(t.title), priority: t.priority, estimateMinutes: t.estimateMinutes }))}\n</tarea>`,
      { maxTokens: 3000, timeoutMs: 45_000, temperature: 0 });
    items = extractItems(reply, "proposals");
  } catch (err) {
    // A provider refusal still leaves the deterministic spread below.
    if (!(err instanceof ApiError)) throw err;
  }
  const days: { task: typeof tasks[number]; ymd: string; reason: string }[] = [];
  const load = new Map<string, number>();
  const chosen = new Set<string>();
  for (const p of items) {
    const task = pickByNumber(tasks, p.n);
    const parts = aiDueParts(p.date, null);
    if (!task || chosen.has(task.id) || !parts) continue;
    if (parts.ymd < tomorrow || parts.ymd > lastDay || (load.get(parts.ymd) ?? 0) >= 3) continue;
    chosen.add(task.id);
    load.set(parts.ymd, (load.get(parts.ymd) ?? 0) + 1);
    days.push({ task, ymd: parts.ymd, reason: typeof p.reason === "string" ? p.reason.slice(0, 80) : "" });
  }
  for (const { task, ymd } of spreadOverdue(tasks.filter((t) => !chosen.has(t.id)), ai.timezone, load)) {
    days.push({ task, ymd, reason: "Reparto automático por prioridad" });
  }
  // Times come from the agenda, not the model: first free slot of the day, never twice the same.
  const from = wallToUtc(tomorrow, "00:00:00", ai.timezone);
  const until = wallToUtc(addDaysYmd(lastDay, 30), "00:00:00", ai.timezone);
  const busy = await busyIntervals(userId, from, until, tasks.map((t) => t.id));
  days.sort((a, b) => a.ymd.localeCompare(b.ymd) || (PRIORITY_RANK[a.task.priority] ?? 2) - (PRIORITY_RANK[b.task.priority] ?? 2));
  const proposals = days.map(({ task, ymd, reason }) => {
    const start = firstFreeSlot(ymd, task.estimateMinutes, busy, ai.timezone);
    return { taskId: task.id, title: task.title, dueDate: start.toISOString(), hasTime: true, reason };
  });
  res.json({ proposals });
}));

type Interval = { start: number; end: number };
const SLOT_MINUTES = 30;
const DAY_START = 9 * 60;
const DAY_END = 19 * 60;

/** Timed tasks and events already in the agenda, leaving out the tasks being moved. */
async function busyIntervals(userId: string, from: Date, until: Date, excludeTaskIds: string[]): Promise<Interval[]> {
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId, deletedAt: null, hasTime: true, status: { notIn: ["COMPLETED", "CANCELLED"] },
        id: { notIn: excludeTaskIds }, dueDate: { gte: from, lt: until },
      },
      select: { dueDate: true, dueEndDate: true, estimateMinutes: true },
      take: 500,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, allDay: false, startAt: { lt: until }, endAt: { gt: from } },
      select: { startAt: true, endAt: true },
      take: 500,
    }),
  ]);
  return [
    ...tasks.map((t) => {
      const start = t.dueDate!.getTime();
      const end = t.dueEndDate && t.dueEndDate.getTime() > start ? t.dueEndDate.getTime() : start + (t.estimateMinutes || 60) * 60_000;
      return { start, end };
    }),
    ...events.map((e) => ({ start: e.startAt.getTime(), end: e.endAt.getTime() })),
  ];
}

/**
 * First free slot of the working day (09:00–19:00) for a task of that length.
 * The chosen slot joins `busy`, so the next task never lands on it. A full day
 * falls back to its last slot rather than moving the task to another day.
 */
export function firstFreeSlot(ymd: string, estimateMinutes: number | null, busy: Interval[], tz: string): Date {
  const length = Math.min(Math.max(estimateMinutes || 60, SLOT_MINUTES), 240) * 60_000;
  let fallback: Date | null = null;
  for (let minute = DAY_START; minute + length / 60_000 <= DAY_END || minute === DAY_START; minute += SLOT_MINUTES) {
    const hm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`;
    const start = wallToUtc(ymd, hm, tz);
    fallback = start;
    const end = start.getTime() + length;
    if (busy.some((b) => b.start < end && b.end > start.getTime())) continue;
    busy.push({ start: start.getTime(), end });
    return start;
  }
  const start = fallback ?? wallToUtc(ymd, "09:00:00", tz);
  busy.push({ start: start.getTime(), end: start.getTime() + length });
  return start;
}

// ---------- Plan the day (read only) ----------
const planSchema = z.object({ date: z.string().regex(YMD, "Fecha no válida") });

aiRouter.post("/plan-day", validate(planSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { date } = body<z.infer<typeof planSchema>>(req);
  const ai = await resolveUserAi(userId);
  const dayEnd = wallToUtc(addDaysYmd(date, 1), "00:00:00", ai.timezone);
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      OR: [{ dueDate: { lt: dayEnd } }, { priority: { in: ["HIGH", "URGENT"] } }],
    },
    select: { id: true, title: true, priority: true, dueDate: true, hasTime: true, estimateMinutes: true },
    orderBy: [{ dueDate: "asc" }],
    take: 40,
  });
  if (!tasks.length) {
    res.json({ summary: "No tienes tareas pendientes para ese día.", order: [] });
    return;
  }
  const now = describeNow(ai.timezone);
  let raw: { summary?: unknown } | null = null;
  let items: Record<string, unknown>[] = [];
  try {
    const reply = await askAi(ai, userId,
      `Organizas el día de trabajo. ${DATA_ONLY_RULE} Ahora es ${now.wall} (zona ${now.zone}); el día a planificar es ${date}. ` +
      "Elige como mucho 8 tareas realistas para ese día y ordénalas: primero las atrasadas y urgentes, las que tienen hora a su hora. " +
      "Responde solo con un objeto JSON {\"summary\": resumen de menos de 160 caracteres, \"order\": [{\"n\": número de la tarea, \"reason\": motivo de menos de 40 caracteres}]}.",
      `<tarea>\n${numbered(tasks, (t) => ({ title: safeTitle(t.title), priority: t.priority, due: t.dueDate?.toISOString() ?? null, hasTime: t.hasTime, estimateMinutes: t.estimateMinutes }))}\n</tarea>`,
      { maxTokens: 2000, timeoutMs: 45_000 });
    raw = extractJson(reply) as { summary?: unknown } | null;
    items = extractItems(reply, "order");
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const seen = new Set<string>();
  let order = items.flatMap((o) => {
    const t = pickByNumber(tasks, o.n);
    if (!t || seen.has(t.id)) return [];
    seen.add(t.id);
    return [{ taskId: t.id, title: t.title, priority: t.priority, reason: typeof o.reason === "string" ? o.reason.slice(0, 80) : "" }];
  }).slice(0, 8);
  let summary = typeof raw?.summary === "string" ? raw.summary.slice(0, 300) : "";
  if (!order.length) {
    // The same rule the prompt asks for, applied here when the model gives nothing usable.
    const dayStart = wallToUtc(date, "00:00:00", ai.timezone).getTime();
    const late = (t: { dueDate: Date | null }) => (t.dueDate && t.dueDate.getTime() < dayStart ? 0 : 1);
    order = [...tasks]
      .sort((a, b) => late(a) - late(b)
        || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
        || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
      .slice(0, 6)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        priority: t.priority,
        reason: late(t) === 0 ? "Atrasada" : t.priority === "URGENT" || t.priority === "HIGH" ? "Prioridad alta" : "Vence ese día",
      }));
    summary = "Orden sugerido por atrasos, prioridad y hora.";
  }
  res.json({ summary, order });
}));
