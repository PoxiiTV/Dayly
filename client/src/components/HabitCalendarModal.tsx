import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Modal, Button, Spinner } from "@/components/ui";
import { localKey } from "@/lib/dates";
import type { Habit } from "@/lib/types";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

type CalendarHabit = Habit & { logs?: { date: string; done: boolean }[] };

/** Monday-first 6x7 grid of the given month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function HabitCalendarModal({ habit, open, onClose }: {
  habit: CalendarHabit | null;
  open: boolean;
  onClose: () => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const doneKeys = useMemo(
    () => new Set((habit?.logs ?? []).filter((l) => l.done).map((l) => l.date.slice(0, 10))),
    [habit?.id, habit?.logs],
  );

  // Reset to current month whenever a different habit is opened.
  const [forHabit, setForHabit] = useState<string | null>(null);
  if (open && habit && forHabit !== habit.id) {
    setForHabit(habit.id);
    setCursor({ y: today.getFullYear(), m: today.getMonth() });
  }

  const days = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const isCurrentMonth = cursor.y === today.getFullYear() && cursor.m === today.getMonth();

  const stats = useMemo(() => {
    let done = 0;
    for (const d of days) {
      const inMonth = d.getMonth() === cursor.m;
      if (inMonth && doneKeys.has(localKey(d))) done++;
    }
    const total = new Date(cursor.y, cursor.m + 1, 0).getDate();
    return { done, total };
  }, [days, cursor, doneKeys]);

  const move = (delta: number) => {
    setCursor((c) => {
      const m = c.m + delta;
      if (m < 0) return { y: c.y - 1, m: 11 };
      if (m > 11) return { y: c.y + 1, m: 0 };
      return { ...c, m };
    });
  };

  const accent = habit?.color ?? "#6366f1";

  return (
    <Modal open={open} onClose={onClose} title={habit ? habit.name : undefined}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      {habit ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <button type="button" aria-label="Mes anterior" onClick={() => move(-1)} className="p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-sm font-medium capitalize">{MONTHS[cursor.m]} {cursor.y}</div>
            <button type="button" aria-label="Mes siguiente" disabled={isCurrentMonth} onClick={() => move(1)} className="p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:pointer-events-none">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_LABELS.map((l) => (
              <span key={l} className="text-center text-[10px] font-bold text-faint">{l}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const key = localKey(d);
              const inMonth = d.getMonth() === cursor.m;
              const isFuture = d.getTime() > today.getTime();
              const done = doneKeys.has(key);
              const jsDay = (d.getDay() + 6) % 7;
              const scheduled = ((habit.scheduleDayBits >> jsDay) & 1) === 1;
              const isToday = key === localKey(today);
              return (
                <div
                  key={key}
                  title={`${key}${done ? " · hecho" : scheduled ? (isFuture ? "" : " · no hecho") : ""}`}
                  className={clsx(
                    "aspect-square grid place-items-center rounded-md text-[11px] tabular-nums",
                    !inMonth && "opacity-25",
                    done ? "font-semibold" : "",
                    isToday && "ring-2 ring-offset-1 ring-offset-surface",
                  )}
                  style={{
                    background: done ? accent : undefined,
                    color: done ? "#fff" : undefined,
                    ...(isToday ? { ["--tw-ring-color" as string]: accent } : {}),
                  }}
                >
                  {d.getDate()}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: accent }} /> Hecho ({stats.done}/{stats.total} este mes)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm border border-border bg-surface" /> No hecho / fuera de programa
            </span>
            <span className="inline-flex items-center gap-1.5">
              🔥 Racha actual {habit.current ?? 0} · récord {habit.longest ?? 0}
            </span>
          </div>
        </>
      ) : (
        <div className="grid place-items-center h-32"><Spinner /></div>
      )}
    </Modal>
  );
}
