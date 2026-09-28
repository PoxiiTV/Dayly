import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, BookMarked, Clock, Globe2, Home, Pencil, RefreshCw, Shield, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { Button, Input, Spinner, useToast } from "@/components/ui";
import {
  browserAction,
  clearNativeBrowserData,
  closeNativeBrowser,
  getNativeBrowserBounds,
  getNativeBrowserState,
  isAllowedBrowserUrl,
  nativeBrowserProxyStatus,
  normalizeBrowserUrl,
  openNativeBrowser,
  resizeNativeBrowser,
  setNativeBrowserProxy,
  showNativeBrowser,
  WARP_PROXY_URL,
  type BrowserProxyStatus,
} from "@/lib/nativeShell";
import {
  DEFAULT_HOME_URL,
  useBrowserBookmarks,
  useBrowserHistory,
  useBrowserSettings,
  useVisitRecorder,
  type BrowserMark,
} from "@/lib/browserMarks";
import { checkWarpEgress, type WarpEgress } from "@/lib/warpEgress";
import { fmtTime, relativeDay } from "@/lib/dates";

export const BROWSER_TOOLBAR_HEIGHT = 56;

/** Remembered per device: a machine without WARP has nothing to switch on. */
const WARP_KEY = "dayly.browser.warp";
/** The same page is not worth writing down again this soon. */
const REVISIT_MS = 5 * 60_000;
/** A page that stays this long is a visit, not a redirect on the way. */
const SETTLE_MS = 2_000;
/**
 * How wide the list column is.
 *
 * The page is a native surface and nothing drawn in HTML can sit on top of it,
 * so a list has to be given room rather than floated over: it becomes a column
 * on the right and the page keeps the rest, the way the chat does with its GIF
 * panel. Nothing is hidden and nothing moves down.
 */
const LIST_WIDTH = 360;

type Overlay = "bookmarks" | "history" | null;

