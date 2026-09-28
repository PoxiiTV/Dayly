import { useState } from "react";
import clsx from "clsx";
import { Smile, X } from "lucide-react";
import { Button } from "@/components/ui";
import { ChatGifBrowser } from "@/components/chat/ChatGifBrowser";
import type { ChatGif } from "@/lib/types";

/**
 * The usual suspects, grouped the way people look for them. A fixed list beats
 * a full emoji database here: a few hundred bytes instead of a megabyte, and it
 * covers what a chat actually uses.
 */
const GROUPS: { name: string; emojis: string[] }[] = [
  {
    name: "Caras",
    emojis: ["😀", "😃", "😄", "😁", "😅", "🤣", "😂", "🙂", "😉", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳", "🤔", "🤨", "😐", "😏", "😴", "😪", "😭", "😢", "😤", "😡", "🥺", "😱", "🤯", "😬", "🙄", "😷", "🤒", "🤢", "🥶", "🥵"],
  },
  {
    name: "Gestos",
    emojis: ["👍", "👎", "👌", "🤌", "✌️", "🤞", "🤝", "👏", "🙌", "🙏", "💪", "👋", "🤙", "☝️", "✋", "🖐️", "🤟", "👉", "👈", "🫶"],
  },
  {
    name: "Corazones",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💞", "💖", "💗", "💓", "💘"],
  },
  {
    name: "Cosas",
    emojis: ["🔥", "✨", "🎉", "🎂", "🎁", "⭐", "🌟", "💡", "✅", "❌", "⚡", "☕", "🍺", "🍻", "🍕", "🍔", "🎵", "🎮", "⚽", "🏆", "🚀", "💰", "📅", "⏰", "📌", "💻", "📱", "🏠", "🚗", "☀️", "🌙", "🌧️", "❄️", "🐶", "🐱", "🌹"],
  },
];

type Tab = "emoji" | "gif";

/**
 * The panel that lives to the right of the conversation, the way Telegram
 * docks its emoji and GIF picker.
 *
 * It only closes when the user closes it: sending is something you do several
 * times in a row, and having the panel vanish after each one is maddening.
 */
export function ChatMediaPanel({ onPick, onSendGif, gifsAvailable, onClose, className, id }: {
  onPick: (emoji: string) => void;
  onSendGif: (gif: ChatGif) => void;
  /** False when no provider key is configured for the instance. */
  gifsAvailable: boolean;
  onClose: () => void;
  /** Placement inside the chat grid. */
  className?: string;
  id?: string;
}) {
  // GIFs first: it is what the button next to the composer is reached for.
  const [tab, setTab] = useState<Tab>("gif");

  return (
    <aside
      id={id}
      className={clsx("flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border bg-surface", className)}
      aria-label="GIF y emoticonos"
    >
      <div className="flex items-center gap-1 border-b border-border p-2" role="tablist" aria-label="Contenido multimedia">
        <TabButton label="GIF" active={tab === "gif"} onClick={() => setTab("gif")}>
          <span className="text-[10px] font-extrabold leading-none tracking-tight" aria-hidden="true">GIF</span>
        </TabButton>
        <TabButton label="Emojis" active={tab === "emoji"} onClick={() => setTab("emoji")}>
          <Smile className="h-4 w-4" aria-hidden="true" />
          Emojis
        </TabButton>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Cerrar panel" title="Cerrar">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {tab === "emoji" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {GROUPS.map((group) => (
            <section key={group.name} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{group.name}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onPick(emoji)}
                    aria-label={emoji}
                    className="grid h-8 place-items-center rounded-lg text-lg transition-colors hover:bg-bg"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <ChatGifBrowser gifsAvailable={gifsAvailable} onSendGif={onSendGif} />
      )}
    </aside>
  );
}

function TabButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-label={active ? `${label}, seleccionado` : label}
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-bg",
      )}
    >
      {children}
    </button>
  );
}
