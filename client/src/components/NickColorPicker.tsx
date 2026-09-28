import { useState } from "react";
import clsx from "clsx";
import { NICK_COLORS } from "@/lib/nickStyles";
import {
  applyColorToRange, segmentsLength, segmentsToText, textToSegments,
  type NickSegment,
} from "@/lib/nickSegments";

/**
 * The colour row, shared by the personal nick and the group name.
 *
 * Two modes in one strip: with nothing selected a colour paints the whole name,
 * and with part of the text selected it paints only that part — which is how a
 * multicoloured nick gets made. The selection comes from the caller's own field
 * because only it knows where the caret is.
 */
export function NickColorPicker({ segments, onChange, selection, bold, onBold }: {
  segments: NickSegment[];
  onChange: (next: NickSegment[]) => void;
  /** Caret range over the plain text, in CODE POINTS. Null when nothing is picked. */
  selection: { start: number; end: number } | null;
  bold?: boolean;
  onBold?: (next: boolean) => void;
}) {
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const hasSelection = Boolean(selection && selection.end > selection.start);
  const length = segmentsLength(segments);

  const paint = (color: string | null) => {
    setLastUsed(color);
    if (!length) return;
    const range = hasSelection && selection
      ? selection
      : { start: 0, end: length };
    onChange(applyColorToRange(segments.length ? segments : textToSegments(segmentsToText(segments)), range.start, range.end, color));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label mb-0">Color</span>
        <span className="text-xs text-muted">
          {hasSelection ? "Se pinta lo seleccionado" : "Selecciona parte del texto para pintar solo ese trozo"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => paint(null)}
          aria-label="Quitar el color"
          className={clsx("chip chip-sm border", lastUsed === null ? "border-accent text-accent bg-accent/10" : "border-border text-muted")}
        >
          Sin color
        </button>
        {NICK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => paint(c)}
            aria-label={`Color ${c}`}
            className={clsx(
              "w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
              lastUsed === c ? "border-text scale-110" : "border-transparent",
            )}
            style={{ background: c }}
          />
        ))}
        {onBold && (
          <button
            type="button"
            onClick={() => onBold(!bold)}
            aria-pressed={bold}
            className={clsx("chip chip-sm border font-bold", bold ? "border-accent text-accent bg-accent/10" : "border-border text-muted")}
          >
            Negrita
          </button>
        )}
      </div>
    </div>
  );
}
