import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search, Star, X } from "lucide-react";
import { http } from "@/lib/api";
import { Button, Input, Spinner } from "@/components/ui";
import { useGifFavorites } from "@/lib/chatGifFavorites";
import type { ChatGif } from "@/lib/types";

export const CHAT_GIF_POPOVER_SELECTOR = "[data-chat-gif-popover]";

/** Small shared contracts keep compact-picker interactions easy to verify. */
export function reduceChatGifPickerOpen(open: boolean, action: "toggle" | "close"): boolean {
  return action === "toggle" ? !open : false;
}

export function sendChatGifAndClose(
  gif: ChatGif,
  onSendGif: (gif: ChatGif) => void,
  onClose: () => void,
): void {
  onSendGif(gif);
  onClose();
}

/** Keyboard-generated clicks have detail 0; a GIF is sent only by a pointer click. */
export function sendChatGifOnPointerClick(
  event: { detail: number; currentTarget: Pick<HTMLButtonElement, "blur"> },
  gif: ChatGif,
  onSend: (gif: ChatGif) => void,
): void {
  if (event.detail < 1) return;
  event.currentTarget.blur();
  onSend(gif);
}

/** Portalled GIF tiles must not look like an outside click to their owner. */
export function isChatGifPopoverTarget(target: EventTarget | null): boolean {
  const candidate = target as (EventTarget & { closest?: (selector: string) => unknown }) | null;
  return Boolean(candidate?.closest?.(CHAT_GIF_POPOVER_SELECTOR));
}

/**
 * GIF-only browsing surface shared by the full media panel and compact chat
 * popovers. Keeping the query and favourites here means both surfaces use the
 * same React Query cache and preserve the same provider/error states.
 */
export function ChatGifBrowser({ gifsAvailable, onSendGif, autoFocus = false }: {
  gifsAvailable: boolean;
  onSendGif: (gif: ChatGif) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const gifs = useQuery({
    queryKey: ["chat-gifs", debounced],
    queryFn: () => http.get<{ results: ChatGif[]; blockedHosts?: boolean }>(`/api/chat/gifs${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`),
    enabled: gifsAvailable,
    staleTime: 5 * 60_000,
  });
  const { favorites, isSaved, toggle: toggleStar } = useGifFavorites();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
        <Input
          dense
          autoFocus={autoFocus}
          disabled={!gifsAvailable}
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar GIF…"
          aria-label="Buscar GIF"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {!debounced && favorites.length > 0 && (
          <GifGrid
            title="Favoritos"
            gifs={favorites}
            isSaved={isSaved}
            onSend={onSendGif}
            onToggleStar={toggleStar}
          />
        )}

        {!gifsAvailable ? (
          <div className="p-5 text-center">
            <p className="text-sm font-medium text-text">Buscador de GIF sin configurar</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Falta la clave del proveedor en el panel de administración. Tus favoritos siguen aquí.
            </p>
          </div>
        ) : gifs.isLoading ? (
          <div className="grid place-items-center py-8 text-accent"><Spinner /></div>
        ) : gifs.isError ? (
          <p className="p-5 text-center text-xs text-muted">No se pudo buscar ahora mismo.</p>
        ) : (
          <>
            <GifGrid
              title={debounced ? undefined : "Tendencias"}
              gifs={gifs.data?.results ?? []}
              isSaved={isSaved}
              onSend={onSendGif}
              onToggleStar={toggleStar}
            />
            {(gifs.data?.results.length ?? 0) === 0 && (
              <p className="p-5 text-center text-xs text-faint">
                {gifs.data?.blockedHosts
                  ? "El proveedor ha respondido desde un dominio no permitido."
                  : "Sin resultados."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A viewport-bound GIF-only popover for compact composers. It is portalled to
 * the document so a narrow sidebar cannot create its own scroll or clip the
 * picker at the column boundary.
 */
export function ChatGifPopover({ id, open, anchorRef, gifsAvailable, onClose, onSendGif }: {
  id: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  gifsAvailable: boolean;
  onClose: () => void;
  onSendGif: (gif: ChatGif) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(1, Math.min(360, window.innerWidth - 16));
      const height = Math.max(1, Math.min(460, window.innerHeight - 24));
      const right = window.innerWidth - width - 8;
      const below = rect.bottom + 8;
      const above = rect.top - height - 8;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, above);
      const left = rect.right + 8 + width <= window.innerWidth - 8
        ? rect.right + 8
        : Math.max(8, Math.min(rect.left - width - 8, right));
      setPosition({ top, left, width, height });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || !position) return null;
  return createPortal(
    (
    <div
      ref={popoverRef}
      id={id}
      data-chat-gif-popover="true"
      role="dialog"
      aria-labelledby={titleId}
      className="pointer-events-auto fixed z-[90] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-pop"
      style={position}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p id={titleId} className="text-sm font-semibold text-text">Elegir GIF</p>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Cerrar selector de GIF" title="Cerrar">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <ChatGifBrowser gifsAvailable={gifsAvailable} onSendGif={onSendGif} autoFocus />
    </div>
    ),
    document.body,
  );
}

/** The grid of tiles, with the star that saves each one. */
function GifGrid({ title, gifs, isSaved, onSend, onToggleStar }: {
  title?: string;
  gifs: ChatGif[];
  isSaved: (url: string) => boolean;
  onSend: (gif: ChatGif) => void;
  onToggleStar: (gif: ChatGif) => void;
}) {
  if (gifs.length === 0) return null;
  return (
    <section className="mb-2">
      {title && <p className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</p>}
      <div className="columns-2 gap-2 [&>div]:mb-2">
        {gifs.map((gif) => {
          const starred = isSaved(gif.url);
          return (
            <div key={gif.url} className="relative break-inside-avoid">
              <button
                type="button"
                tabIndex={-1}
                onClick={(event) => sendChatGifOnPointerClick(event, gif, onSend)}
                aria-description="Para enviar, haz clic o toca el GIF."
                className="block w-full overflow-hidden rounded-lg border border-transparent transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                title={gif.description ?? "GIF"}
              >
                <img src={gif.preview} alt={gif.description ?? "GIF"} loading="lazy" className="w-full" />
              </button>
              <button
                type="button"
                onClick={() => onToggleStar(gif)}
                aria-pressed={starred}
                aria-label={starred ? "Quitar de favoritos" : "Guardar en favoritos"}
                title={starred ? "Quitar de favoritos" : "Guardar en favoritos"}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Star className={clsx("h-3.5 w-3.5", starred && "fill-current text-amber-300")} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