export function EmbeddedBrowserPanel({ collapsed, onClose }: { collapsed: boolean; onClose: () => void }) {
  const { push } = useToast();
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [warpOn, setWarpOn] = useState(() => {
    try { return localStorage.getItem(WARP_KEY) === "1"; } catch { return false; }
  });
  const [proxy, setProxy] = useState<BrowserProxyStatus | null>(null);
  const [egress, setEgress] = useState<WarpEgress>("unknown");
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const marks = useBrowserBookmarks();
  const history = useBrowserHistory();
  const settings = useBrowserSettings();
  const recorder = useVisitRecorder();
  const homeUrl = settings.homeUrl || DEFAULT_HOME_URL;

  const overlayRef = useRef<Overlay>(null);
  /** The page takes what the list column leaves. */
  const bounds = useCallback(() => {
    const base = getNativeBrowserBounds(collapsedRef.current, BROWSER_TOOLBAR_HEIGHT);
    if (!overlayRef.current) return base;
    return { ...base, width: Math.max(320, base.width - LIST_WIDTH) };
  }, []);

  const syncBounds = useCallback(() => {
    setViewportWidth(window.innerWidth);
    void resizeNativeBrowser(bounds()).catch(() => { /* may not exist yet */ });
  }, [bounds]);

  // First open: the page the account chose, or the one it has been forever.
  useEffect(() => {
    if (settings.isLoading) return;
    let alive = true;
    const open = async () => {
      setBusy(true);
      setError(null);
      try {
        const resumed = await showNativeBrowser(bounds()).catch(() => false);
        if (resumed) {
          const state = await getNativeBrowserState();
          if (alive && state) setUrl(state.url);
        } else {
          await openNativeBrowser(homeUrl, bounds());
          if (alive) setUrl(homeUrl);
        }
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "No se pudo abrir el navegador integrado.";
        setError(message);
        push("error", message);
      } finally {
        if (alive) setBusy(false);
      }
    };
    void open();
    return () => { alive = false; };
    // Only on mount, once the saved home page is known.
  }, [settings.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    syncBounds();
    window.addEventListener("resize", syncBounds);
    const delayed = window.setTimeout(syncBounds, 320);
    return () => {
      window.removeEventListener("resize", syncBounds);
      window.clearTimeout(delayed);
    };
  }, [collapsed, syncBounds]);

  /** Where the shell is right now, and what has been written down already. */
  const noted = useRef(new Map<string, number>());
  const pending = useRef<{ url: string; since: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const state = await getNativeBrowserState();
        if (!alive || !state) return;
        if (!editing) setUrl(state.url);

        // A visit is a page that stayed: a redirect chain writes nothing.
        if (!isAllowedBrowserUrl(state.url)) return;
        const now = Date.now();
        if (pending.current?.url !== state.url) {
          pending.current = { url: state.url, since: now };
          return;
        }
        if (now - pending.current.since < SETTLE_MS) return;
        const last = noted.current.get(state.url) ?? 0;
        if (now - last < REVISIT_MS) return;
        noted.current.set(state.url, now);
        recorder.mutate({ url: state.url, title: pageTitle(state.url) });
      } catch { /* the webview can be between creation and navigation */ }
    };
    void poll();
    const timer = window.setInterval(poll, 700);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [editing, recorder]);

  // What route the browser is really on, so the shield never lies: the shell
  // knows about its own proxy, and Cloudflare answers whether this machine is
  // already tunnelling everything — WARP in its usual mode has no local port
  // to probe, and a probe alone would call that "apagado".
  useEffect(() => {
    let alive = true;
    void nativeBrowserProxyStatus().then((status) => { if (alive) setProxy(status); });
    void checkWarpEgress().then((value) => { if (alive) setEgress(value); });
    return () => { alive = false; };
  }, []);

  /** Opens or closes a list: the page narrows or takes the width back. */
  const openOverlay = async (next: Overlay) => {
    overlayRef.current = next;
    setOverlay(next);
    await resizeNativeBrowser(bounds()).catch(() => { /* may not exist yet */ });
  };

  const go = async (href: string) => {
    if (!isAllowedBrowserUrl(href)) {
      setError("Solo se admiten direcciones HTTPS públicas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The list closes first, so the page is on screen again before it loads.
      if (overlayRef.current) await openOverlay(null);
      await openNativeBrowser(href, bounds());
      setUrl(href);
      setEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cargar esa dirección.";
      setError(message);
      push("error", message);
    } finally {
      setBusy(false);
    }
  };

  const submitUrl = async (event?: FormEvent) => {
    event?.preventDefault();
    await go(normalizeBrowserUrl(url));
  };

  const runAction = async (action: "back" | "forward" | "reload") => {
    setBusy(true);
    try {
      await browserAction(action);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo ejecutar la acción.";
      setError(message);
      push("error", message);
    } finally {
      setBusy(false);
    }
  };

  const closePanel = useCallback(async () => {
    try {
      await closeNativeBrowser();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cerrar el navegador.";
      push("error", message);
    } finally {
      onClose();
    }
  }, [onClose, push]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (overlay) void openOverlay(null);
      else void closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePanel, overlay]);

  const current = marks.saved(url);

  const toggleStar = () => {
    if (current) marks.remove.mutate(current.id);
    else if (isAllowedBrowserUrl(url)) marks.save.mutate({ url, title: pageTitle(url) });
  };

  const toggleWarp = async () => {
    const next = !warpOn;
    // Nothing to route through: say what is missing and how to fix it rather
    // than throwing "no escucha" at someone who has WARP switched on.
    if (next && !proxy?.reachable) {
      push("info", tunnelled
        ? "Ya sales por WARP en todo el equipo. Para que sea solo el navegador, pon WARP en modo proxy: warp-cli mode proxy"
        : "Enciende WARP en modo proxy para esto: warp-cli mode proxy && warp-cli connect");
      setProxy(await nativeBrowserProxyStatus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await setNativeBrowserProxy(next ? WARP_PROXY_URL : null, bounds());
      setWarpOn(next);
      try { localStorage.setItem(WARP_KEY, next ? "1" : "0"); } catch { /* private mode */ }
      setProxy(await nativeBrowserProxyStatus());
      if (!result.reopened && isAllowedBrowserUrl(url)) await openNativeBrowser(url, bounds());
      setEgress(await checkWarpEgress());
      push("success", next ? "Saliendo por WARP" : "Salida directa");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cambiar la salida a internet.";
      setError(message);
      push("error", message);
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    setBusy(true);
    try {
      const result = await clearNativeBrowserData();
      push(result.complete ? "success" : "info", result.complete
        ? "Datos del navegador borrados"
        : "Borrado lo que estaba libre; cierra el navegador y repite para el resto.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "No se pudo borrar.");
    } finally {
      setBusy(false);
    }
  };

  const sidebarWidth = viewportWidth < 768 ? 0 : collapsed ? 72 : 256;
  // An older shell knows nothing about proxies: no switch rather than a dead one.
  const canProxy = proxy !== null;
  /** The whole machine is behind WARP, so the browser already is too. */
  const tunnelled = egress === "warp" && !warpOn;

  return (
    <div className="fixed inset-y-0 right-0 z-[70] pointer-events-none" style={{ left: sidebarWidth }}>
      <div className="pointer-events-auto h-14 flex items-center gap-1.5 px-2 border-b border-border bg-surface shadow-soft">
        <div className="hidden xl:flex items-center gap-2 px-2 shrink-0 text-sm font-semibold text-text">
          <Globe2 className="w-4 h-4 text-accent-strong" aria-hidden="true" />
          <span>Navegador</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" icon aria-label="Atrás" title="Atrás" onClick={() => void runAction("back")} disabled={busy}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" icon aria-label="Adelante" title="Adelante" onClick={() => void runAction("forward")} disabled={busy}>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" icon aria-label="Recargar" title="Recargar" onClick={() => void runAction("reload")} disabled={busy}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" icon aria-label="Página de inicio" title="Página de inicio" onClick={() => void go(homeUrl)} disabled={busy}>
            <Home className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
        <form onSubmit={(event) => void submitUrl(event)} className="flex min-w-0 flex-1" role="search">
          <label htmlFor="embedded-browser-address" className="sr-only">Dirección web o búsqueda</label>
          <input
            id="embedded-browser-address"
            className="input h-10 min-w-0 flex-1 rounded-r-none !bg-bg"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setEditing(true); setError(null); }}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            aria-invalid={Boolean(error)}
            autoComplete="url"
            inputMode="url"
            spellCheck={false}
            placeholder="Dirección o búsqueda"
          />
          <Button type="submit" variant="secondary" icon aria-label="Ir a la dirección" title="Ir" disabled={busy} className="rounded-l-none border-l-0">
            {busy ? <Spinner size={16} /> : <ArrowRight className="w-4 h-4" aria-hidden="true" />}
          </Button>
        </form>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            icon
            aria-pressed={Boolean(current)}
            aria-label={current ? "Quitar de favoritos" : "Guardar en favoritos"}
            title={current ? "Quitar de favoritos" : "Guardar en favoritos"}
            onClick={toggleStar}
            disabled={!isAllowedBrowserUrl(url)}
          >
            <Star className={clsx("w-4 h-4", current && "fill-current text-amber-400")} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            icon
            aria-label="Lista de favoritos"
            title="Lista de favoritos"
            aria-expanded={overlay === "bookmarks"}
            onClick={() => void openOverlay(overlay === "bookmarks" ? null : "bookmarks")}
          >
            <BookMarked className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            icon
            aria-label="Historial"
            title="Historial"
            aria-expanded={overlay === "history"}
            onClick={() => void openOverlay(overlay === "history" ? null : "history")}
          >
            <Clock className="w-4 h-4" aria-hidden="true" />
          </Button>
          {canProxy && (
            <Button
              variant="ghost"
              icon
              aria-pressed={warpOn}
              onClick={() => void toggleWarp()}
              disabled={busy}
              aria-label={warpOn ? "Salir directo a internet" : "Salir por WARP"}
              title={warpOn
                ? "El navegador sale por WARP · pulsa para salida directa"
                : tunnelled
                  ? "Ya sales por WARP en todo el equipo (modo túnel)"
                  : proxy?.reachable
                    ? "Salida directa · pulsa para salir por WARP"
                    : "WARP no está en modo proxy · pulsa para ver cómo"}
            >
              {warpOn || tunnelled
                ? <ShieldCheck className="w-4 h-4 text-ok" aria-hidden="true" />
                : <Shield className={clsx("w-4 h-4", !proxy?.reachable && "text-faint")} aria-hidden="true" />}
            </Button>
          )}
        </div>
        <Button variant="ghost" icon aria-label="Cerrar navegador" title="Cerrar navegador" onClick={() => void closePanel()}>
          <X className="w-5 h-5" aria-hidden="true" />
        </Button>
      </div>

      {error && (
        <div role="alert" className="pointer-events-auto absolute top-14 inset-x-0 flex items-center gap-2 px-3 py-2 bg-danger text-white shadow-soft">
          <p className="min-w-0 flex-1 text-xs truncate">{error}</p>
          <button type="button" aria-label="Ocultar error" onClick={() => setError(null)} className="shrink-0 p-1 rounded-md hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {overlay && (
        <aside
          className="pointer-events-auto absolute bottom-0 right-0 top-14 flex flex-col border-l border-border bg-surface"
          style={{ width: LIST_WIDTH }}
          aria-label={overlay === "bookmarks" ? "Favoritos" : "Historial"}
        >
          {overlay === "bookmarks" ? (
            <MarkList
              title="Favoritos"
              empty="Todavía no has guardado ninguna página. La estrella de la barra es la que guarda."
              marks={marks.bookmarks}
              loading={marks.isLoading}
              onClose={() => void openOverlay(null)}
              onOpen={(mark) => void go(mark.url)}
              onRemove={(mark) => marks.remove.mutate(mark.id)}
              onRename={(mark, title) => marks.rename.mutate({ id: mark.id, title })}
            />
          ) : (
            <MarkList
              title="Historial"
              empty={settings.historyEnabled ? "Nada por aquí todavía." : "El historial está apagado en Ajustes › Navegador."}
              marks={history.visits}
              loading={history.isLoading}
              searchable
              onClose={() => void openOverlay(null)}
              onOpen={(mark) => void go(mark.url)}
              onRemove={(mark) => history.forget.mutate(mark.id)}
              footer={(
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => history.clear.mutate()} disabled={history.visits.length === 0}>
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    Borrar historial
                  </Button>
                  {canProxy && (
                    <Button variant="ghost" size="sm" onClick={() => void wipe()} disabled={busy}>
                      Borrar cookies y datos del navegador
                    </Button>
                  )}
                </div>
              )}
            />
          )}
        </aside>
      )}
    </div>
  );
}

