/**
 * Subscription date math and money aggregation.
 *
 * Pure functions, no Prisma: the tricky parts here are month-end clamping and
 * the local hour of an alert, and both are far easier to trust with tests than
 * with a database in the loop.
 *
 * NOTE: `recurrence.ts` is NOT reused. Its MONTHLY step is a plain `setMonth`,
 * which overflows (31 Jan + 1 month = 3 Mar). A subscription anchored on the
 * 31st must land on the last day of February and then come BACK to the 31st in
 * March, so the anchor day — not the previous charge — is the source of truth.
 */

import { wallToUtc } from "./mascot/time.js";

/** Charge days are stored at 12:00 UTC, like HabitLog.date, so the calendar
 * key always matches the user's local date regardless of DST or UTC offset. */
export const CHARGE_HOUR_UTC = 12;

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function ymdOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A `YYYY-MM-DD` day as the Date we persist for it. */
export function chargeDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, CHARGE_HOUR_UTC, 0, 0, 0));
}

/**
 * The charge day for a given month, clamping the anchor to the last valid day.
 * `anchorDay` 31 gives 28/29 in February but is never itself rewritten.
 */
export function chargeYmdFor(year: number, month1: number, anchorDay: number): string {
  const day = Math.min(anchorDay, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Adds months to a `YYYY-MM-DD`, clamping the day to the target month. */
export function addMonthsClamped(ymd: string, months: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const day = Number(ymd.split("-")[2]);
  const total = (y * 12 + (m - 1)) + months;
  return chargeYmdFor(Math.floor(total / 12), (total % 12) + 1, day);
}

export interface CycleSpec {
  /** Day of month the user actually wants, 1-31. */
  anchorDay: number;
  /** Billing period in months, >= 1. */
  cycleMonths: number;
}

/**
 * The first charge day strictly after `afterYmd`, rebuilt from the anchor so a
 * short month never drags the day forward permanently.
 *
 * `fromYmd` is any known charge day of the series (typically the current
 * `nextChargeAt`), used only to keep the phase of multi-month cycles.
 */
export function nextChargeYmd(spec: CycleSpec, fromYmd: string, afterYmd: string): string {
  const cycle = Math.max(1, Math.trunc(spec.cycleMonths));
  let ymd = chargeYmdFor(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(5, 7)), spec.anchorDay);
  // Bounded: 1200 steps covers a century even on a monthly cycle.
  for (let i = 0; i < 1200 && ymd <= afterYmd; i++) {
    ymd = addMonthsClamped(`${ymd.slice(0, 8)}${String(spec.anchorDay).padStart(2, "0")}`, cycle);
  }
  return ymd;
}

/** Forecast charge days in `[fromYmd, toYmd]`, starting at `startYmd`. */
export function forecastYmds(spec: CycleSpec, startYmd: string, fromYmd: string, toYmd: string, max = 120): string[] {
  const cycle = Math.max(1, Math.trunc(spec.cycleMonths));
  const out: string[] = [];
  let ymd = startYmd;
  for (let i = 0; i < max * 4 && ymd <= toYmd; i++) {
    if (ymd >= fromYmd) {
      out.push(ymd);
      if (out.length >= max) break;
    }
    ymd = addMonthsClamped(`${ymd.slice(0, 8)}${String(spec.anchorDay).padStart(2, "0")}`, cycle);
  }
  return out;
}

/** Subtract whole days from a `YYYY-MM-DD`. */
export function minusDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return ymdOf(t);
}

/**
 * When an alert for `chargeYmd` should fire: `daysBefore` days earlier at
 * `alertHour` **local time**, resolved through `wallToUtc` so the DST switch
 * does not move it by an hour.
 */
export function alertMoment(chargeYmd: string, daysBefore: number, alertHour: number, tz: string): Date {
  const day = minusDaysYmd(chargeYmd, Math.max(0, Math.trunc(daysBefore)));
  return wallToUtc(day, `${String(Math.min(23, Math.max(0, Math.trunc(alertHour)))).padStart(2, "0")}:00:00`, tz);
}

/** Normalises the alert rules: integers, deduped, at most three, soonest last. */
export function normalizeAlertDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const d = Math.trunc(n);
    if (d < 0 || d > 60) continue;
    seen.add(d);
  }
  return [...seen].sort((a, b) => b - a).slice(0, 3);
}

export interface CostRow {
  amountCents: number;
  cycleMonths: number;
}

/**
 * What the active subscriptions cost per month once every cycle is spread out.
 * Rounded once at the end so a yearly charge does not lose cents twelve times.
 */
export function monthlyCostCents(rows: CostRow[]): number {
  const total = rows.reduce((sum, r) => sum + r.amountCents / Math.max(1, r.cycleMonths), 0);
  return Math.round(total);
}
