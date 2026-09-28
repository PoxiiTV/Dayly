import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronDown, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ChatThread } from "@/components/chat/ChatThread";
import { NickText } from "@/components/NickText";
import { Avatar } from "@/components/ui";
import { isChatGifPopoverTarget } from "@/components/chat/ChatGifBrowser";
import { conversationKey, useChatConversations, useChatIdentity, useStoredChatConversationSelection } from "@/lib/chatConversations";

const SELECTED_KEY = "dayly.chat.sidebar.conversation";

/** A compact real chat for the sidebar, with the same thread and composer as /chat. */
export function ChatSidebarWidget({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { conversations, isLoading: loading } = useChatConversations();
  const identity = useChatIdentity();
  const { selectedKey, selected, choose: chooseConversation } = useStoredChatConversationSelection(conversations, SELECTED_KEY);

  const choose = (key: string) => {
    chooseConversation(key);
    setPickerOpen(false);
    window.requestAnimationFrame(() => pickerButtonRef.current?.focus());
  };
  const closeCollapsedPanel = () => {
    setOpen(false);
    setPickerOpen(false);
  };
  const unreadCount = conversations.reduce((total, conv) => total + conv.unreadCount, 0);

  useEffect(() => {
    if (!pickerOpen) return;
    const selectedIndex = Math.max(0, conversations.findIndex((conv) => conversationKey(conv) === selectedKey));
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerButtonRef.current?.contains(target) || pickerRef.current?.contains(target)) return;
      setPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPickerOpen(false);
      pickerButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [conversations, pickerOpen, selectedKey]);

  const movePickerFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = optionRefs.current.filter((option): option is HTMLButtonElement => Boolean(option));
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
          ? (current + 1 + options.length) % options.length
          : (current - 1 + options.length) % options.length;
    options[next]?.focus();
  };

  useEffect(() => {
    if (!collapsed || !open) return;
    const position = () => {
      const launcher = launcherRef.current?.getBoundingClientRect();
      if (!launcher) return;
      const panelWidth = Math.min(352, Math.max(260, window.innerWidth - 96));
      const panelHeight = Math.min(470, Math.max(300, window.innerHeight - 16));
      setPopupPos({
        top: Math.min(Math.max(8, launcher.top), Math.max(8, window.innerHeight - panelHeight - 8)),
        left: Math.min(launcher.right + 8, Math.max(8, window.innerWidth - panelWidth - 8)),
      });
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (isChatGifPopoverTarget(event.target)) return;
      if (launcherRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      closeCollapsedPanel();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isChatGifPopoverTarget(event.target)) closeCollapsedPanel();
    };
    position();
    window.addEventListener("resize", position);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [collapsed, open]);

  const panel = (
    <section className="relative mt-3 mb-1 w-full rounded-xl border border-border bg-elevated shadow-soft" aria-label="Chat fijado">
      <div className="relative z-20 flex items-center gap-2 border-b border-border bg-elevated px-2.5 py-1.5">
        <div className="relative min-w-0 flex-1">
          <button
            ref={pickerButtonRef}
            type="button"
            onClick={() => setPickerOpen((value) => !value)}
            disabled={loading || conversations.length === 0}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-1.5 pr-7 text-left outline-none transition-colors hover:border-accent/60 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
            aria-label="Elegir conversación"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            aria-controls="chat-sidebar-conversation-menu"
          >
            {selected ? (
              <>
                <Avatar name={selected.title} src={selected.avatarUrl} size={24} />
                <NickText
                  name={selected.title}
                  color={selected.titleColor}
                  bold={selected.titleBold}
                  segments={selected.titleSegments}
                  className="min-w-0 flex-1 truncate text-xs"
                />
                {selected.unreadCount > 0 && (
                  <span className="grid min-h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white">
                    {selected.unreadCount > 99 ? "99+" : selected.unreadCount}
                  </span>
                )}
              </>
            ) : (
              <span className="truncate px-1 text-xs text-muted">{loading ? "Cargando chats…" : "Sin conversaciones"}</span>
            )}
          </button>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
          {pickerOpen && (
            <div
              ref={pickerRef}
              id="chat-sidebar-conversation-menu"
              role="menu"
              aria-label="Conversaciones"
              onKeyDown={movePickerFocus}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop"
            >
              {conversations.map((conv, index) => {
                const key = conversationKey(conv);
                const active = key === selectedKey;
                return (
                  <button
                    key={key}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => choose(key)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg focus-visible:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Avatar name={conv.title} src={conv.avatarUrl} size={28} />
                    <NickText
                      name={conv.title}
                      color={conv.titleColor}
                      bold={conv.titleBold}
                      segments={conv.titleSegments}
                      className="min-w-0 flex-1 truncate text-xs"
                    />
                    {conv.kind === "group" && <span className="shrink-0 text-[10px] text-faint">Grupo</span>}
                    {conv.unreadCount > 0 && (
                      <span className="grid min-h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white">
                        {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Link
          to={selected ? `/chat?${selected.kind === "group" ? "g" : "t"}=${encodeURIComponent(selected.id)}` : "/chat"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Abrir chat completo"
          title="Abrir chat completo"
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {selected ? (
        <div className="relative z-0 h-72 min-h-0 overflow-hidden rounded-b-xl">
          <ChatThread
            conv={selected}
            meId={user?.id ?? ""}
            textScale={0.8125}
            compactComposer
            gifsAvailable={identity.data?.gifsAvailable ?? false}
          />
        </div>
      ) : (
        <div className="grid min-h-24 place-items-center px-3 py-4 text-center text-xs text-muted">
          <div>
            <p>No hay conversaciones todavía.</p>
            <Link to="/chat" className="mt-1 inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
              Abrir chat <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </section>
  );

  if (!collapsed) return panel;
  return (
    <div className="relative flex justify-center py-1.5">
      <button
        ref={launcherRef}
        type="button"
        className="relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        aria-expanded={open}
        aria-controls="chat-sidebar-panel"
        aria-label={unreadCount > 0 ? `Abrir chat fijado, ${unreadCount} sin leer` : "Abrir chat fijado"}
        title="Chat fijado"
        onClick={() => {
          if (open) closeCollapsedPanel();
          else setOpen(true);
        }}
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && popupPos && createPortal(
        <div
          ref={popupRef}
          id="chat-sidebar-panel"
          className="pointer-events-auto fixed z-[76] w-[min(22rem,calc(100vw-6rem))]"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          {panel}
        </div>,
        document.body,
      )}
    </div>
  );
}
