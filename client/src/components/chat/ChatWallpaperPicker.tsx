import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Check, Ban } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { CHAT_WALLPAPERS, chatWallpaperBackground } from "@/lib/chatWallpapers";

/** Swatches for the conversation background, previewed in the current theme. */
export function ChatWallpaperPicker({ open, current, onClose, onPick, align = "left", below = false }: {
  open: boolean;
  current: string | null;
  onClose: () => void;
  onPick: (id: string | null) => void;
  /** Which edge it hangs from: the phone opens it from a button on the right. */
  align?: "left" | "right";
  /** Always downwards, for anchors that already sit at the top of the panel. */
  below?: boolean;
}) {
  const { resolved } = useTheme();
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onDown = (event: MouseEvent) => {
      // The controls render twice (the row moves between phone and desktop),
      // so the hidden copy must not close the visible one — it would unmount
      // the swatch between mousedown and click, and the pick would be lost.
      if (!panel.current || panel.current.offsetParent === null) return;
      if (!panel.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Fondo de la conversación"
      // Downwards on a phone (the controls sit at the top of the panel there)
      // and upwards on desktop, so the card never clips it.
      className={clsx(
        "absolute top-full z-[60] mt-2 w-[min(16rem,calc(100vw-3rem))] rounded-2xl border border-border bg-surface p-3 shadow-pop",
        align === "right" ? "right-0" : "left-0",
        !below && "md:bottom-full md:top-auto md:mb-2 md:mt-0",
      )}
    >
      <p className="mb-2 text-xs font-medium text-muted">Fondo de esta conversación</p>
      <div className="grid grid-cols-5 gap-2">
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label="Sin fondo"
          title="Sin fondo"
          aria-pressed={current === null}
          className={clsx(
            "grid h-10 place-items-center rounded-xl border text-faint transition-colors",
            current === null ? "border-accent text-accent-strong" : "border-border hover:border-accent/40",
          )}
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
        </button>
        {CHAT_WALLPAPERS.map((paper) => (
          <button
            key={paper.id}
            type="button"
            onClick={() => onPick(paper.id)}
            aria-label={paper.name}
            title={paper.name}
            aria-pressed={current === paper.id}
            className={clsx(
              "grid h-10 place-items-center rounded-xl border transition-colors",
              current === paper.id ? "border-accent" : "border-border hover:border-accent/40",
            )}
            style={{ background: chatWallpaperBackground(paper, resolved === "dark") }}
          >
            {current === paper.id && <Check className="h-4 w-4 text-accent-strong" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Solo lo ves tú: cada uno elige el suyo.</p>
    </div>
  );
}
