import { useRef } from "react";

import { retextSegments, segmentsToText, type NickSegment } from "@/lib/nickSegments";

/**
 * The text box for a nick or a group name.
 *
 * It shows the plain text but edits the coloured pieces underneath, and reports
 * the selection in CODE POINTS, which is what the colour picker needs: a caret
 * offset in UTF-16 units would land in the middle of the astral letters the
 * fancy alphabets are made of.
 */
export function NickField({ segments, onChange, onSelection, placeholder, ariaLabel }: {
  segments: NickSegment[];
  onChange: (next: NickSegment[]) => void;
  onSelection: (range: { start: number; end: number } | null) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const text = segmentsToText(segments);

  /** UTF-16 offset as the browser reports it → index in code points. */
  const toCodePoints = (value: string, offset: number) => Array.from(value.slice(0, offset)).length;

  const report = () => {
    const field = ref.current;
    if (!field) return;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    if (end <= start) { onSelection(null); return; }
    onSelection({ start: toCodePoints(field.value, start), end: toCodePoints(field.value, end) });
  };

  return (
    <input
      ref={ref}
      value={text}
      onChange={(event) => onChange(retextSegments(segments, event.target.value))}
      onSelect={report}
      onKeyUp={report}
      onMouseUp={report}
      onBlur={() => { /* keep the last selection so a colour click can use it */ }}
      placeholder={placeholder}
      className="input w-full"
      aria-label={ariaLabel}
    />
  );
}
