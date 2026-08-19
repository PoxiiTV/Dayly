/**
 * Dayly import/export codecs (JSON / CSV / ICS).
 * Pure functions: no Prisma, no user identity. Callers attach userId on persist.
 */

export type TransferFormat = "json" | "csv" | "ics";

const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export interface TransferTask {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  hasTime?: boolean;
  priority?: Priority;
  status?: TaskStatus;
  notes?: string | null;
  color?: string | null;
  estimateMinutes?: number | null;
}

export interface TransferEvent {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  location?: string | null;
  color?: string | null;
  status?: TaskStatus;
}

export interface TransferNote {
  title: string;
  content?: string | null;
  pinned?: boolean;
  favorite?: boolean;
  color?: string | null;
}

export interface TransferBundle {
  version: 1;
  exportedAt: string;
  tasks: TransferTask[];
  events: TransferEvent[];
  notes: TransferNote[];
}

export const MAX_TRANSFER_CHARS = 800_000;
export const MAX_TRANSFER_ITEMS = 2_000;

export function emptyBundle(exportedAt = new Date().toISOString()): TransferBundle {
  return { version: 1, exportedAt, tasks: [], events: [], notes: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function optStr(v: unknown, max: number): string | null {
  const s = str(v, max).trim();
  return s ? s : null;
}

function asStatus(v: unknown): TaskStatus | undefined {
  const s = String(v ?? "").toUpperCase();
  return (STATUSES as readonly string[]).includes(s) ? (s as TaskStatus) : undefined;
}

function asPriority(v: unknown): Priority | undefined {
  const s = String(v ?? "").toUpperCase();
  return (PRIORITIES as readonly string[]).includes(s) ? (s as Priority) : undefined;
}

function asIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === "true" || v === "1" || v === 1) return true;
  if (v === false || v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

function asInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.trunc(n);
}

function sanitizeTask(raw: unknown): TransferTask | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title, 300).trim();
  if (!title) return null;
  return {
    title,
    description: optStr(raw.description, 5000),
    dueDate: asIso(raw.dueDate),
    hasTime: asBool(raw.hasTime) ?? false,
    priority: asPriority(raw.priority) ?? "NORMAL",
    status: asStatus(raw.status) ?? "PENDING",
    notes: optStr(raw.notes, 5000),
    color: optStr(raw.color, 20),
    estimateMinutes: asInt(raw.estimateMinutes),
  };
}

function sanitizeEvent(raw: unknown): TransferEvent | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title, 300).trim();
  const startAt = asIso(raw.startAt);
  let endAt = asIso(raw.endAt);
  if (!title || !startAt) return null;
  if (!endAt) endAt = new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
  return {
    title,
    description: optStr(raw.description, 5000),
    startAt,
    endAt,
    allDay: asBool(raw.allDay) ?? false,
    location: optStr(raw.location, 300),
    color: optStr(raw.color, 20),
    status: asStatus(raw.status) ?? "PENDING",
  };
}

function sanitizeNote(raw: unknown): TransferNote | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title ?? "Sin título", 300).trim() || "Sin título";
  return {
    title,
    content: optStr(raw.content, 200000),
    pinned: asBool(raw.pinned) ?? false,
    favorite: asBool(raw.favorite) ?? false,
    color: optStr(raw.color, 20),
  };
}

function capItems(bundle: TransferBundle): TransferBundle {
  const total = bundle.tasks.length + bundle.events.length + bundle.notes.length;
  if (total <= MAX_TRANSFER_ITEMS) return bundle;
  throw new Error(`Demasiados elementos (máximo ${MAX_TRANSFER_ITEMS}).`);
}

function assertTextSize(text: string) {
  if (text.length > MAX_TRANSFER_CHARS) {
    throw new Error("El archivo es demasiado grande (máximo 800 KB).");
  }
}

export function serializeJson(bundle: TransferBundle): string {
  const clean: TransferBundle = {
    version: 1,
    exportedAt: bundle.exportedAt || new Date().toISOString(),
    tasks: bundle.tasks.map((t) => sanitizeTask(t)).filter((x): x is TransferTask => !!x),
    events: bundle.events.map((e) => sanitizeEvent(e)).filter((x): x is TransferEvent => !!x),
    notes: bundle.notes.map((n) => sanitizeNote(n)).filter((x): x is TransferNote => !!x),
  };
  return JSON.stringify(clean, null, 2);
}

export function parseJson(text: string): TransferBundle {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSON no válido.");
  }
  if (!isRecord(data) || data.version !== 1) {
    throw new Error("No es un archivo Dayly (falta version: 1).");
  }
  if (!("tasks" in data) || !("events" in data) || !("notes" in data)) {
    throw new Error("No es un archivo Dayly (faltan tasks/events/notes).");
  }
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const events = Array.isArray(data.events) ? data.events : [];
  const notes = Array.isArray(data.notes) ? data.notes : [];
  return capItems({
    version: 1,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    tasks: tasks.map(sanitizeTask).filter((x): x is TransferTask => !!x),
    events: events.map(sanitizeEvent).filter((x): x is TransferEvent => !!x),
    notes: notes.map(sanitizeNote).filter((x): x is TransferNote => !!x),
  });
}

