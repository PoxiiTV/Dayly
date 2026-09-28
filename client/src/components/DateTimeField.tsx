import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import clsx from "clsx";
import { formatDateChip, localKey, monthGrid, monthTitle, QUARTER_HOUR_TIMES, WEEKDAY_INITIALS } from "@/lib/dates";
import { occupiedHint, type OccupiedLookup } from "@/lib/occupiedTimes";

type DateTimeFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  occupied?: OccupiedLookup;
};

function splitValue(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = value.slice(0, 10);
  const time = value.includes("T") ? value.slice(11, 16) : "";
  return { date, time };
}

function joinValue(date: string, time: string): string {
  if (!date) return "";
  return `${date}T${time || "08:00"}`;
}

function timeSlots(current: string): string[] {
  if (current && !QUARTER_HOUR_TIMES.includes(current)) {
    return [...QUARTER_HOUR_TIMES, current].sort();
  }
  return QUARTER_HOUR_TIMES;
}

export function DateTimeField({ label, value, onChange, optional = false, occupied }: DateTimeFieldProps) {
  const { date, time } = splitValue(value);
  return (
    <div className="space-y-1.5">
      <span className="label mb-0">{label}</span>
      <div className="flex gap-2 min-w-0">
        <DateChip value={date} onChange={(next) => onChange(joinValue(next, time))} optional={optional} />
        <TimeChip
          value={time}
          disabled={!date && !optional}
          occupied={occupied}
          onChange={(next) => {
            const day = date || localKey(new Date());
            if (!next) {
              onChange(optional ? "" : joinValue(day, "08:00"));
              return;
            }
            onChange(joinValue(day, next));
          }}
        />
        {optional && value && (
          <button
            type="button"
            aria-label="Quitar fecha"
            onClick={() => onChange("")}
            className="shrink-0 w-11 h-11 rounded-xl border border-border text-faint hover:text-text hover:border-accent/40 grid place-items-center"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function DateChip({
  value,
  onChange,
  optional,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  label?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chip = (
    <div className="relative min-w-0 flex-1 w-full">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ?? "Fecha"}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={clsx("input flex items-center gap-2 pr-8 text-left w-full", !value && "text-faint")}
      >
        <CalendarDays className="w-4 h-4 shrink-0 text-faint" />
        <span className="truncate">{value ? formatDateChip(value) : optional ? "Sin fecha" : "Elegir fecha"}</span>
      </button>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
      {open && btnRef.current && (
        <DateMenu
          anchor={btnRef.current}
          value={value}
          optional={optional}
          onPick={(next) => { onChange(next); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
  if (!label) return chip;
  return (
    <div className="space-y-1.5 min-w-0">
      <span className="label mb-0">{label}</span>
      {chip}
    </div>
  );
}

function DateMenu({
  anchor,
  value,
  optional,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  value: string;
  optional?: boolean;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const today = localKey(new Date());
  const initial = value ? new Date(`${value}T12:00:00`) : new Date();
  const [cursor, setCursor] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const cells = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = boxRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const openUp = spaceBelow < h && r.top - 8 > spaceBelow;
      setPos({
        top: openUp ? r.top - h - 4 : r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 252),
      });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, cursor]);

  const [focusKey, setFocusKey] = useState(value || today);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const d = new Date(`${focusKey}T12:00:00`);
      const move = (days: number) => {
        d.setDate(d.getDate() + days);
        const k = localKey(d);
        setFocusKey(k);
        setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
      };
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); move(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); move(-7); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); move(7); return; }
      if (e.key === "Enter") { e.preventDefault(); onPick(focusKey); return; }
      if (e.key === "PageUp") {
        e.preventDefault();
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
        return;
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [anchor, focusKey, onClose, onPick]);

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Elegir fecha"
      className="fixed z-[200] rounded-2xl border border-border bg-surface shadow-pop p-3"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
          className="btn-ghost btn-icon-sm shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="flex-1 text-center text-sm font-medium text-text truncate">
          {monthTitle(cursor)}
        </p>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
          className="btn-ghost btn-icon-sm shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_INITIALS.map((d) => (
          <span key={d} className="text-center text-[10px] font-semibold uppercase tracking-wide text-faint py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day) => {
          const key = localKey(day);
          const inMonth = day.getMonth() === cursor.getMonth();
          const selected = key === value;
          const isToday = key === today;
          const focused = key === focusKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={clsx(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                selected && "bg-accent text-white font-semibold",
                !selected && isToday && "text-accent-strong font-semibold ring-1 ring-inset ring-accent",
                !selected && !isToday && focused && "ring-1 ring-inset ring-accent/50 bg-accent-soft",
                !selected && !isToday && inMonth && "text-text hover:bg-accent-soft",
                !selected && !isToday && !inMonth && "text-faint/55 hover:bg-bg",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => onPick(today)}
          className="text-xs font-medium text-accent-strong hover:underline"
        >
          Hoy
        </button>
        {optional && (
          <button
            type="button"
            onClick={() => onPick("")}
            className="text-xs font-medium text-muted hover:text-text"
          >
            Quitar
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function TimeChip({
  value,
  onChange,
  disabled,
  label,
  occupied,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
  occupied?: OccupiedLookup;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const slots = useMemo(() => timeSlots(value), [value]);
  const selectedOccupied = Boolean(value && occupied?.times.has(value));
  const selectedTitles = value ? occupied?.titles.get(value) : undefined;
  const hourLabel = label ?? "Hora";

  return (
    <div className={clsx("shrink-0", label && "space-y-1.5")}>
      {label && <span className="label mb-0">{label}</span>}
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={selectedOccupied ? `${hourLabel}, ${occupiedHint(selectedTitles, value)}` : hourLabel}
          title={selectedOccupied ? occupiedHint(selectedTitles, value) : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={clsx(
            "input flex items-center gap-2 w-[7.25rem] text-left pr-8",
            !value && "text-faint",
            selectedOccupied && "text-warn border-warn/60 bg-warn/15 hover:border-warn",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <Clock className={clsx("w-4 h-4 shrink-0", selectedOccupied ? "text-warn" : "text-faint")} />
          <span className="tabular-nums">{value || "Hora"}</span>
        </button>
        <ChevronDown className={clsx("pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4", selectedOccupied ? "text-warn" : "text-faint")} />
      </div>
      {open && btnRef.current && (
        <TimeMenu
          anchor={btnRef.current}
          value={value}
          slots={slots}
          occupied={occupied}
          onPick={(t) => { onChange(t); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function TimeMenu({
  anchor,
  value,
  slots,
  occupied,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  value: string;
  slots: string[];
  occupied?: OccupiedLookup;
  onPick: (t: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxH: 240 });
  const start = Math.max(0, slots.indexOf(value));
  const [active, setActive] = useState(start);
  const activeRef = useRef(start);
  activeRef.current = active;

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const maxH = 240;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const openUp = spaceBelow < 160 && r.top > spaceBelow;
      const height = Math.min(maxH, openUp ? r.top - 8 : spaceBelow);
      setPos({
        top: openUp ? r.top - height - 4 : r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 132),
        maxH: height,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(slots.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Home") { e.preventDefault(); setActive(0); return; }
      if (e.key === "End") { e.preventDefault(); setActive(slots.length - 1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        onPick(slots[activeRef.current] ?? slots[0]);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose, onPick, slots]);

  useEffect(() => {
    listRef.current?.querySelector("[data-active-time]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label="Elegir hora"
      className="fixed z-[200] rounded-xl border border-border bg-surface shadow-pop overflow-y-auto py-1"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
    >
      {slots.map((slot, i) => {
        const selected = slot === value;
        const isActive = i === active;
        const busy = Boolean(occupied?.times.has(slot));
        const titles = occupied?.titles.get(slot);
        return (
          <button
            key={slot}
            type="button"
            role="option"
            aria-selected={selected}
            data-active-time={isActive ? "" : undefined}
            data-occupied={busy ? "true" : undefined}
            title={busy ? occupiedHint(titles, slot) : undefined}
            aria-label={busy ? `${slot}, ${occupiedHint(titles, slot)}` : slot}
            onClick={() => onPick(slot)}
            className={clsx(
              "w-full px-3 py-1.5 text-left text-sm tabular-nums flex items-center gap-2",
              selected && !busy && "bg-accent-soft text-accent-strong font-medium",
              selected && busy && "bg-warn/30 text-warn font-semibold",
              !selected && busy && "text-warn bg-warn/20 font-medium hover:bg-warn/30",
              !selected && !busy && "text-text hover:bg-bg",
              isActive && !selected && !busy && "bg-bg",
              isActive && !selected && busy && "bg-warn/30",
            )}
          >
            <span>{slot}</span>
            {busy && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-warn shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
