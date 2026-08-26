import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ContentWidth = "normal" | "wide" | "full";

const STORAGE = "dayly.contentWidth";

function parseWidth(raw: string | null): ContentWidth {
  if (raw === "wide" || raw === "full") return raw;
  return "normal";
}

function readSaved(): ContentWidth {
  if (typeof localStorage === "undefined") return "normal";
  return parseWidth(localStorage.getItem(STORAGE));
}

function paint(width: ContentWidth) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-content-width", width);
  localStorage.setItem(STORAGE, width);
}

paint(readSaved());

const Ctx = createContext<{ width: ContentWidth; setWidth: (w: ContentWidth) => void } | null>(null);

export function ContentWidthProvider({ children }: { children: ReactNode }) {
  const [width, setWidthState] = useState<ContentWidth>(readSaved);
  const setWidth = useCallback((w: ContentWidth) => {
    paint(w);
    setWidthState(w);
  }, []);
  return <Ctx.Provider value={{ width, setWidth }}>{children}</Ctx.Provider>;
}

export function useContentWidth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContentWidth must be used within ContentWidthProvider");
  return ctx;
}
