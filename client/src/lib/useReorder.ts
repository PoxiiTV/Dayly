import { useCallback, useRef, useState } from "react";

/** Pixels before a press counts as a drag and not as a click. */
const THRESHOLD = 4;

export type ReorderItemProps = {
  "data-reorder-id": string;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
};

/**
 * Reordering a list by dragging, on pointer events instead of HTML5
 * drag-and-drop.
 *
 * The native API is the obvious choice and the wrong one here: WebView2 hands
 * drags to the host window unless the wrapper opts out, and a link inside the
 * draggable element steals the gesture in several browsers. Pointer events
 * behave the same everywhere, in the app and on the web.
 *
 * Mouse and pen only: on a touch screen the same gesture is how you scroll.
 */
export function useReorder(onMove: (fromId: string, toId: string) => void): {
  dragging: string | null;
  over: string | null;
  itemProps: (id: string) => ReorderItemProps;
} {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const origin = useRef<{ id: string; x: number; y: number } | null>(null);
  const active = useRef(false);
  const target = useRef<string | null>(null);

  const finish = useCallback(() => {
    const from = origin.current?.id;
    const to = target.current;
    if (active.current && from && to && from !== to) onMove(from, to);
    origin.current = null;
    target.current = null;
    setDragging(null);
    setOver(null);
  }, [onMove]);

  const itemProps = useCallback((id: string): ReorderItemProps => ({
    "data-reorder-id": id,
    onPointerDown: (event) => {
      if (event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return;
      origin.current = { id, x: event.clientX, y: event.clientY };
      active.current = false;
    },
    onPointerMove: (event) => {
      const from = origin.current;
      if (!from) return;
      if (!active.current) {
        const far = Math.abs(event.clientX - from.x) > THRESHOLD || Math.abs(event.clientY - from.y) > THRESHOLD;
        if (!far) return;
        active.current = true;
        setDragging(from.id);
        // Capture so the moves keep coming even over the neighbours.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const row = under?.closest?.("[data-reorder-id]") as HTMLElement | null;
      const id = row?.dataset.reorderId ?? null;
      target.current = id && id !== from.id ? id : null;
      setOver(target.current);
    },
    onPointerUp: () => finish(),
    onPointerCancel: () => {
      origin.current = null;
      target.current = null;
      active.current = false;
      setDragging(null);
      setOver(null);
    },
    onClickCapture: (event) => {
      // The press that ended a drag must not also open the section.
      if (!active.current) return;
      active.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  }), [finish]);

  return { dragging, over, itemProps };
}