const CSV_COLS = [
  "kind",
  "title",
  "description",
  "startAt",
  "endAt",
  "dueDate",
  "allDay",
  "hasTime",
  "location",
  "priority",
  "status",
  "content",
  "color",
  "pinned",
  "favorite",
] as const;

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let cur = "";
  let inQ = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (cur.trim()) records.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) records.push(cur);
  return records;
}

export function serializeCsv(bundle: TransferBundle): string {
  const rows: string[] = [CSV_COLS.join(",")];
  for (const t of bundle.tasks) {
    const s = sanitizeTask(t);
    if (!s) continue;
    rows.push(
      [
        "task",
        s.title,
        s.description ?? "",
        "",
        "",
        s.dueDate ?? "",
        "",
        s.hasTime ? "true" : "false",
        "",
        s.priority ?? "",
        s.status ?? "",
        s.notes ?? "",
        s.color ?? "",
        "",
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  for (const e of bundle.events) {
    const s = sanitizeEvent(e);
    if (!s) continue;
    rows.push(
      [
        "event",
        s.title,
        s.description ?? "",
        s.startAt,
        s.endAt,
        "",
        s.allDay ? "true" : "false",
        "",
        s.location ?? "",
        "",
        s.status ?? "",
        "",
        s.color ?? "",
        "",
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  for (const n of bundle.notes) {
    const s = sanitizeNote(n);
    if (!s) continue;
    rows.push(
      [
        "note",
        s.title,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        s.content ?? "",
        s.color ?? "",
        s.pinned ? "true" : "false",
        s.favorite ? "true" : "false",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return rows.join("\n") + "\n";
}

export function parseCsv(text: string): TransferBundle {
  const records = splitCsvRecords(text);
  if (records.length < 2) throw new Error("CSV vacío o sin filas de datos.");
  const header = parseCsvLine(records[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const kindI = idx("kind");
  const titleI = idx("title");
  if (kindI < 0 || titleI < 0) throw new Error("CSV no válido: falta la columna kind o title.");
  const bundle = emptyBundle();
  for (const rec of records.slice(1)) {
    const cols = parseCsvLine(rec);
    const cell = (name: string) => {
      const i = idx(name);
      return i >= 0 ? (cols[i] ?? "") : "";
    };
    const kind = cell("kind").trim().toLowerCase();
    if (kind === "task") {
      const t = sanitizeTask({
        title: cell("title"),
        description: cell("description"),
        dueDate: cell("dueDate"),
        hasTime: cell("hasTime"),
        priority: cell("priority"),
        status: cell("status"),
        notes: cell("content"),
        color: cell("color"),
      });
      if (t) bundle.tasks.push(t);
    } else if (kind === "event") {
      const e = sanitizeEvent({
        title: cell("title"),
        description: cell("description"),
        startAt: cell("startAt"),
        endAt: cell("endAt"),
        allDay: cell("allDay"),
        location: cell("location"),
        status: cell("status"),
        color: cell("color"),
      });
      if (e) bundle.events.push(e);
    } else if (kind === "note") {
      const n = sanitizeNote({
        title: cell("title"),
        content: cell("content") || cell("description"),
        color: cell("color"),
        pinned: cell("pinned"),
        favorite: cell("favorite"),
      });
      if (n) bundle.notes.push(n);
    }
  }
  return capItems(bundle);
}

function icsEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\n", "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}

function icsUnescape(value: string): string {
  return value.replaceAll("\\n", "\n").replaceAll("\\N", "\n").replaceAll("\\,", ",").replaceAll("\\;", ";").replaceAll("\\\\", "\\");
}

function foldIcs(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function icsDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `;VALUE=DATE:${y}${m}${day}`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function parseIcsDate(raw: string): string | null {
  const v = raw.trim();
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return asIso(v);
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0)).toISOString();
  if (z === "Z") return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).toISOString();
}

function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else lines.push(line);
  }
  return lines.filter((l) => l.length > 0);
}

function parseIcsProps(block: string[]): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of block) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(";")[0].toUpperCase();
    props[name] = value;
  }
  return props;
}

function splitIcsBlocks(lines: string[], name: string): string[][] {
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  const begin = `BEGIN:${name}`;
  const end = `END:${name}`;
  for (const line of lines) {
    const u = line.toUpperCase();
    if (u === begin) {
      cur = [];
      continue;
    }
    if (u === end) {
      if (cur) blocks.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return blocks;
}

function todoStatus(ics: string | undefined): TaskStatus {
  const s = (ics ?? "").toUpperCase();
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "IN-PROCESS") return "IN_PROGRESS";
  if (s === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function icsStatus(status: TaskStatus | undefined): string {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "IN_PROGRESS") return "IN-PROCESS";
  if (status === "CANCELLED") return "CANCELLED";
  return "NEEDS-ACTION";
}

export function serializeIcs(bundle: TransferBundle): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DAYLY//Agenda//ES", "CALSCALE:GREGORIAN"];
  let n = 0;
  const uid = (kind: string) => `dayly-${kind}-${++n}@dayly.app`;
  const stamp = icsDate(new Date().toISOString(), false);

  for (const ev of bundle.events) {
    const s = sanitizeEvent(ev);
    if (!s) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid("event")}`);
    lines.push(`DTSTAMP${stamp}`);
    lines.push(`DTSTART${icsDate(s.startAt, !!s.allDay)}`);
    lines.push(`DTEND${icsDate(s.endAt, !!s.allDay)}`);
    lines.push(`SUMMARY:${icsEscape(s.title)}`);
    if (s.description) lines.push(`DESCRIPTION:${icsEscape(s.description)}`);
    if (s.location) lines.push(`LOCATION:${icsEscape(s.location)}`);
    lines.push("END:VEVENT");
  }
  for (const t of bundle.tasks) {
    const s = sanitizeTask(t);
    if (!s) continue;
    lines.push("BEGIN:VTODO");
    lines.push(`UID:${uid("task")}`);
    lines.push(`DTSTAMP${stamp}`);
    lines.push(`SUMMARY:${icsEscape(s.title)}`);
    if (s.description) lines.push(`DESCRIPTION:${icsEscape(s.description)}`);
    if (s.dueDate) lines.push(`DUE${icsDate(s.dueDate, !s.hasTime)}`);
    lines.push(`STATUS:${icsStatus(s.status)}`);
    lines.push("END:VTODO");
  }
  for (const note of bundle.notes) {
    const s = sanitizeNote(note);
    if (!s) continue;
    lines.push("BEGIN:VJOURNAL");
    lines.push(`UID:${uid("note")}`);
    lines.push(`DTSTAMP${stamp}`);
    lines.push(`SUMMARY:${icsEscape(s.title)}`);
    if (s.content) lines.push(`DESCRIPTION:${icsEscape(s.content)}`);
    lines.push("END:VJOURNAL");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}

export function parseIcs(text: string): TransferBundle {
  const lines = unfoldIcs(text);
  const bundle = emptyBundle();
  for (const block of splitIcsBlocks(lines, "VEVENT")) {
    const p = parseIcsProps(block);
    const ev = sanitizeEvent({
      title: icsUnescape(p.SUMMARY ?? ""),
      description: p.DESCRIPTION ? icsUnescape(p.DESCRIPTION) : null,
      startAt: parseIcsDate(p.DTSTART ?? ""),
      endAt: parseIcsDate(p.DTEND ?? p.DTSTART ?? ""),
      location: p.LOCATION ? icsUnescape(p.LOCATION) : null,
      allDay: (p.DTSTART ?? "").length === 8,
    });
    if (ev) bundle.events.push(ev);
  }
  for (const block of splitIcsBlocks(lines, "VTODO")) {
    const p = parseIcsProps(block);
    const t = sanitizeTask({
      title: icsUnescape(p.SUMMARY ?? ""),
      description: p.DESCRIPTION ? icsUnescape(p.DESCRIPTION) : null,
      dueDate: parseIcsDate(p.DUE ?? p.DTSTART ?? ""),
      hasTime: (p.DUE ?? "").includes("T"),
      status: todoStatus(p.STATUS),
    });
    if (t) bundle.tasks.push(t);
  }
  for (const block of splitIcsBlocks(lines, "VJOURNAL")) {
    const p = parseIcsProps(block);
    const n = sanitizeNote({
      title: icsUnescape(p.SUMMARY ?? "Sin título"),
      content: p.DESCRIPTION ? icsUnescape(p.DESCRIPTION) : null,
    });
    if (n) bundle.notes.push(n);
  }
  return capItems(bundle);
}

export function detectFormat(text: string): TransferFormat {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (t.startsWith("{")) return "json";
  if (/^BEGIN:VCALENDAR/i.test(t)) return "ics";
  if (/^kind\s*,/i.test(t)) return "csv";
  throw new Error("No se reconoce el formato. Usa JSON, CSV o ICS.");
}

export function serializeTransfer(bundle: TransferBundle, format: TransferFormat): string {
  if (format === "json") return serializeJson(bundle);
  if (format === "csv") return serializeCsv(bundle);
  return serializeIcs(bundle);
}

export function parseTransfer(text: string, format: TransferFormat | "auto" = "auto"): TransferBundle {
  const raw = text ?? "";
  if (!raw.trim()) throw new Error("El archivo está vacío.");
  assertTextSize(raw);
  const fmt = format === "auto" ? detectFormat(raw) : format;
  if (fmt === "json") return parseJson(raw);
  if (fmt === "csv") return parseCsv(raw);
  return parseIcs(raw);
}
