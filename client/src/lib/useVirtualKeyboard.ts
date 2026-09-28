import { useEffect, useState } from "react";

/** Below this the shrink is a toolbar, not a keyboard. */
const KEYBOARD_MIN_PX = 160;

/**
 * True while the on-screen keyboard covers part of the viewport.
 *
 * The baseline is the tallest viewport seen since load, not `innerHeight`:
 * with `interactive-widget=resizes-content` the keyboard shrinks the layout
 * viewport too, so comparing the two would always read zero.
 *
 * It also publishes `data-keyboard` and `--keyboard-inset` on the root, so
 * the layout can give back the space the hidden bottom bar was holding.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let baseline = viewport.height;
    let width = viewport.width;

    const read = () => {
      // A rotation or a desktop resize is a new screen, not a keyboard.
      if (viewport.width !== width) {
        width = viewport.width;
        baseline = viewport.height;
      }
      baseline = Math.max(baseline, viewport.height);
      const inset = baseline - viewport.height;
      const isOpen = inset > KEYBOARD_MIN_PX;
      root.style.setProperty("--keyboard-inset", `${isOpen ? Math.round(inset) : 0}px`);
      if (isOpen) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
      setOpen(isOpen);
    };

    read();
    viewport.addEventListener("resize", read);
    viewport.addEventListener("scroll", read);
    return () => {
      viewport.removeEventListener("resize", read);
      viewport.removeEventListener("scroll", read);
      root.style.removeProperty("--keyboard-inset");
      delete root.dataset.keyboard;
    };
  }, []);

  return open;
}
