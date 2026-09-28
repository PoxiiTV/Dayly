import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, CheckCheck, Download, FileText, Minus, Paperclip, Plus, Send, Star, Users, VolumeX, X, Zap } from "lucide-react";
import { http } from "@/lib/api";
import { NickText, SubnickText } from "@/components/NickText";
import { pingTyping, typingLabel, useTypingNames } from "@/lib/chatTyping";
import { Avatar, Button, Spinner, useToast } from "@/components/ui";
import { fmtTime, relativeDay } from "@/lib/dates";
import { useGifFavorites } from "@/lib/chatGifFavorites";
import { StatusDot } from "@/components/chat/StatusDot";
import { ChatGifPopover, reduceChatGifPickerOpen, sendChatGifAndClose } from "@/components/chat/ChatGifBrowser";
import { PhotoZoom } from "@/components/chat/PhotoZoom";
import { senderName, type Conversation } from "@/lib/chatConversation";
import type { ChatFile, ChatGif, ChatMessageItem } from "@/lib/types";

/** Fallback only: messages arrive through the live stream. */
const POLL_MS = 30_000;
/** Same ceiling the server enforces; checking here saves a wasted upload. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** Text size of the conversation, in rem, and where the reader's choice lives. */
const TEXT_SCALE_KEY = "dayly.chatTextScale";
const TEXT_SCALE_MIN = 0.75;
const TEXT_SCALE_MAX = 1.5;
const TEXT_SCALE_STEP = 0.125;

function readTextScale(): number {
  try {
    const stored = Number(localStorage.getItem(TEXT_SCALE_KEY));
    if (Number.isFinite(stored) && stored >= TEXT_SCALE_MIN && stored <= TEXT_SCALE_MAX) return stored;
  } catch { /* private mode */ }
  return 0.875;
}
const BUZZ_COOLDOWN_MS = 10_000;
/** Matches GROUP_BUZZ_COOLDOWN_MS on the server. */
const GROUP_BUZZ_COOLDOWN_MS = 2 * 60_000;

/** An image shows itself; anything else is a card you can save. */
function ChatFileBubble({ file, mine, onView }: { file: ChatFile; mine: boolean; onView: (src: string, alt: string) => void }) {
  const href = `/api/chat/files/${file.transferId}`;
  if (file.image) {
    return (
      <button type="button" onClick={() => onView(href, file.name)} aria-label={`Ampliar ${file.name}`} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <img src={href} alt="" loading="lazy" className="max-h-64 w-full rounded-lg object-contain" />
      </button>
    );
  }
  return (
    <a
      href={href}
      download={file.name}
      className={clsx(
        "flex items-center gap-2 rounded-lg px-1 py-0.5",
        mine ? "text-white" : "text-text",
      )}
    >
      <FileText className="h-6 w-6 shrink-0 opacity-80" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{file.name}</span>
        <span className={clsx("block text-[0.72em]", mine ? "text-white/70" : "text-faint")}>{prettySize(file.size)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
    </a>
  );
}

/** Reader-controlled text size for the conversation, shared with its controls. */
export function useChatTextScale() {
  const [scale, setScale] = useState(readTextScale);
  const step = (direction: 1 | -1) => {
    setScale((current) => {
      const next = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Number((current + direction * TEXT_SCALE_STEP).toFixed(3))));
      try { localStorage.setItem(TEXT_SCALE_KEY, String(next)); } catch { /* private mode */ }
      return next;
    });
  };
  return { scale, step, min: scale <= TEXT_SCALE_MIN, max: scale >= TEXT_SCALE_MAX };
}

