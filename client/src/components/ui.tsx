import { ReactNode, useEffect, createContext, useContext, useState, useCallback, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, PropsWithChildren, useRef } from "react";
import { X, CheckCircle2, AlertCircle, Info, Loader2, Inbox, Eye, EyeOff } from "lucide-react";
import clsx from "clsx";
import type { Priority } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; message: string; }
const ToastCtx = createContext<{ push: (kind: ToastKind, message: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
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
            <p className="text-sm text-text flex-1">{t.message}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-faint hover:text-text">
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
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("w-5 h-5 animate-spin text-accent", className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-border/60", className)} />;
}

/* ------------------------------------------------------------------ */
/* Button / Input / Select / Checkbox                                 */
/* ------------------------------------------------------------------ */
type Btn = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, ...props }: Btn) {
  return <button className={clsx(variant === "primary" && "btn-primary", variant === "secondary" && "btn-secondary", variant === "ghost" && "btn-ghost", variant === "danger" && "btn-danger", size === "sm" && "!h-8 !px-3 !text-xs", className)} {...props} />;
}
interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; dense?: boolean; }
export function Input({ label, error, className, dense, type, ...props }: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;
  return (
    <div className={clsx(dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "!mb-0")}>{label}</label>}
      {isPassword ? (
        <div className={clsx(
          "flex items-stretch h-11 rounded-xl bg-surface border border-border overflow-hidden transition-colors",
          "focus-within:border-accent focus-within:ring-2 ring-accent-soft",
          error && "!border-danger focus-within:!ring-danger/40",
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
        <input className={clsx("input", dense && "!h-9", error && "!border-danger focus:!ring-danger/40", className)} type={type} {...props} />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; error?: string; dense?: boolean; }
export function Textarea({ label, error, className, dense, ...props }: TextareaProps) {
  return (
    <div className={clsx(dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "!mb-0")}>{label}</label>}
      <textarea className={clsx("input min-h-[6.5rem] py-2 resize-y", dense && "!min-h-[4.75rem] !h-auto", error && "!border-danger focus:!ring-danger/40", className)} {...props} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: string; dense?: boolean }
export function Select({ label, className, children, dense, ...props }: SelectProps) {
  return (
    <div className={clsx(dense ? "space-y-1" : "space-y-1.5")}>
      {label && <label className={clsx("label", dense && "!mb-0")}>{label}</label>}
      <select className={clsx("input appearance-none bg-no-repeat bg-[right_0.9rem_center] bg-[length:1rem] pr-9 cursor-pointer", dense && "!h-9", className)}
        style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23666' stroke-width='2'><path d='m4 6 4 4 4-4'/></svg>\")" }}
        {...props}>{children}</select>
    </div>
  );
}
export function Checkbox({ label, checked, onChange, className }: { label?: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={clsx("inline-flex items-center gap-2.5 cursor-pointer select-none text-sm", className)}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={clsx("w-5 h-5 rounded-md border-2 grid place-items-center transition-all", checked ? "bg-accent border-accent text-white" : "border-border")}>
        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Modal (accessible, focus trap-ish, app-like slide on mobile)       */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
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
  return (
    <div className="modal-overlay">
      <div className={clsx("absolute inset-0 bg-black/45 backdrop-blur-[2px]", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} />
      <div role="dialog" aria-modal="true"
        className={clsx("modal-shell will-change-transform",
          leaving ? "animate-slide-down-out md:animate-modal-out" : "animate-slide-up md:animate-modal-in")}>
        {title !== null && (
          <div className="modal-head">
            <h3 className="modal-title">{title}</h3>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="btn-ghost !p-2 shrink-0"><X className="w-5 h-5" /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-surface border border-border grid place-items-center text-muted mb-4">
        {icon ?? <Inbox className="w-6 h-6" />}
      </div>
      <p className="font-medium text-text">{title}</p>
      {hint && <p className="text-sm text-muted mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page header (same title size and row height on every section)      */
/* ------------------------------------------------------------------ */
export function PageHeader({ title, lead, actions, className }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx("page-head", className)}>
      <div className="page-head-main">
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
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? <Spinner /> : confirmLabel}</Button></>}>
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control / Tabs                                           */
/* ------------------------------------------------------------------ */
export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx("inline-flex p-1 rounded-xl bg-surface border border-border", className)}>
      {options.map((o) => (
        <button type="button" key={o.value || "all"} onClick={() => onChange(o.value)}
          className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
            value === o.value ? "bg-accent-soft text-accent-strong shadow-sm" : "text-muted hover:text-text")}>
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
    case "LOW": return "bg-slate-400 dark:bg-slate-500";
    case "NORMAL": return "bg-sky-500";
    case "HIGH": return "bg-amber-500";
    case "URGENT": return "bg-rose-500";
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
export function Avatar({ name, src, size = 34 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const initials = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const showImg = Boolean(src) && !broken;
  return (
    <div
      className={clsx("grid place-items-center rounded-full font-semibold shrink-0 select-none overflow-hidden", !showImg && "text-white")}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: showImg ? undefined : "linear-gradient(135deg,#1d4ed8,#7c3aed)",
      }}
    >
      {showImg ? (
        <img src={src!} alt={name} width={size} height={size} className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : initials}
    </div>
  );
}

export function Section({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card p-5" id={id}>
      <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint">{icon}{title}</h2>
      {children}
    </section>
  );
}

export function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text hover:bg-surface/80 transition-colors"
    >
      <span className="min-w-0 leading-snug">{label}</span>
      <span className={clsx("relative shrink-0 h-5 w-9 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
        <span
          className={clsx("absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", on ? "translate-x-[18px]" : "translate-x-0")}
        />
      </span>
    </button>
  );
}
