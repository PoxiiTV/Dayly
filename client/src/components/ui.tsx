import { ReactNode, forwardRef, useEffect, createContext, useContext, useState, useCallback, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, PropsWithChildren, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertCircle, Info, Loader2, Inbox, Eye, EyeOff, ChevronDown, Plus, Send } from "lucide-react";
import clsx from "clsx";
import type { Priority } from "@/lib/types";
import { COMING_SOON_LABEL, integrationShown, useIntegration } from "@/lib/integrations";

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
type ToastKind = "success" | "error" | "info";
/** A button inside the toast, the way Gmail offers "Deshacer" after sending. */
export interface ToastAction { label: string; onClick: () => void }
interface Toast { id: number; kind: ToastKind; message: string; actions?: ToastAction[] }
const ToastCtx = createContext<{ push: (kind: ToastKind, message: string, actions?: ToastAction[]) => void }>({ push: () => {} });

/** Plain notices come and go; one you are meant to act on has to wait for you. */
const TOAST_MS = 3600;
const TOAST_WITH_ACTIONS_MS = 8000;

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string, actions?: ToastAction[]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message, actions }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), actions?.length ? TOAST_WITH_ACTIONS_MS : TOAST_MS);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 md:left-auto md:right-5 md:translate-x-0 z-[90] space-y-2 w-[92vw] max-w-sm safe-bottom">
        {toasts.map((t) => (
          <div key={t.id} className="card flex items-start gap-3 px-4 py-3 animate-slide-up shadow-pop">
            {t.kind === "success" && <CheckCircle2 className="w-5 h-5 text-ok shrink-0 mt-0.5" />}
            {t.kind === "error" && <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />}
            {t.kind === "info" && <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="whitespace-pre-line text-sm text-text">{t.message}</p>
              {t.actions && t.actions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {t.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        // The toast goes as soon as you pick: leaving it there
                        // invites a second click on something already done.
                        setToasts((x) => x.filter((y) => y.id !== t.id));
                        action.onClick();
                      }}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button aria-label="Cerrar aviso" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-faint hover:text-text">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

const MOTION_OUT_MS = 200;

export function usePresence(open: boolean, durationMs = MOTION_OUT_MS) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const seen = useRef(open);
  useEffect(() => {
    if (open) {
      seen.current = true;
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!seen.current) return;
    setLeaving(true);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
      seen.current = false;
    }, reduce ? 0 : durationMs);
    return () => window.clearTimeout(t);
  }, [open, durationMs]);
  return { present: shown, leaving };
}

/* ------------------------------------------------------------------ */
/* Spinner / Skeleton                                                 */
/* ------------------------------------------------------------------ */
/** Inherits `currentColor` so it stays legible inside coloured buttons. */
export function Spinner({ className, size = 20 }: { className?: string; size?: number }) {
  return <Loader2 aria-hidden size={size} className={clsx("animate-spin shrink-0", className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-border/60", className)} />;
}

/* ------------------------------------------------------------------ */
/* Button / Input / Select / Checkbox                                 */
/* ------------------------------------------------------------------ */
type Btn = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "xs" | "sm" | "md";
  /** Square button sized for a single icon; drops the horizontal padding. */
  icon?: boolean;
};
const BTN_VARIANT = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;
const BTN_SIZE = { xs: "btn-xs", sm: "btn-sm", md: "" } as const;
export function Button({ variant = "primary", size = "md", icon = false, className, ...props }: Btn) {
  return (
    <button
      type="button"
      className={clsx(
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        icon && (size === "md" ? "btn-icon" : "btn-icon-sm"),
        className,
      )}
      {...props}
    />
  );
}
interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; dense?: boolean; }
export function Input({ label, error, className, dense, type, ...props }: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;
  return (
    <div className={clsx(dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "mb-0")}>{label}</label>}
      {isPassword ? (
        <div className={clsx(
          "flex items-stretch h-11 rounded-xl bg-surface border border-border overflow-hidden transition-colors",
          "focus-within:border-accent focus-within:ring-2 ring-accent-soft",
          error && "border-danger focus-within:ring-danger/40",
        )}>
          <input
            className={clsx("min-w-0 flex-1 h-full px-3 bg-transparent border-0 text-text text-sm placeholder:text-faint outline-none focus:ring-0 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden", className)}
            type={inputType}
            {...props}
          />
          <button
            type="button"
            className="shrink-0 w-9 grid place-items-center border-l border-border text-faint hover:text-text"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <input className={clsx("input", dense && "h-9", error && "border-danger focus:ring-danger/40", className)} type={type} {...props} />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; error?: string; dense?: boolean; }
/** Forwards its ref so callers can place the caret (the chat inserts emoji). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, className, dense, ...props }, ref,
) {
  return (
    <div className={clsx("min-w-0 flex-1", dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "mb-0")}>{label}</label>}
      <textarea ref={ref} className={clsx("input h-auto min-h-[6.5rem] py-2.5 leading-relaxed resize-y", dense && "min-h-[4.75rem]", error && "border-danger focus:ring-danger/40", className)} {...props} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
});
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: string; dense?: boolean }
export function Select({ label, className, children, dense, ...props }: SelectProps) {
  return (
    <div className={clsx(dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "mb-0")}>{label}</label>}
      <SelectControl className={className} dense={dense} {...props}>{children}</SelectControl>
    </div>
  );
}

/** Bare select without the label wrapper, for inline toolbars and custom layouts.
 *  The chevron is a real element so it inherits the theme colour (a data-URI
 *  background cannot use `currentColor`). */
export function SelectControl({ className, children, dense, ...props }: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        className={clsx("input appearance-none pr-9 cursor-pointer", dense && "h-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
    </div>
  );
}
export function Checkbox({ label, checked, onChange, className }: { label?: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={clsx("group inline-flex items-center gap-2.5 cursor-pointer select-none text-sm text-text", className)}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={clsx("w-5 h-5 shrink-0 rounded-md border-2 grid place-items-center transition-colors duration-150", checked ? "bg-accent border-accent text-white" : "border-border group-hover:border-accent/50")}>
        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </span>
      {label && <span className="min-w-0">{label}</span>}
    </label>
  );
}

/** Paper-plane toggle used for Telegram alerts: grey off, sky blue on. */
export function TelegramNotifyToggle({
  on,
  onChange,
  linked,
  className,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  linked?: boolean;
  className?: string;
}) {
  const telegram = useIntegration("telegram");
  if (!integrationShown(telegram)) return null;
  const soon = telegram === "COMING_SOON";
  const title = soon
    ? `Avisos por Telegram · ${COMING_SOON_LABEL}`
    : on
      ? "Aviso de Telegram activado"
      : linked === false
        ? "Vincula Telegram en Ajustes para activarlo."
        : "Avisar por Telegram";
  return (
    <button
      type="button"
      disabled={soon}
      onClick={() => onChange(!on)}
      className={clsx(
        "shrink-0 h-11 w-11 grid place-items-center rounded-xl transition-colors",
        soon ? "text-faint opacity-50 cursor-not-allowed" : on ? "text-sky-500" : "text-faint hover:text-sky-500",
        className,
      )}
      aria-pressed={on}
      aria-label={on ? "Desactivar aviso de Telegram" : "Activar aviso de Telegram"}
      title={title}
    >
      <Send className="w-5 h-5" />
    </button>
  );
}

/** Marks a feature the admin announced but has not enabled yet. */
export function ComingSoonBadge({ className }: { className?: string }) {
  return <span className={clsx("chip bg-accent-soft text-accent-strong text-[10px] font-semibold uppercase tracking-wide", className)}>{COMING_SOON_LABEL}</span>;
}

/** Colour picker shared by the project and habit editors. */
export function ColorSwatches({ colors, value, onChange, label = "Color" }: {
  colors: readonly string[]; value: string; onChange: (color: string) => void; label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="label mb-0">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2 pt-0.5">
        {colors.map((c) => {
          const selected = value === c;
          return (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={selected}
              aria-label={`Color ${c}`}
              onClick={() => onChange(c)}
              className={clsx(
                "w-8 h-8 rounded-full transition-transform duration-150 focus:outline-none",
                "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:ring-accent",
                selected ? "ring-2 ring-offset-2 ring-offset-surface ring-accent scale-110" : "hover:scale-110",
              )}
              style={{ background: c }}
            />
          );
        })}
      </div>
    </div>
  );
}

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Baja" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

export const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No se repite" },
  { value: "DAILY", label: "Cada día" },
  { value: "WEEKLY", label: "Cada semana" },
  { value: "MONTHLY", label: "Cada mes" },
];

function chipClass(selected: boolean): string {
  return clsx(
    "chip border transition-colors",
    selected ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted hover:border-accent/40 hover:text-text",
  );
}

export function priorityChipTone(p: Priority): string {
  switch (p) {
    case "LOW": return "border-prio-low bg-prio-low/15 text-muted";
    case "NORMAL": return "border-prio-normal bg-prio-normal/15 text-prio-normal";
    case "HIGH": return "border-prio-high bg-prio-high/15 text-prio-high";
    case "URGENT": return "border-prio-urgent bg-prio-urgent/15 text-prio-urgent";
    default: {
      const _never: never = p;
      return _never;
    }
  }
}

/** Color-coded priority chips, same control as the task editor. */
export function PriorityChips({ value, onChange, label = "Prioridad" }: {
  value: Priority; onChange: (p: Priority) => void; label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {PRIORITY_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={clsx("chip border transition-colors", selected ? priorityChipTone(opt.value) : "border-border text-muted hover:border-accent/40 hover:text-text")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Single-select chips for status, recurrence, and similar short lists. */
export function ChoiceChips<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value || "none"}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={chipClass(value === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const PROJECT_CHIPS_MAX = 8;

/** Small «+» next to a field title: creates a new option without adding a chip to the list. */
export function AddIconButton({ label, expanded, onClick }: { label: string; expanded?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className={clsx("-my-1 grid h-6 w-6 place-items-center rounded-md transition-colors", expanded ? "bg-accent-soft text-accent-strong" : "text-faint hover:bg-accent/15 hover:text-accent")}
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}

export function ProjectChips({ value, onChange, projects, extra, titleAction }: {
  value: string | null;
  onChange: (id: string | null) => void;
  projects: { id: string; name: string; color?: string | null }[];
  extra?: ReactNode;
  /** Shown next to the «Proyecto» title (e.g. an AddIconButton). */
  titleAction?: ReactNode;
}) {
  const labelId = useId();
  // Past a handful of projects the chips wrap into a wall; a dropdown stays one line.
  if (projects.length > PROJECT_CHIPS_MAX) {
    const selected = projects.find((p) => p.id === value);
    return (
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5"><span className="label mb-0" id={labelId}>Proyecto</span>{titleAction}</span>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ background: selected ? selected.color ?? "rgb(var(--accent))" : "transparent" }}
          />
          <SelectControl
            aria-labelledby={labelId}
            value={selected ? selected.id : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-9"
          >
            <option value="">Sin proyecto</option>
            {[...projects].sort((a, b) => a.name.localeCompare(b.name, "es")).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectControl>
          {extra}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5"><span className="label mb-0">Proyecto</span>{titleAction}</span>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={() => onChange(null)} className={chipClass(!value)}>
          Sin proyecto
        </button>
        {projects.map((p) => {
          const selected = value === p.id;
          return (
            <button key={p.id} type="button" onClick={() => onChange(p.id)} className={chipClass(selected)}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color ?? "rgb(var(--accent))" }} />
              {p.name}
            </button>
          );
        })}
        {extra}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal (accessible, focus trap-ish, app-like slide on mobile)       */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, description, children, footer, size = "md", shellClassName, headerExtra }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Small controls shown next to the close button. */
  headerExtra?: ReactNode;
  /** Optional one-line context under the title. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Extra classes on the dialog shell (e.g. a locked height). */
  shellClassName?: string;
}) {
  const { present, leaving } = usePresence(open);
  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !leaving) onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [present, leaving, onClose]);

  if (!present) return null;
  const node = (
    <div className="modal-overlay">
      <div className={clsx("absolute inset-0 bg-black/55", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div role="dialog" aria-modal="true" data-size={size}
        className={clsx("modal-shell will-change-transform",
          leaving ? "animate-slide-down-out md:animate-modal-out" : "animate-slide-up md:animate-modal-in",
          shellClassName)}>
        {title !== null && (
          <div className="modal-head">
            <div className="min-w-0 py-3">
              <h3 className="modal-title">{title}</h3>
              {description && <p className="text-sm text-muted mt-1 leading-relaxed max-w-[46rem]">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerExtra}
              <Button variant="ghost" icon onClick={onClose} aria-label="Cerrar" className="-mr-2"><X className="w-5 h-5" /></Button>
            </div>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-bg border border-border grid place-items-center text-faint mb-4">
        {icon ?? <Inbox className="w-6 h-6" />}
      </div>
      <p className="font-medium text-text">{title}</p>
      {hint && <p className="text-sm text-muted mt-1.5 max-w-sm leading-relaxed">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page header (same title size and row height on every section)      */
/* ------------------------------------------------------------------ */
export function PageHeader({ title, lead, actions, className, hideTitleOnMobile }: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** For headers whose buttons leave no room for the title on a phone. */
  hideTitleOnMobile?: boolean;
}) {
  return (
    <div className={clsx("page-head", className)}>
      <div className={clsx("page-head-main", hideTitleOnMobile && "hidden md:flex")}>
        <h1 className="page-title">{title}</h1>
        <p className={clsx("page-lead", !lead && "invisible")}>{lead ?? "\u00a0"}</p>
      </div>
      <div className="page-head-actions">{actions}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                     */
/* ------------------------------------------------------------------ */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Eliminar", danger = true, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? <Spinner /> : confirmLabel}</Button></>}>
      <p className="text-sm text-muted leading-relaxed">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control / Tabs                                           */
/* ------------------------------------------------------------------ */
export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    // Scrolls inside its own box instead of widening the page: on a phone four
    // or five options are wider than the screen.
    <div role="tablist" className={clsx("inline-flex max-w-full overflow-x-auto no-scrollbar p-1 rounded-xl bg-bg border border-border", className)}>
      {options.map((o) => (
        <button type="button" role="tab" aria-selected={value === o.value} key={o.value || "all"} onClick={() => onChange(o.value)}
          className={clsx("px-3 h-8 shrink-0 grid place-items-center rounded-lg text-sm font-medium whitespace-nowrap",
            "transition-[background-color,color,box-shadow] duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
            value === o.value ? "bg-surface text-text shadow-soft" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Priority badge                                                     */
/* ------------------------------------------------------------------ */
function isPriority(p: string): p is Priority {
  return p === "LOW" || p === "NORMAL" || p === "HIGH" || p === "URGENT";
}

function priorityDotClass(p: string): string {
  if (!isPriority(p)) return "bg-border";
  switch (p) {
    case "LOW": return "bg-prio-low";
    case "NORMAL": return "bg-prio-normal";
    case "HIGH": return "bg-prio-high";
    case "URGENT": return "bg-prio-urgent";
    default: {
      const _never: never = p;
      return _never;
    }
  }
}

export function PriorityDot({ p, className }: { p: string; className?: string }) {
  return (
    <span
      aria-label={`Prioridad ${p}`}
      title={p === "LOW" ? "Baja" : p === "NORMAL" ? "Normal" : p === "HIGH" ? "Alta" : p === "URGENT" ? "Urgente" : p}
      className={clsx("inline-block rounded-full shrink-0", priorityDotClass(p), className ?? "w-2.5 h-2.5")}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Avatar                                                             */
/* ------------------------------------------------------------------ */
export function Avatar({ name, src, size = 34, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const initials = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const showImg = Boolean(src) && !broken;
  return (
    <div
      className={clsx("grid place-items-center rounded-full font-semibold shrink-0 select-none overflow-hidden", !showImg && "text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: showImg
          ? undefined
          : "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-strong)))",
      }}
    >
      {showImg ? (
        <img src={src!} alt={name} width={size} height={size} className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : initials}
    </div>
  );
}

/** Settings row with a switch; the whole row is the hit area (good on touch). */
export function Toggle({ label, on, set, disabled = false }: { label: string; on: boolean; set: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => set(!on)} className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text transition-colors hover:bg-surface/80 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="min-w-0 leading-snug">{label}</span>
      <span className={clsx("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
        <span className={clsx("absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", on && "translate-x-[18px]")} />
      </span>
    </button>
  );
}