/** Shared by both lists: same rows, same actions, different source. */
function MarkList({ title, empty, marks, loading, searchable, onClose, onOpen, onRemove, onRename, footer }: {
  title: string;
  empty: string;
  marks: BrowserMark[];
  loading: boolean;
  searchable?: boolean;
  onClose: () => void;
  onOpen: (mark: BrowserMark) => void;
  onRemove: (mark: BrowserMark) => void;
  onRename?: (mark: BrowserMark, title: string) => void;
  footer?: React.ReactNode;
}) {
  const [needle, setNeedle] = useState("");
  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase();
    if (!text) return marks;
    return marks.filter((mark) => `${mark.title ?? ""} ${mark.url}`.toLowerCase().includes(text));
  }, [marks, needle]);

  return (
    <>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{title}</h2>
          <Button variant="ghost" size="sm" icon aria-label={`Cerrar ${title.toLowerCase()}`} title="Cerrar" onClick={onClose}>
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
        {searchable && (
          <Input
            dense
            className="mt-2 w-full"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Buscar…"
            aria-label={`Buscar en ${title.toLowerCase()}`}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="grid place-items-center py-8 text-accent"><Spinner /></div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>
        ) : (
          <ul>
            {shown.map((mark) => (
              <li key={mark.id} className="group flex items-center gap-1.5 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-bg">
                <button type="button" onClick={() => onOpen(mark)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm text-text">{mark.title || pageTitle(mark.url)}</span>
                  <span className="block truncate text-[11px] text-muted">{mark.url}</span>
                </button>
                <span className="shrink-0 text-[11px] tabular-nums text-faint">{stamp(mark.at)}</span>
                {onRename && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Renombrar ${mark.url}`}
                    title="Renombrar"
                    onClick={() => {
                      const next = window.prompt("Nombre del favorito", mark.title ?? pageTitle(mark.url));
                      if (next !== null) onRename(mark, next.trim());
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon aria-label={`Quitar ${mark.url}`} title="Quitar" onClick={() => onRemove(mark)}>
                  <X className="w-4 h-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {footer && <div className="shrink-0 border-t border-border px-3 py-2">{footer}</div>}
    </>
  );
}

/** Host and path: the closest thing to a name without asking the page. */
function pageTitle(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`.slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

function stamp(at: string): string {
  const date = new Date(at);
  const day = relativeDay(date);
  return day === "Hoy" ? fmtTime(date) : day;
}
