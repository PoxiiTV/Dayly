import { ReactNode, useEffect, createContext, useContext, useState, useCallback, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, PropsWithChildren, useRef } from "react";
import { X, CheckCircle2, AlertCircle, Info, Loader2, Inbox } from "lucide-react";
import clsx from "clsx";

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
interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }
export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label">{label}</label>}
      <input className={clsx("input", error && "!border-danger focus:!ring-danger/40", className)} {...props} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: string }
export function Select({ label, className, children, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="label">{label}</label>}
      <select className={clsx("input appearance-none bg-no-repeat bg-[right_0.9rem_center] bg-[length:1rem] pr-9 cursor-pointer", className)}
        style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23666' stroke-width='2'><path d='m4 6 4 4 4-4'/></svg>\")" }}
        {...props}>{children}</select>
    </div>
  );
}
export function Checkbox({ label, checked, onChange, className }: { label?: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={clsx("inline-flex items-center gap-2.5 cursor-pointer select-none text-sm", className)}>
      <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)}
        className={clsx("w-5 h-5 rounded-md border-2 grid place-items-center transition-all", checked ? "bg-accent border-accent text-white" : "border-border")}>
        {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Modal (accessible, focus trap-ish, app-like slide on mobile)       */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true"
        className={clsx("relative bg-surface rounded-t-3xl md:rounded-3xl w-full shadow-pop animate-slide-up max-h-[92vh] flex flex-col",
          size === "sm" && "md:max-w-sm", size === "md" && "md:max-w-lg", size === "lg" && "md:max-w-2xl")}>
        {title !== null && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-text text-base">{title}</h3>
            <button onClick={onClose} aria-label="Cerrar" className="btn-ghost !p-2"><X className="w-5 h-5" /></button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-border flex justify-end gap-2">{footer}</div>}
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
/* Confirm dialog                                                     */
/* ------------------------------------------------------------------ */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Eliminar", danger = true, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
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
        <button key={o.value} onClick={() => onChange(o.value)}
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
export function PriorityDot({ p }: { p: string }) {
  const map: Record<string, string> = {
    LOW: "bg-slate-300 dark:bg-slate-600", NORMAL: "bg-accent/60",
    HIGH: "bg-warn", URGENT: "bg-danger",
  };
  return <span aria-label={`Prioridad ${p}`} className={clsx("inline-block w-2 h-2 rounded-full shrink-0", map[p] ?? "bg-slate-300")} />;
}

/* ------------------------------------------------------------------ */
/* Avatar                                                             */
/* ------------------------------------------------------------------ */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="grid place-items-center rounded-full text-white font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.38, background: "linear-gradient(135deg,#1d4ed8,#7c3aed)" }}>
      {initials}
    </div>
  );
}