import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

const MOUSE_THRESHOLD = 6;
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP = 8;
const SWAP_COOLDOWN_MS = 90;
const MOVE_MS = 220;
const DROP_MS = 200;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EDGE = 72;

type Pending = { id: string; x: number; y: number; touch: boolean; timer: number | null };
type Lift = { id: string; width: number; height: number; dx: number; dy: number };
type Drag = { id: string; origin: string[]; dx: number; dy: number; dropping: boolean };

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Board whose cards can be dragged into a new order. The card lifts and
 * follows the pointer, a dashed slot shows where it will land, the other
 * cards glide out of the way and, on release, it settles into the slot.
 * With a mouse the drag starts after a few pixels; on touch after a short
 * hold, so a normal swipe still scrolls. Escape cancels. The click that
 * ends a drag never opens the card.
 */
export function SortableBoard<T extends { id: string }>({ items, render, onReorder, className }: {
  items: T[];
  render: (item: T) => ReactNode;
  onReorder: (ids: string[]) => void;
  className?: string;
}) {
  const [dragItems, setDragItems] = useState<T[] | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const shown = dragItems ?? items;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pending = useRef<Pending | null>(null);
  const active = useRef<Drag | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const lastSwap = useRef(0);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const startRef = useRef<(id: string, x: number, y: number) => void>(() => {});
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const slot = (id: string) => rootRef.current?.querySelector<HTMLElement>(`[data-board-id="${CSS.escape(id)}"]`) ?? null;

  const placeFloat = (x: number, y: number) => {
    const drag = active.current;
    const el = floatRef.current;
    if (!drag || !el || drag.dropping) return;
    el.style.transform = `translate3d(${x - drag.dx}px, ${y - drag.dy}px, 0) rotate(1.5deg) scale(1.03)`;
  };

  // Cards that changed place glide from where they were (FLIP).
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = null;
    if (!previous || reducedMotion()) return;
    rootRef.current?.querySelectorAll<HTMLElement>("[data-board-id]").forEach((el) => {
      const was = previous.get(el.dataset.boardId!);
      if (!was) return;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: MOVE_MS, easing: EASE });
    });
  }, [dragItems]);

  useLayoutEffect(() => {
    if (lift) placeFloat(pointer.current.x, pointer.current.y);
  }, [lift]);

  useEffect(() => {
    let scrollFrame = 0;
    const autoScroll = () => {
      scrollFrame = 0;
      if (!active.current || active.current.dropping) return;
      const { y } = pointer.current;
      const speed = y < EDGE ? -(EDGE - y) / 4 : y > window.innerHeight - EDGE ? (y - (window.innerHeight - EDGE)) / 4 : 0;
      if (!speed) return;
      const scroller = scrollParent(rootRef.current);
      if (scroller) scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      scrollFrame = window.requestAnimationFrame(autoScroll);
    };

    const release = () => {
      active.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLift(null);
      setDragItems(null);
    };

    startRef.current = (id, x, y) => {
      const el = slot(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      active.current = { id, origin: itemsRef.current.map((t) => t.id), dx: x - rect.left, dy: y - rect.top, dropping: false };
      pointer.current = { x, y };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      navigator.vibrate?.(15);
      setDragItems(itemsRef.current);
      setLift({ id, width: rect.width, height: rect.height, dx: x - rect.left, dy: y - rect.top });
    };

    const clearPending = () => {
      if (pending.current?.timer) window.clearTimeout(pending.current.timer);
      pending.current = null;
    };

    const swapUnder = (x: number, y: number) => {
      const drag = active.current;
      if (!drag || drag.dropping) return;
      if (performance.now() - lastSwap.current < SWAP_COOLDOWN_MS) return;
      const over = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-board-id]");
      if (!over || !rootRef.current?.contains(over)) return;
      const overId = over.dataset.boardId;
      if (!overId || overId === drag.id) return;
      const list = [...shownRef.current];
      const from = list.findIndex((t) => t.id === drag.id);
      const to = list.findIndex((t) => t.id === overId);
      if (from < 0 || to < 0) return;
      lastSwap.current = performance.now();
      const rects = new Map<string, DOMRect>();
      rootRef.current.querySelectorAll<HTMLElement>("[data-board-id]").forEach((el) => rects.set(el.dataset.boardId!, el.getBoundingClientRect()));
      before.current = rects;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved!);
      setDragItems(list);
    };

    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (p && !active.current) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (p.touch) {
          if (moved > TOUCH_SLOP) clearPending();
          return;
        }
        if (moved < MOUSE_THRESHOLD) return;
        clearPending();
        startRef.current(p.id, p.x, p.y);
      }
      if (!active.current) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      placeFloat(e.clientX, e.clientY);
      swapUnder(e.clientX, e.clientY);
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(autoScroll);
    };

    const onUp = () => {
      clearPending();
      const drag = active.current;
      if (!drag || drag.dropping) return;
      drag.dropping = true;
      // The click that follows the drop must not open the card.
      const block = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
      window.addEventListener("click", block, true);
      window.setTimeout(() => window.removeEventListener("click", block, true), 80);
      const finish = () => {
        const ids = shownRef.current.map((t) => t.id);
        release();
        if (ids.some((id, i) => id !== drag.origin[i])) onReorderRef.current(ids);
      };
      // Settle the floating card into its slot, then hand the order over.
      const target = slot(drag.id)?.getBoundingClientRect();
      const el = floatRef.current;
      if (!target || !el || reducedMotion()) {
        finish();
        return;
      }
      el.style.transition = `transform ${DROP_MS}ms ${EASE}, box-shadow ${DROP_MS}ms ${EASE}`;
      el.style.transform = `translate3d(${target.left}px, ${target.top}px, 0) rotate(0deg) scale(1)`;
      el.style.boxShadow = "0 1px 2px rgb(0 0 0 / 0.08)";
      window.setTimeout(finish, DROP_MS);
    };

    // Escape puts everything back where it was.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && active.current && !active.current.dropping) release();
    };

    // While dragging on touch the page must not scroll, nor open the long-press menu.
    const onTouchMove = (e: TouchEvent) => { if (active.current) e.preventDefault(); };
    const onContextMenu = (e: Event) => {
      if (active.current) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      clearPending();
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("contextmenu", onContextMenu, true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lifted = lift ? shown.find((t) => t.id === lift.id) ?? null : null;

  return (
    <>
      <div ref={rootRef} className={className}>
        {shown.map((item) => {
          const isLifted = lift?.id === item.id;
          return (
            <div
              key={item.id}
              data-board-id={item.id}
              className={clsx(
                "relative min-w-0 [&>*]:h-full",
                isLifted && "rounded-2xl border-2 border-dashed border-accent/50 bg-accent-soft/30 [&>*]:invisible",
              )}
              style={isLifted ? { minHeight: lift.height } : undefined}
              onPointerDown={(e) => {
                if (e.button !== 0 || active.current) return;
                if ((e.target as HTMLElement).closest("button, a, input, textarea, select, label")) return;
                const touch = e.pointerType === "touch";
                const { clientX: x, clientY: y } = e;
                const id = item.id;
                pending.current = {
                  id,
                  x,
                  y,
                  touch,
                  timer: touch
                    ? window.setTimeout(() => {
                      if (pending.current?.id !== id) return;
                      pending.current = null;
                      startRef.current(id, x, y);
                    }, TOUCH_HOLD_MS)
                    : null,
                };
              }}
            >
              {render(item)}
            </div>
          );
        })}
      </div>
      {lift && lifted && createPortal(
        <div
          ref={floatRef}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[95] rounded-2xl bg-elevated [&>*]:h-full"
          style={{
            width: lift.width,
            height: lift.height,
            transformOrigin: `${lift.dx}px ${lift.dy}px`,
            boxShadow: "0 22px 45px -12px rgb(0 0 0 / 0.45), 0 8px 18px -8px rgb(0 0 0 / 0.3)",
            willChange: "transform",
          }}
        >
          {render(lifted)}
        </div>,
        document.body,
      )}
    </>
  );
}