/** The two zoom buttons, for the row that also holds block and delete. */
export function ChatTextSizeControls({ scale, step, min, max }: ReturnType<typeof useChatTextScale>) {
  const percent = Math.round((scale / 0.875) * 100);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Tamaño del texto">
      <Button variant="ghost" size="sm" icon onClick={() => step(-1)} disabled={min} title="Texto más pequeño" aria-label="Texto más pequeño">
        <Minus className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="w-10 text-center text-[11px] tabular-nums text-faint" aria-live="polite">{percent}%</span>
      <Button variant="ghost" size="sm" icon onClick={() => step(1)} disabled={max} title="Texto más grande" aria-label="Texto más grande">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function ChatThread({ conv, meId, textScale = 0.875, leading, menu, mediaOpen, onToggleMedia, insertRef, sendGifRef, onAvatarClick, compactComposer = false, gifsAvailable }: {
  /** One-to-one or group, already normalised by the page. */
  conv: Conversation;
  meId: string;
  textScale?: number;
  /** Goes before the avatar: on a phone, the way back to the list. */
  leading?: ReactNode;
  /** The conversation menu, rendered by the page that owns those actions. */
  menu?: ReactNode;
  /** State of the emoji/GIF panel, which lives beside the thread. */
  mediaOpen?: boolean;
  onToggleMedia?: () => void;
  /** Lets the panel drop text into this composer. */
  insertRef?: { current: ((text: string) => void) | null };
  /** And send a GIF straight to the conversation. */
  sendGifRef?: { current: ((gif: ChatGif) => void) | null };
  /** Pressing the picture opens the group's card, when the page offers one. */
  onAvatarClick?: () => void;
  /** Sidebar mode: preserve writing width and omit controls that need the media panel. */
  compactComposer?: boolean;
  /** Whether the GIF provider is configured for this account/instance. */
  gifsAvailable: boolean;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [draft, setDraft] = useState("");
  const [buzzUntil, setBuzzUntil] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const compactGifAnchor = useRef<HTMLSpanElement | null>(null);
  const [compactGifOpen, setCompactGifOpen] = useState(false);
  // Chosen or pasted, waiting for a nod: a stray Ctrl+V must not send itself.
  const [pending, setPending] = useState<{ file: File; preview: string | null } | null>(null);
  const [zoomed, setZoomed] = useState<{ kind: "media"; src: string; alt: string; convId: string } | { kind: "pending" } | null>(null);
  const stickToBottom = useRef(true);
  const typingNames = useTypingNames(conv.id);

  const { data, isLoading } = useQuery({
    queryKey: ["chat-thread", conv.id],
    queryFn: () => http.get<{ messages: ChatMessageItem[] }>(`${conv.basePath}/messages`),
    refetchInterval: () => (document.visibilityState === "visible" ? POLL_MS : false),
    refetchIntervalInBackground: false,
    enabled: !conv.blocked,
  });
  const messages = data?.messages ?? [];

  // Each staged image owns its blob URL until it is replaced or this thread unmounts.
  useEffect(() => () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
  }, [pending?.preview]);

  // Mark as read whenever the thread is open and something arrives.
  useEffect(() => {
    if (conv.blocked) return;
    void http.post(`${conv.basePath}/read`, {}).then(() => {
      void qc.invalidateQueries({ queryKey: ["chat-friends"] });
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
    });
  }, [conv.basePath, conv.blocked, messages.length, qc]);

  // Opening a conversation always starts at the newest message, whatever the
  // reader had been doing in the previous one.
  useEffect(() => { stickToBottom.current = true; }, [conv.id]);

  /**
   * Keep the view pinned to the newest message unless the reader scrolled up.
   *
   * A single scroll after render lands short: images and GIFs have no height
   * until they load, the composer grows with the draft, and the web font
   * settles a frame later. Watching the content's own size covers all three.
   */
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const pin = () => { if (stickToBottom.current) el.scrollTop = el.scrollHeight; };
    pin();
    const observer = new ResizeObserver(pin);
    // The content, for media and new messages; the box itself, for a window
    // that changes size or a composer that grew a line.
    observer.observe(inner);
    observer.observe(el);
    return () => observer.disconnect();
  }, [conv.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  /**
   * Opening a conversation puts the cursor in the composer, so picking someone
   * and typing is one gesture instead of two.
   *
   * Only where there is a real keyboard: on a phone, focusing the field throws
   * the on-screen keyboard over half the conversation before you have read a
   * single message, which is why the messengers people use do not do it there
   * either. `(hover: hover) and (pointer: fine)` is the mouse-or-trackpad test,
   * not a width one, so a small window on a laptop still gets the focus.
   *
   * No effect deps and no timer on purpose: the composer only mounts once the
   * messages have loaded, so a one-shot focus on conversation change lands on
   * a textarea that is not there yet. This runs on every render and fires the
   * first time the field actually exists for this conversation.
   */
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (focusedFor.current === conv.id) return;
    if (conv.blocked) return;
    const field = input.current;
    if (!field) return;
    const hasKeyboard = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
    if (!hasKeyboard) {
      focusedFor.current = conv.id;
      return;
    }
    focusedFor.current = conv.id;
    field.focus({ preventScroll: true });
  });

  const sendMessage = useMutation({
    mutationFn: (payload: { body: string } | { gif: ChatGif }) =>
      http.post(`${conv.basePath}/messages`, { ...payload, clientId: crypto.randomUUID() }),
    onSuccess: () => {
      setDraft("");
      stickToBottom.current = true;
      void qc.invalidateQueries({ queryKey: ["chat-thread", conv.id] });
      void qc.invalidateQueries({ queryKey: ["chat-friends"] });
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo enviar."),
  });

  const compactGifPopoverId = `chat-gif-popover-${conv.kind}-${conv.id}`;
  const closeCompactGif = useCallback(() => {
    setCompactGifOpen((current) => reduceChatGifPickerOpen(current, "close"));
    window.requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }, []);
  const sendCompactGif = useCallback((gif: ChatGif) => {
    if (sendMessage.isPending) return;
    sendChatGifAndClose(gif, (selected) => sendMessage.mutate({ gif: selected }), closeCompactGif);
  }, [closeCompactGif, sendMessage]);

  useEffect(() => {
    setCompactGifOpen(false);
  }, [conv.id]);

  // A group buzz rattles everyone at once, so its cooldown is far longer than
  // the one-to-one one; the button greys out for the same stretch.
  const buzzCooldownMs = conv.kind === "group" ? GROUP_BUZZ_COOLDOWN_MS : BUZZ_COOLDOWN_MS;
  const buzz = useMutation({
    mutationFn: () => http.post(`${conv.basePath}/buzz`),
    onSuccess: () => {
      setBuzzUntil(Date.now() + buzzCooldownMs);
      void qc.invalidateQueries({ queryKey: ["chat-thread", conv.id] });
    },
    onError: () => {
      setBuzzUntil(Date.now() + buzzCooldownMs);
      push("info", conv.kind === "group"
        ? "Ya has zumbado al grupo hace poco. Espera un par de minutos."
        : "Espera un momento antes de otro zumbido.");
    },
  });

  /** Drops the emoji where the caret is, not at the end of the draft. */
  const insertEmoji = (emoji: string) => {
    const field = input.current;
    const at = field?.selectionStart ?? draft.length;
    const to = field?.selectionEnd ?? at;
    setDraft(`${draft.slice(0, at)}${emoji}${draft.slice(to)}`);
    window.requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      const caret = at + emoji.length;
      field.setSelectionRange(caret, caret);
    });
  };

  // The panel is a sibling, so it needs a way in to this composer.
  useEffect(() => {
    if (insertRef) insertRef.current = insertEmoji;
    if (sendGifRef) sendGifRef.current = (gif: ChatGif) => sendMessage.mutate({ gif });
    return () => {
      if (insertRef) insertRef.current = null;
      if (sendGifRef) sendGifRef.current = null;
    };
  });

  const sendFile = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return http.postForm(`${conv.basePath}/files`, form);
    },
    onSuccess: () => {
      clearPending();
      stickToBottom.current = true;
      void qc.invalidateQueries({ queryKey: ["chat-thread", conv.id] });
      void qc.invalidateQueries({ queryKey: ["chat-friends"] });
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo enviar el archivo."),
  });

  const clearPending = () => {
    setPending(null);
    setZoomed((current) => current?.kind === "pending" ? null : current);
  };

  const stage = (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      push("error", "El archivo pesa más de 5 MB.");
      return;
    }
    setPending({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    setZoomed((current) => current?.kind === "pending" ? null : current);
  };

  const submit = () => {
    const body = draft.trim();
    if (!body || sendMessage.isPending) return;
    sendMessage.mutate({ body });
  };

  /** One line, or as many as were typed, up to the cap. */
  const fitComposer = () => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  };

  // After sending, the draft is empty but the inline height is not.
  useEffect(fitComposer, [draft]);

  const seenAt = conv.otherReadAt ? new Date(conv.otherReadAt) : null;
  // The same star as the picker, so a GIF someone sent you can be kept too.
  const { isSaved, toggle: toggleStar } = useGifFavorites();
  const blocked = conv.blocked;
  const typing = typingLabel(typingNames);
  const buzzDisabled = buzz.isPending || Date.now() < buzzUntil;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!compactComposer && (
        /* Positioned and above the thread: the GIF bubbles carry their own
            star overlay, so they are positioned too and would otherwise be
            painted over this header's menu. The pinned sidebar already shows
            the identity in its conversation selector, so it omits this row. */
        <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-border bg-surface/70 px-2 py-2 backdrop-blur-sm md:gap-3 md:px-4 md:py-3">
          {leading}
          <span className="relative shrink-0">
            {onAvatarClick
              ? (
                <button
                  type="button"
                  onClick={onAvatarClick}
                  className="block rounded-full"
                  aria-label={conv.kind === "group" ? "Ver el grupo" : "Ver el perfil"}
                  title={conv.kind === "group" ? "Ver el grupo" : "Ver el perfil"}
                >
                  <Avatar name={conv.title} src={conv.avatarUrl} size={38} />
                </button>
              )
              : <Avatar name={conv.title} src={conv.avatarUrl} size={38} />}
            {conv.kind === "direct"
              ? <StatusDot status={conv.status} />
              : <span className="absolute -bottom-0.5 -right-0.5 grid h-[14px] w-[14px] place-items-center rounded-full bg-accent text-white ring-2 ring-surface">
                  <Users className="h-2.5 w-2.5" aria-hidden="true" />
                </span>}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">
              <NickText name={conv.title} color={conv.titleColor} segments={conv.titleSegments} bold={conv.titleBold} />
            </p>
            {blocked
              ? <p className="text-xs text-danger">Le has bloqueado</p>
              : typing
                ? <p className="truncate text-[11px] font-medium text-accent">{typing}</p>
                : <>
                    <SubnickText subnick={conv.subnick} className="text-[11px]" />
                    <p className="truncate text-[11px] text-muted">{conv.subtitle}</p>
                  </>}
          </div>
          {conv.muted && <VolumeX className="h-4 w-4 shrink-0 text-faint" aria-label="Silenciada" />}
          {menu}
        </header>
      )}

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.shiftKey && event.code === "KeyZ" && !blocked && conv.canBuzz) {
            event.preventDefault();
            if (!buzzDisabled) buzz.mutate();
          }
        }}
        // overscroll-contain so a touch flick scrolls the thread instead of
        // handing the gesture to the page behind it.
        // Everything inside sizes itself in `em`, so one font-size here scales
        // the whole conversation without touching the rest of the app.
        style={{ fontSize: `${textScale}rem` }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
      <div ref={content} className="px-4 py-3 space-y-2">
        {isLoading && <div className="grid place-items-center py-8 text-accent"><Spinner /></div>}
        {!isLoading && messages.length === 0 && (
          <p className="py-8 text-center text-faint">Aún no hay mensajes. Saluda.</p>
        )}
        {messages.map((message, index) => {
          const mine = message.senderId === meId;
          const previous = messages[index - 1];
          const newDay = !previous || relativeDay(new Date(previous.createdAt)) !== relativeDay(new Date(message.createdAt));
          const media = Boolean(message.gif || message.file?.image);
          return (
            <div key={message.id}>
              {newDay && (
                <p className="py-2 text-center text-[0.8em] uppercase tracking-wide text-faint">
                  {relativeDay(new Date(message.createdAt))}
                </p>
              )}
              {message.kind === "BUZZ" ? (
                <p className={clsx("text-center text-[0.85em] font-medium text-warn")}>
                  <Zap className="mr-1 inline h-[1em] w-[1em]" aria-hidden="true" />
                  {mine ? "Has mandado un zumbido" : `${senderName(conv, message.senderId) ?? conv.title} te ha mandado un zumbido`}
                </p>
              ) : (
                <div className={clsx("flex flex-col", mine ? "items-end" : "items-start")}>
                  {!mine && conv.kind === "group" && (
                    <p className="mb-0.5 max-w-[80%] truncate px-1 text-[0.75em] font-semibold text-muted">
                      {senderName(conv, message.senderId)}
                    </p>
                  )}
                  <div
                    className={clsx(
                      "max-w-[80%] rounded-2xl",
                      // Media wears a hairline frame; only text needs padding.
                      media ? "p-1" : "px-3 py-2",
                      message.gif && "min-w-[10rem]",
                      // Mine in the brand colour, theirs in the sky blue the
                      // app already uses for "normal" priority.
                      mine
                        ? "bg-accent text-white"
                        : "border border-prio-normal/35 bg-prio-normal/15 text-text",
                    )}
                  >
                    {message.file ? (
                      <ChatFileBubble file={message.file} mine={mine} onView={(src, alt) => setZoomed({ kind: "media", src, alt, convId: conv.id })} />
                    ) : message.gif ? (
                      <span className="relative block">
                        <button type="button" onClick={() => setZoomed({ kind: "media", src: message.gif!.url, alt: message.gif!.description ?? "GIF", convId: conv.id })} aria-label={`Ampliar ${message.gif.description ?? "GIF"}`} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
                          <img
                            src={message.gif.url}
                            alt=""
                            width={message.gif.width || undefined}
                            height={message.gif.height || undefined}
                            loading="lazy"
                            className="max-h-64 w-full rounded-lg object-contain"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStar(message.gif!)}
                          aria-pressed={isSaved(message.gif.url)}
                          aria-label={isSaved(message.gif.url) ? "Quitar de favoritos" : "Guardar en favoritos"}
                          title={isSaved(message.gif.url) ? "Quitar de favoritos" : "Guardar en favoritos"}
                          className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white"
                        >
                          <Star
                            className={clsx("h-3.5 w-3.5", isSaved(message.gif.url) && "fill-current text-amber-300")}
                            aria-hidden="true"
                          />
                        </button>
                      </span>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    )}
                    <p className={clsx(
                      "flex items-center gap-1 text-[0.72em] tabular-nums",
                      media ? "px-1 pb-px pt-0.5" : "mt-0.5",
                      mine ? "justify-end text-white/70" : "text-muted",
                    )}>
                      {fmtTime(message.createdAt)}
                      {mine && conv.kind === "direct" && (seenAt && new Date(message.createdAt) <= seenAt
                        ? <CheckCheck className="h-[1.15em] w-[1.15em]" aria-label="Leído" />
                        : <Check className="h-[1.15em] w-[1.15em]" aria-label="Enviado" />)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>

      {blocked ? (
        <p className="border-t border-border px-4 py-3 text-center text-xs text-muted">
          Desbloquéale para volver a escribiros.
        </p>
      ) : (
        <div
          // The floating "+" hangs over the bottom-right corner of the window,
          // and the chat now reaches it: keep the send button clear of it. With
          // the picker open that corner belongs to the picker instead.
          className={clsx(
            "relative shrink-0 border-t border-border bg-surface/70 backdrop-blur-sm",
            compactComposer ? "p-2" : "p-3",
            !compactComposer && !mediaOpen && "md:pr-24",
          )}
        >
          {pending && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-bg p-2">
              {pending.preview
                ? <button type="button" onClick={() => setZoomed({ kind: "pending" })} aria-label={`Ampliar ${pending.file.name}`} className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><img src={pending.preview} alt="" className="h-12 w-12 rounded-lg object-cover" /></button>
                : <FileText className="h-8 w-8 shrink-0 text-muted" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{pending.file.name}</span>
                <span className="block text-[11px] text-faint">{prettySize(pending.file.size)}</span>
              </span>
              <Button size="sm" onClick={() => sendFile.mutate(pending.file)} disabled={sendFile.isPending}>
                {sendFile.isPending ? <Spinner size={16} /> : "Enviar"}
              </Button>
              <Button variant="ghost" size="sm" icon onClick={clearPending} aria-label="Quitar el archivo">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
          <input
            ref={filePicker}
            type="file"
            className="hidden"
            onChange={(event) => {
              stage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {/* Not the `.input` class: that one is a fixed-height box for a single
              line, and the composer has to grow with the text. */}
          <div className="flex items-end gap-1 rounded-xl border border-border bg-surface p-1 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
            {compactComposer && (
              <div className="flex shrink-0 flex-col items-center gap-0.5 pb-0.5">
                <span ref={compactGifAnchor} className="inline-flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    onClick={() => setCompactGifOpen((was) => reduceChatGifPickerOpen(was, "toggle"))}
                    aria-expanded={compactGifOpen}
                    aria-controls={compactGifPopoverId}
                    title="Elegir GIF"
                    aria-label="Elegir GIF"
                    className="!h-7 !w-7 !px-0"
                  >
                    <span className="text-[9px] font-extrabold leading-none tracking-tight" aria-hidden="true">GIF</span>
                  </Button>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  onClick={() => filePicker.current?.click()}
                  title="Adjuntar archivo (máx. 5 MB)"
                  aria-label="Adjuntar archivo"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            <div className={clsx("relative min-w-0 flex-1", compactComposer && "flex min-h-[3.75rem] items-center")}>
              <textarea
                ref={input}
                className={clsx(
                  "max-h-40 min-h-[2.25rem] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-text placeholder:text-faint focus:outline-none focus:ring-0",
                  compactComposer && "pr-10",
                )}
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  // Only while there is something written: clearing the box with
                  // backspace should not announce that you are typing.
                  if (event.target.value.trim()) pingTyping(conv.basePath);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (pending) sendFile.mutate(pending.file);
                    else submit();
                  }
                }}
                onPaste={(event) => {
                  // Ctrl+V with a screenshot in the clipboard: stage it instead
                  // of pasting a filename into the text.
                  const file = Array.from(event.clipboardData?.files ?? [])[0];
                  if (!file) return;
                  event.preventDefault();
                  stage(file);
                }}
                placeholder="Escribe un mensaje…"
                aria-label="Mensaje"
              />
              {compactComposer && (
                <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                  {conv.canBuzz && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      className="!h-7 !w-7"
                      onClick={() => buzz.mutate()}
                      disabled={buzzDisabled}
                      title={conv.kind === "group" ? "Zumbar al grupo (Ctrl+Shift+Z) · una vez cada 2 min" : "Zumbido (Ctrl+Shift+Z)"}
                      aria-label={conv.kind === "group" ? "Zumbar a todo el grupo" : "Enviar un zumbido"}
                    >
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon
                    className="!h-7 !w-7"
                    onClick={submit}
                    disabled={!draft.trim() || sendMessage.isPending}
                    aria-label="Enviar"
                    title="Enviar (Intro)"
                  >
                    {sendMessage.isPending ? <Spinner size={14} /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                </div>
              )}
            </div>
            {!compactComposer && (
              /* All in one row inside the full chat: attach, GIF, buzz and send. */
              <div className="flex shrink-0 items-center gap-0.5 pb-0.5 pr-0.5">
              <Button
                variant="ghost"
                size="sm"
                icon
                onClick={() => filePicker.current?.click()}
                title="Adjuntar archivo (máx. 5 MB)"
                aria-label="Adjuntar archivo"
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon
                onClick={() => onToggleMedia?.()}
                aria-expanded={mediaOpen}
                aria-controls="chat-media-panel"
                title="GIF y emoticonos"
                aria-label="GIF y emoticonos"
              >
                <span className="text-[10px] font-extrabold leading-none tracking-tight" aria-hidden="true">GIF</span>
              </Button>
              {conv.canBuzz && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  onClick={() => buzz.mutate()}
                  disabled={buzzDisabled}
                  title={conv.kind === "group" ? "Zumbar al grupo (Ctrl+Shift+Z) · una vez cada 2 min" : "Zumbido (Ctrl+Shift+Z)"}
                  aria-label={conv.kind === "group" ? "Zumbar a todo el grupo" : "Enviar un zumbido"}
                >
                  <Zap className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                size="sm"
                icon
                onClick={submit}
                disabled={!draft.trim() || sendMessage.isPending}
                aria-label="Enviar"
                title="Enviar (Intro)"
              >
                {sendMessage.isPending ? <Spinner size={16} /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </Button>
              </div>
            )}
          </div>
          {!compactComposer && <p className="mt-1 hidden px-1 text-[11px] text-faint md:block">Intro envía · Mayús+Intro salta de línea</p>}
        </div>
      )}
      {compactComposer && (
        <ChatGifPopover
          id={compactGifPopoverId}
          open={compactGifOpen}
          anchorRef={compactGifAnchor}
          gifsAvailable={gifsAvailable}
          onClose={closeCompactGif}
          onSendGif={sendCompactGif}
        />
      )}
      {zoomed?.kind === "media" && zoomed.convId === conv.id && (
        <PhotoZoom src={zoomed.src} alt={zoomed.alt} size="attachment" onClose={() => setZoomed(null)} />
      )}
      {zoomed?.kind === "pending" && pending?.preview && (
        <PhotoZoom src={pending.preview} alt={pending.file.name} size="attachment" onClose={() => setZoomed(null)} />
      )}
    </div>
  );
}
