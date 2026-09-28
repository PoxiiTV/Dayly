import { useState } from "react";

/**
 * How much room the chat takes: the whole window, or a card inside the page
 * like every other section. A screen-shaped choice, so it lives on the device
 * that has that screen — the same as the reading size of the conversation.
 */
export type ChatLayout = "full" | "compact";

const STORAGE = "dayly.chat.layout";

function parse(raw: string | null): ChatLayout {
  return raw === "compact" ? "compact" : "full";
}

function readSaved(): ChatLayout {
  try { return parse(localStorage.getItem(STORAGE)); } catch { return "full"; }
}

/** The attribute the stylesheet reads; the class list stays out of it. */
function paint(layout: ChatLayout): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-chat-layout", layout);
  try { localStorage.setItem(STORAGE, layout); } catch { /* private mode */ }
}

// Before the first paint, so the chat never flashes in the other shape.
paint(readSaved());

export function useChatLayout() {
  const [layout, setLayoutState] = useState<ChatLayout>(readSaved);
  return {
    layout,
    setLayout: (next: ChatLayout) => {
      paint(next);
      setLayoutState(next);
    },
  };
}
