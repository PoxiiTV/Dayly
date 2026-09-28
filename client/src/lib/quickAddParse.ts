/** Natural-language parse for Quick Add and Ctrl+K. Spanish-first, local timezone. */

export type QuickKind = "task" | "event" | "note" | "project" | "reminder";
export type QuickPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type QuickFreq = "" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface QuickAddParse {
  kind: QuickKind;
  title: string;
  start: Date | null;
  end: Date | null;
  hasTime: boolean;
  allDay: boolean;
  priority: QuickPriority;
  freq: QuickFreq;
  hint: string;
  invalidDate: boolean;
  invalidTime: boolean;
}

const KIND_PREFIX: [RegExp, QuickKind][] = [
  [/^\s*(?:recu[eé]rdame|recordatorio|reminder)\b[:\s]*/i, "reminder"],
  [/^\s*(?:evento|event|reuni[oó]n|cita|meeting)\b[:\s]*/i, "event"],
  [/^\s*(?:nota|note)\b[:\s]*/i, "note"],
  [/^\s*(?:proyecto|project)\b[:\s]*/i, "project"],
  [/^\s*(?:tarea|task)\b[:\s]*/i, "task"],
];

const KIND_HINT: [RegExp, QuickKind][] = [
  [/\b(reuni[oó]n|cita|meeting|evento)\b/i, "event"],
  [/\b(recordatorio|recu[eé]rdame)\b/i, "reminder"],
];

const WEEKDAYS: { re: RegExp; day: number }[] = [
  { re: /\b(?:el\s+)?domingos?\b/i, day: 0 },
  { re: /\b(?:el\s+)?lunes\b/i, day: 1 },
  { re: /\b(?:el\s+)?martes\b/i, day: 2 },
  { re: /\b(?:el\s+)?mi[eé]rcoles\b/i, day: 3 },
  { re: /\b(?:el\s+)?jueves\b/i, day: 4 },
  { re: /\b(?:el\s+)?viernes\b/i, day: 5 },
  { re: /\b(?:el\s+)?s[aá]bados?\b/i, day: 6 },
];

const KIND_LABEL: Record<QuickKind, string> = {
  task: "tarea",
  event: "evento",
  note: "nota",
  project: "proyecto",
  reminder: "recordatorio",
};

