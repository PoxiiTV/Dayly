import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, Palette, Paintbrush, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import clsx from "clsx";
import { PROJECT_COLORS } from "@/lib/projects";
import { isTaskCardFill, type TaskCardFill } from "@/lib/taskCardFill";

const MENU_WIDTH = 264;
const EDGE = 8;

/**
 * Right-click menu of a board card. It lives in a portal, so every event is
 * stopped here: React would otherwise bubble clicks up to the card and open it.
 */
export function TaskCardMenu({
  x,
  y,
  cardFill,
  projectColor,
  onFill,
  onDelete,
  onOptimize,
  onClose,
}: {
  x: number;
  y: number;
  cardFill: string | null | undefined;
  projectColor: string | null;
  onFill: (fill: TaskCardFill | null) => void;
  /** Absent where deleting makes no sense (the colour button inside the task). */
  onDelete?: () => void;
  /** Present only when the AI is on. */
  onOptimize?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const current = isTaskCardFill(cardFill) ? cardFill : null;
  const custom = current && current.startsWith("#") ? current : null;

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
    menu.querySelector<HTMLElement>("[role^='menuitem']:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  const stop = (event: SyntheticEvent) => event.stopPropagation();

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const choose = (fill: TaskCardFill | null) => {
    onFill(fill);
    onClose();
  };

  const option = (fill: TaskCardFill | null, label: string, Icon: typeof Ban, disabled = false, hint?: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current === fill}
      disabled={disabled}
      title={hint}
      onClick={() => choose(fill)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex-1 truncate">{label}</span>
      {current === fill && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Opciones de la tarjeta"
      className="fixed z-[110] rounded-xl border border-border bg-elevated p-1.5 shadow-pop"
      style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
      onClick={stop}
      onPointerDown={stop}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={onKeyDown}
    >
      {onOptimize && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onClose(); onOptimize(); }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-accent-strong transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            Optimizar con IA
          </button>
          <div className="my-1 border-t border-border" role="separator" />
        </>
      )}
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Fondo de la tarjeta</p>
      {option(null, "Según Apariencia", SlidersHorizontal)}
      {option("none", "Sin color", Ban)}
      {option("project", "Color del proyecto", Paintbrush, !projectColor, projectColor ? undefined : "La tarea no tiene proyecto")}
      <div role="group" aria-label="Colores" className="flex flex-wrap items-center gap-1 px-2 py-2">
        {PROJECT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitemradio"
            aria-checked={current === color}
            aria-label={`Color ${color}`}
            onClick={() => choose(color as TaskCardFill)}
            className={clsx(
              "h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-elevated",
              current === color && "ring-2 ring-text ring-offset-2 ring-offset-elevated",
            )}
            style={{ background: color }}
          />
        ))}
        <label
          className={clsx(
            "relative grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-border text-muted hover:text-text focus-within:ring-2 focus-within:ring-accent",
            custom && !PROJECT_COLORS.includes(custom) && "ring-2 ring-text ring-offset-2 ring-offset-elevated",
          )}
          style={custom && !PROJECT_COLORS.includes(custom) ? { background: custom } : undefined}
          title="Otro color"
        >
          {!(custom && !PROJECT_COLORS.includes(custom)) && <Palette className="h-3 w-3" aria-hidden="true" />}
          <input
            type="color"
            role="menuitem"
            aria-label="Elegir otro color"
            value={custom ?? "#6366f1"}
            onChange={(event) => onFill(event.target.value.toLowerCase() as TaskCardFill)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      {onDelete && <div className="my-1 border-t border-border" role="separator" />}
      {onDelete && <button
        type="button"
        role="menuitem"
        onClick={() => { onClose(); onDelete(); }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-danger transition-colors hover:bg-danger/10 focus-visible:bg-danger/10 focus-visible:outline-none"
      >
        <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Eliminar tarea
      </button>}
    </div>,
    document.body,
  );
}