export function parseQuickAdd(input: string, now = new Date()): QuickAddParse {
  let rest = input.trim();
  let kind: QuickKind = "task";
  for (const [re, k] of KIND_PREFIX) {
    if (re.test(rest)) {
      kind = k;
      rest = rest.replace(re, "").trim();
      break;
    }
  }
  if (kind === "task") {
    for (const [re, k] of KIND_HINT) {
      if (re.test(rest)) { kind = k; break; }
    }
  }

  let priority: QuickPriority = "NORMAL";
  if (/\b(urgente|urgent[e]?|!!!)\b/i.test(rest) || rest.includes("!")) {
    priority = "URGENT";
    rest = rest.replace(/\b(urgente|urgent[e]?)\b/gi, " ").replace(/!+/g, " ");
  } else if (/\b(prioridad\s+)?alta\b/i.test(rest)) {
    priority = "HIGH";
    rest = rest.replace(/\b(prioridad\s+)?alta\b/gi, " ");
  } else if (/\b(prioridad\s+)?baja\b/i.test(rest)) {
    priority = "LOW";
    rest = rest.replace(/\b(prioridad\s+)?baja\b/gi, " ");
  }

  let freq: QuickFreq = "";
  if (/\b(cada\s+d[ií]a|diario|diaria|todos\s+los\s+d[ií]as)\b/i.test(rest)) {
    freq = "DAILY";
    rest = rest.replace(/\b(cada\s+d[ií]a|diario|diaria|todos\s+los\s+d[ií]as)\b/gi, " ");
  } else if (/\b(cada\s+semana|semanal|semanalmente)\b/i.test(rest)) {
    freq = "WEEKLY";
    rest = rest.replace(/\b(cada\s+semana|semanal|semanalmente)\b/gi, " ");
  } else if (/\b(cada\s+mes|mensual|mensualmente)\b/i.test(rest)) {
    freq = "MONTHLY";
    rest = rest.replace(/\b(cada\s+mes|mensual|mensualmente)\b/gi, " ");
  }

  let allDay = false;
  if (/\b(todo\s+el\s+d[ií]a|all\s*day)\b/i.test(rest)) {
    allDay = true;
    rest = rest.replace(/\b(todo\s+el\s+d[ií]a|all\s*day)\b/gi, " ");
  }

  const dateHit = takeDate(rest, now);
  rest = dateHit.rest;
  const timeHit = takeTime(rest);
  rest = timeHit.rest;

  let durationMin = 60;
  const dur = rest.match(/\bdurante\s+(\d+)\s*(h(?:oras?)?|min(?:utos?)?)\b/i);
  if (dur) {
    const n = Number(dur[1]);
    durationMin = /h/i.test(dur[2]) ? n * 60 : n;
    rest = rest.replace(dur[0], " ");
  }

  const hasTime = timeHit.minutes != null && !allDay;
  let start: Date | null = null;
  let end: Date | null = null;
  if (dateHit.day || hasTime) {
    start = new Date(dateHit.day ?? startOfLocalDay(now));
    if (hasTime && timeHit.minutes != null) {
      start.setHours(Math.floor(timeHit.minutes / 60), timeHit.minutes % 60, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
      if (!hasTime) allDay = kind === "event";
    }
    end = new Date(start.getTime() + durationMin * 60_000);
  }

  const cleaned = rest.replace(/\s+/g, " ").trim();
  const title = cleaned || ({
    task: "Tarea", event: "Evento", note: "Nota", project: "Proyecto", reminder: "Recordatorio",
  }[kind]);
  const bits: string[] = [KIND_LABEL[kind]];
  if (start) bits.push(fmtHint(start, hasTime));
  if (priority !== "NORMAL") bits.push(priority === "URGENT" ? "urgente" : priority === "HIGH" ? "alta" : "baja");
  if (freq) bits.push(freq === "DAILY" ? "cada día" : freq === "WEEKLY" ? "cada semana" : "cada mes");
  const hint = (dateHit.day || hasTime || freq || priority !== "NORMAL" || KIND_PREFIX.some(([re]) => re.test(input)))
    ? bits.join(" · ")
    : "";

  return { kind, title, start, end, hasTime, allDay, priority, freq, hint, invalidDate: dateHit.invalid, invalidTime: timeHit.invalid };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextWeekday(from: Date, weekday: number): Date {
  const cur = from.getDay();
  const delta = weekday === cur ? 7 : (weekday - cur + 7) % 7;
  const out = startOfLocalDay(from);
  out.setDate(out.getDate() + delta);
  return out;
}

function exactLocalDate(year: number, month: number, day: number): Date | null {
  const value = new Date(year, month, day);
  return value.getFullYear() === year && value.getMonth() === month && value.getDate() === day ? value : null;
}

function takeDate(text: string, now: Date): { rest: string; day: Date | null; invalid: boolean } {
  let rest = text;
  let day: Date | null = null;
  let invalid = false;
  const today = startOfLocalDay(now);

  const named: [RegExp, number][] = [
    [/\bpasado\s+ma[nñ]ana\b/i, 2],
    [/\bma[nñ]ana\b/i, 1],
    [/\bhoy\b/i, 0],
  ];
  for (const [re, add] of named) {
    if (re.test(rest)) {
      day = new Date(today);
      day.setDate(day.getDate() + add);
      rest = rest.replace(re, " ");
      break;
    }
  }
  if (!day) {
    for (const { re, day: wd } of WEEKDAYS) {
      if (re.test(rest)) {
        day = nextWeekday(today, wd);
        rest = rest.replace(re, " ");
        break;
      }
    }
  }
  if (!day) {
    const iso = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      day = exactLocalDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      invalid = !day;
      if (day) rest = rest.replace(iso[0], " ");
    }
  }
  if (!day) {
    const dmy = rest.match(/\b(?:el\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (dmy) {
      const dd = Number(dmy[1]);
      const mo = Number(dmy[2]) - 1;
      const yy = dmy[3] ? (Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : now.getFullYear();
      day = exactLocalDate(yy, mo, dd);
      invalid = !day;
      if (day) {
        if (!dmy[3] && day < today) {
          for (let nextYear = yy + 1; nextYear <= yy + 8; nextYear++) {
            day = exactLocalDate(nextYear, mo, dd);
            if (day) break;
          }
        }
        if (day) rest = rest.replace(dmy[0], " ");
        else invalid = true;
      }
    }
  }
  return { rest, day, invalid };
}

function takeTime(text: string): { rest: string; minutes: number | null; invalid: boolean } {
  let rest = text;
  const m = rest.match(/\b(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(h|hrs?|horas?)?(?:\s+de\s+la\s+(ma[nñ]ana|tarde|noche))?\b/i);
  if (!m) return { rest, minutes: null, invalid: false };
  // Avoid eating a bare number that is part of the title ("3 cosas").
  const looksLikeTime = /a\s+las?/i.test(m[0]) || m[2] != null || /h/i.test(m[3] ?? "") || Boolean(m[4]);
  if (!looksLikeTime) return { rest, minutes: null, invalid: false };
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const period = (m[4] ?? "").toLowerCase();
  if (period.includes("tarde") || period.includes("noche")) {
    if (h < 12) h += 12;
  } else if (period.includes("mañana") || period.includes("manana")) {
    if (h === 12) h = 0;
  }
  if (h > 23 || min > 59) return { rest, minutes: null, invalid: true };
  rest = rest.replace(m[0], " ");
  return { rest, minutes: h * 60 + min, invalid: false };
}

function fmtHint(d: Date, hasTime: boolean): string {
  const day = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  if (!hasTime) return day;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

export function parseLooksLikeCreate(input: string): boolean {
  const t = input.trim();
  if (t.length < 2) return false;
  if (KIND_PREFIX.some(([re]) => re.test(t))) return true;
  return /\b(hoy|ma[nñ]ana|pasado\s+ma[nñ]ana|a\s+las?|urgente|cada\s+(d[ií]a|semana|mes)|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(t);
}
