import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronDown, ListMusic, Music2, Pause, Play, RefreshCw, Shuffle, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { Button, Input, Spinner, useToast } from "@/components/ui";
import {
  beginSpotifyLogin,
  cachedPlaylistTracks,
  listPlaylistTracks,
  listSpotifyPlaybackQueue,
  parseSpotifyUrl,
  searchSpotify,
  type SpotifySearchResult,
  SpotifyPlaylistRestrictedError,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from "@/lib/spotify";
import { formatKbps, spotifyWebKbps } from "@/lib/streamBitrate";
import { useRadio } from "@/lib/radioContext";
import { getSpotifySdkWindowTracks, isSpotifyGecko, isSpotifyTargetActive, SPOTIFY_ZEN_UNSUPPORTED_MSG, type SpotifyNowPlaying } from "@/lib/spotifyPlayer";

type MenuPos = { top: number; left: number; width: number; maxHeight: number };

function placeMenu(anchor: DOMRect, align: "left" | "right", preferredWidth: number): MenuPos {
  const width = Math.min(preferredWidth, window.innerWidth - 24);
  const gap = 6;
  let left = align === "right" ? anchor.right - width : anchor.left;
  left = Math.min(Math.max(12, left), window.innerWidth - width - 12);
  let top = anchor.bottom + gap;
  let maxHeight = Math.min(320, window.innerHeight - top - 12);
  if (maxHeight < 140 && anchor.top > 160) {
    maxHeight = Math.min(320, anchor.top - 12 - gap);
    top = Math.max(12, anchor.top - maxHeight - gap);
  }
  return { top, left, width, maxHeight: Math.max(120, maxHeight) };
}

function useAnchoredMenu(
  open: boolean,
  anchorRef: { current: HTMLElement | null },
  align: "left" | "right",
  preferredWidth: number,
): MenuPos | null {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const update = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPos(placeMenu(el.getBoundingClientRect(), align, preferredWidth));
  }, [align, anchorRef, preferredWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, update]);

  return pos;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SpotifyPanel({ headerStart, headerEnd }: { headerStart: ReactNode; headerEnd: ReactNode }) {
  const { push } = useToast();
  const {
    spotifyEmbed, spotify, volume, setVolume,
    loadSpotifyPlaylist, playSpotifyEmbed, spotifyToggle, spotifyNext, spotifyPrevious, spotifySeek, spotifyRetry, spotifyForget,
    spotifyShuffle, setSpotifyShuffle,
  } = useRadio();
  const [url, setUrl] = useState("");
  const [listOpen, setListOpen] = useState(false);

  const selectedUri = spotifyEmbed ? `spotify:${spotifyEmbed.kind}:${spotifyEmbed.id}` : null;
  const displayNow = isSpotifyTargetActive(spotify.now, selectedUri)
    ? spotify.now
    : (spotify.preview ?? spotify.now);
  const canShowList = Boolean(spotifyEmbed?.kind === "playlist");
  const listWrapRef = useRef<HTMLSpanElement>(null);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const listPos = useAnchoredMenu(listOpen, listWrapRef, "right", 320);
  useEffect(() => {
    if (!canShowList) setListOpen(false);
  }, [canShowList]);

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (listWrapRef.current?.contains(node) || listPanelRef.current?.contains(node)) return;
      setListOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [listOpen]);

  const listDropdown = listOpen && spotifyEmbed?.kind === "playlist" && listPos
    ? createPortal(
      <div
        ref={listPanelRef}
        className="fixed z-[200] rounded-xl border border-border bg-surface shadow-pop overflow-hidden"
        style={{ top: listPos.top, left: listPos.left, width: listPos.width, maxHeight: listPos.maxHeight }}
        role="dialog"
        aria-label="Canciones de la lista"
      >
        <TrackList
          playlistId={spotifyEmbed.id}
          currentUri={displayNow?.uri ?? null}
          onPick={(track) => {
            setListOpen(false);
            playSpotifyEmbed(spotifyEmbed, track.uri);
          }}
          onClose={() => setListOpen(false)}
        />
      </div>,
      document.body,
    )
    : null;

  const applyUrl = () => {
    const parsed = parseSpotifyUrl(url);
    if (!parsed) {
      push("error", "Pega un enlace de Spotify (lista, álbum o canción).");
      return;
    }
    setUrl("");
    playSpotifyEmbed(parsed);
  };

  const choosePlaylist = (id: string) => {
    if (!id) return;
    loadSpotifyPlaylist(id);
    // Firefox: selecting a list must not start playback. The SDK iframe is
    // often still loading; a play here becomes a 10s DRM preview.
    // Chromium arms Widevine on this same click, so autoplay stays.
    if (isSpotifyGecko()) return;
    playSpotifyEmbed({ kind: "playlist", id });
  };

  const connect = () => {
    void beginSpotifyLogin().catch((err: unknown) => {
      push("error", err instanceof Error ? err.message : "No se pudo abrir Spotify.");
    });
  };

  /** Drops the stored session first so Spotify issues the streaming scope again. */
  const reconnect = () => {
    spotifyForget();
    connect();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 shrink-0">
        {headerStart}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {spotify.connected ? (
            <>
              {spotify.playlists.length > 0 && (
                <div className="w-1/2 min-w-0">
                  <PlaylistPicker
                    playlists={spotify.playlists}
                    value={spotifyEmbed?.kind === "playlist" ? spotifyEmbed.id : ""}
                    onChange={choosePlaylist}
                  />
                </div>
              )}
              <SpotifySearch onPick={(result) => {
                playSpotifyEmbed({ kind: result.kind, id: result.id });
              }} />
              {spotify.playlists.length === 0 && (
                <button type="button" className="text-[11px] text-muted hover:text-text shrink-0" onClick={spotifyForget}>
                  Salir{spotify.premium ? "" : " Free"}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <Input
                  dense
                  className="w-full"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Pegar enlace de lista…"
                  aria-label="Enlace de Spotify"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyUrl(); } }}
                />
              </div>
              <Button size="sm" className="shrink-0 h-9" onClick={applyUrl}>Abrir</Button>
              <Button size="sm" variant="secondary" className="h-9 shrink-0" onClick={connect} disabled={spotify.loading}>
                {spotify.loading ? <Spinner size={14} /> : "Conectar"}
              </Button>
            </>
          )}
        </div>
        {headerEnd}
      </div>

      <div
        className="mt-2 h-[120px] overflow-hidden rounded-xl flex flex-col justify-center gap-2 px-3 relative"
        style={displayNow?.image ? {
          backgroundImage: `url(${displayNow.image})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        } : undefined}
      >
        {displayNow?.image && (
          <div className="absolute inset-0 bg-black/45 backdrop-blur-md rounded-xl" aria-hidden />
        )}
        {spotify.connected ? (
          <div className="relative z-10 flex flex-col gap-2">
            <SdkPlayer
              now={displayNow}
              kbps={spotifyWebKbps(true)}
              starting={spotify.starting && !spotify.device}
              playbackBlocked={spotify.zenUnsupported}
              onToggle={() => {
                const embedUri = spotifyEmbed ? `spotify:${spotifyEmbed.kind}:${spotifyEmbed.id}` : null;
                if (isSpotifyTargetActive(spotify.now, embedUri)) {
                  spotifyToggle();
                  return;
                }
                if (spotifyEmbed) playSpotifyEmbed(spotifyEmbed);
                else spotifyToggle();
              }}
              onPrev={spotifyPrevious}
              onNext={spotifyNext}
              shuffle={spotifyShuffle}
              onShuffle={() => setSpotifyShuffle(!spotifyShuffle)}
              showListButton={canShowList}
              listOpen={listOpen}
              onToggleList={() => setListOpen((value) => !value)}
              listDropdown={listDropdown}
              listWrapRef={listWrapRef}
            />
            <div className="flex items-center gap-3">
              <ProgressSlider now={spotify.now} onSeek={spotifySeek} />
              <Volume2 className="w-3.5 h-3.5 text-white/70 shrink-0" aria-hidden />
              <input
                className="range"
                style={{ width: "4rem" }}
                type="range" min={0} max={1} step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volumen de Spotify"
              />
              <span className="text-[11px] text-white/70 tabular-nums w-8 text-right shrink-0">{Math.round(volume * 100)}%</span>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex h-full items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-[#1DB954]/15 text-[#1DB954] grid place-items-center shrink-0">
              <Music2 className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">Reproductor de Spotify no disponible</p>
              <p className="text-xs text-muted truncate">{spotify.error ?? "Activa el reproductor para escuchar música aquí."}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={spotifyRetry}>
              <RefreshCw className="w-3.5 h-3.5" />Reintentar
            </Button>
          </div>
        )}
      </div>
      {spotify.zenUnsupported && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 mt-2 shrink-0" role="status">
          {SPOTIFY_ZEN_UNSUPPORTED_MSG}
        </p>
      )}
      {spotify.error && !spotify.zenUnsupported && (
        <p className="text-[11px] text-danger mt-2 shrink-0" role="status">{spotify.error}</p>
      )}
      {!spotify.device && !spotify.starting && spotify.error?.includes("permiso") && (
        <button type="button" className="text-[11px] text-danger mt-2 shrink-0 text-left underline" onClick={reconnect}>
          Reconectar la cuenta para renovar permisos
        </button>
      )}
    </div>
  );
}

function PlaylistPicker({ playlists, value, onChange }: {
  playlists: SpotifyPlaylist[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredMenu(open, wrapRef, "left", 360);
  const selected = playlists.find((item) => item.id === value);
  const label = selected
    ? `${selected.name}${selected.tracks ? ` · ${selected.tracks}` : ""}`
    : "Elige una de tus listas";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (wrapRef.current?.contains(node) || panelRef.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative w-full" ref={wrapRef}>
      <button
        type="button"
        className="input appearance-none !h-9 pr-9 cursor-pointer w-full text-left truncate"
        aria-label="Tus listas de Spotify"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[200] rounded-xl border border-border bg-surface shadow-pop overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          role="listbox"
          aria-label="Tus listas de Spotify"
        >
          <ul className="h-full max-h-[inherit] overflow-y-auto py-1">
            {playlists.map((item) => {
              const active = item.id === value;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={clsx(
                      "w-full px-3 py-1.5 text-left text-xs transition-colors",
                      active ? "bg-accent-soft font-semibold text-accent-strong" : "text-text hover:bg-bg",
                    )}
                    onClick={() => {
                      setOpen(false);
                      onChange(item.id);
                    }}
                  >
                    <span className="block truncate">{item.name}</span>
                    {item.tracks ? <span className="block text-[11px] text-faint">{item.tracks} canciones</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Inner padding of `.card`, so the results never touch the panel border. */
const CARD_PADDING = 20;

/**
 * Twice the input, growing only to the right and stopping at the panel edge.
 * The card is `overflow-visible`, so the results may spill out of the field.
 */
function useResultsWidth(anchorRef: { current: HTMLElement | null }): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const measure = () => {
      const anchor = el.getBoundingClientRect();
      if (anchor.width === 0) return;
      const card = el.closest(".card")?.getBoundingClientRect();
      const right = card ? card.right - CARD_PADDING : window.innerWidth - 12;
      setWidth(Math.max(anchor.width, Math.min(anchor.width * 2, right - anchor.left)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef]);

  return width;
}

function SpotifySearch({ onPick }: { onPick: (result: SpotifySearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifySearchResult[]>([]);
  const [type, setType] = useState<"all" | "track" | "playlist">("all");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    setResults([]);
    setError(null);
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSpotify(q, type)
        .then((tracks) => {
          if (cancelled) return;
          setResults(tracks);
        })
        .catch(() => { if (!cancelled) setError("No se pudo buscar. Vuelve a intentarlo."); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, type, retry]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const resultsWidth = useResultsWidth(wrapRef);

  const pick = (track: SpotifySearchResult) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onPick(track);
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <Input
        dense
        className="w-full"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Canciones o playlists…"
        aria-label="Buscar canciones o playlists en Spotify"
      />
      {searching && <Spinner size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2" />}
      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 z-[200] mt-1 rounded-xl border border-border bg-surface shadow-pop overflow-hidden"
          style={{ width: resultsWidth ?? "100%" }}>
          <div className="flex gap-1 p-1.5 border-b border-border" role="group" aria-label="Tipo de búsqueda">
            {([['all', 'Todo'], ['track', 'Canciones'], ['playlist', 'Playlists']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={type === value}
                className={clsx("flex-1 min-w-0 rounded-lg px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", type === value ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-bg")}
                onClick={() => setType(value)}>{label}</button>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {searching ? <p className="p-3 text-xs text-muted">Buscando…</p> : error ? (
              <div className="p-3 text-xs text-danger">{error} <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>Reintentar</button></div>
            ) : results.length === 0 ? <p className="p-3 text-xs text-muted">Sin resultados. Prueba otro nombre.</p> : null}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {results.map((track) => (
              <li key={track.uri}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-bg transition-colors"
                  onClick={() => pick(track)}
                  aria-label={`Reproducir ${track.kind === "track" ? "canción" : "playlist"}: ${track.name}`}
                >
                  {track.image ? (
                    <img src={track.image} alt="" className="w-7 h-7 rounded object-cover shrink-0 bg-bg" />
                  ) : (
                    <span className="w-7 h-7 rounded bg-bg border border-border shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-text truncate">{track.name}</span>
                    <span className="block text-[11px] text-faint truncate">{track.kind === "track" ? "Canción" : "Playlist"} · {track.subtitle}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TrackList({ playlistId, currentUri, onPick, onClose }: {
  playlistId: string;
  currentUri: string | null;
  onPick: (track: SpotifyTrack) => void;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(() => cachedPlaylistTracks(playlistId));
  const [failed, setFailed] = useState(false);
  const [fromQueue, setFromQueue] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = cachedPlaylistTracks(playlistId);
    setFromQueue(false);
    setHint(null);
    if (cached) {
      setTracks(cached);
      setFailed(false);
    } else {
      setTracks(null);
      setFailed(false);
    }

    const apply = (list: SpotifyTrack[], queued: boolean) => {
      if (cancelled) return;
      setFailed(false);
      setFromQueue(queued);
      setHint(queued ? "Cola de lo que está sonando (Spotify no comparte el contenido de esta lista)." : null);
      setTracks(list);
    };

    const fallbackQueue = async () => {
      const queued = await listSpotifyPlaybackQueue();
      if (cancelled) return;
      if (queued.length > 0) {
        apply(queued, true);
        return;
      }
      const windowTracks = getSpotifySdkWindowTracks();
      if (windowTracks.length > 0) {
        apply(windowTracks, true);
        return;
      }
      setFailed(true);
      setHint("Spotify solo deja listar las canciones de las listas que has creado tú. En Éxitos, Daily Mix y similares pulsa Play y vuelve a abrir la lista para ver la cola.");
    };

    void listPlaylistTracks(playlistId)
      .then((list) => apply(list, false))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof SpotifyPlaylistRestrictedError) {
          void fallbackQueue();
          return;
        }
        if (!cached) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [playlistId]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between shrink-0 px-3 py-2 border-b border-border">
        <span className="text-[11px] font-medium text-muted">{failed ? "Lista" : tracks ? `${tracks.length} ${fromQueue ? "en cola" : "canciones"}` : "Cargando…"}</span>
        <button type="button" className="btn-ghost btn-icon-sm" onClick={onClose} aria-label="Cerrar lista de canciones">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="overflow-y-auto p-1.5 max-h-[18rem]">
        {hint && (
          <p className="text-[11px] text-muted px-1.5 py-1.5">{hint}</p>
        )}
        {failed && (
          <div className="py-2 px-1.5 space-y-2">
            <p className="text-xs text-danger">No se pudieron cargar las canciones.</p>
            <button
              type="button"
              className="text-[11px] text-accent-strong underline"
              onClick={() => {
                setFailed(false);
                setTracks(null);
                setHint(null);
                void listPlaylistTracks(playlistId)
                  .then((list) => { setTracks(list); setFailed(false); setFromQueue(false); })
                  .catch((err: unknown) => {
                    if (err instanceof SpotifyPlaylistRestrictedError) {
                      void listSpotifyPlaybackQueue().then((queued) => {
                        if (queued.length > 0) {
                          setTracks(queued);
                          setFromQueue(true);
                          setFailed(false);
                          setHint("Cola de lo que está sonando (Spotify no comparte el contenido de esta lista).");
                          return;
                        }
                        setFailed(true);
                        setHint("Spotify solo deja listar las canciones de las listas que has creado tú. Pulsa Play y vuelve a abrir la lista.");
                      });
                      return;
                    }
                    setFailed(true);
                  });
              }}
            >
              Reintentar
            </button>
          </div>
        )}
        {!failed && !tracks && (
          <div className="flex items-center justify-center py-6"><Spinner size={16} /></div>
        )}
        {tracks?.map((track, index) => {
          const active = track.uri === currentUri;
          return (
            <button
              key={`${track.uri}:${index}`}
              type="button"
              className={clsx("w-full flex items-center gap-2 px-1.5 py-1 rounded-lg text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-surface")}
              onClick={() => onPick(track)}
            >
              <span className={clsx("w-5 text-right text-[11px] tabular-nums shrink-0", active ? "text-accent-strong" : "text-faint")}>{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-xs truncate", active ? "font-semibold text-accent-strong" : "font-medium text-text")}>{track.name}</span>
                <span className="block text-[11px] text-faint truncate">{track.artists}</span>
              </span>
              <span className="text-[11px] text-faint tabular-nums shrink-0">{fmtMs(track.durationMs)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Dragging must not seek continuously: each input event would restart buffering. */
function ProgressSlider({ now, onSeek }: { now: SpotifyNowPlaying | null; onSeek: (ms: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const duration = Math.max(1, now?.durationMs ?? 1);
  const position = Math.min(drag ?? now?.positionMs ?? 0, duration);
  const commit = () => {
    if (drag === null) return;
    onSeek(drag);
    setDrag(null);
  };
  return (
    <input
      className="range flex-1"
      type="range"
      min={0}
      max={duration}
      step={1000}
      value={position}
      onChange={(e) => setDrag(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") commit(); }}
      onBlur={() => setDrag(null)}
      disabled={!now}
      aria-label="Posición de Spotify"
    />
  );
}

function SdkPlayer({
  now, kbps, starting, playbackBlocked, onToggle, onPrev, onNext, shuffle, onShuffle, showListButton, listOpen, onToggleList, listDropdown, listWrapRef,
}: {
  now: SpotifyNowPlaying | null;
  kbps: number;
  starting?: boolean;
  playbackBlocked?: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  shuffle: boolean;
  onShuffle: () => void;
  showListButton: boolean;
  listOpen: boolean;
  onToggleList: () => void;
  listDropdown: ReactNode;
  listWrapRef: React.Ref<HTMLSpanElement>;
}) {
  const playing = Boolean(now && !now.paused);
  const kbpsLabel = formatKbps(kbps);
  return (
    <div className="flex items-center gap-3">
      <Button icon size="md" variant={playing ? "secondary" : "primary"} className="w-11 h-11 rounded-full shrink-0" onClick={onToggle} disabled={playbackBlocked} aria-label={playing ? "Pausar Spotify" : "Reproducir Spotify"}>
        {starting ? <Spinner size={16} /> : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-px" />}
      </Button>
      {now?.image ? (
        <img src={now.image} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0 bg-bg" />
      ) : (
        <span className="w-11 h-11 rounded-lg bg-white/10 border border-white/20 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate">{now?.name ?? "Spotify"}</p>
        <p className="text-xs text-white/70 truncate">
          {now?.artists || "Elige una lista"}
          {kbpsLabel ? ` · ${kbpsLabel}` : ""}
          {now ? ` · ${fmtMs(now.positionMs)} / ${fmtMs(now.durationMs)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          className={clsx("w-8 h-8 rounded-lg shrink-0 grid place-items-center text-white hover:bg-white/15 disabled:opacity-40 disabled:pointer-events-none", shuffle && "bg-white/20 text-[#1DB954]")}
          onClick={onShuffle}
          disabled={playbackBlocked}
          aria-label="Reproducción aleatoria"
          aria-pressed={shuffle}
        >
          <Shuffle className="w-4 h-4" />
        </button>
        <button type="button" className="w-8 h-8 rounded-lg shrink-0 grid place-items-center text-white hover:bg-white/15 disabled:opacity-40 disabled:pointer-events-none" onClick={onPrev} disabled={playbackBlocked} aria-label="Anterior"><SkipBack className="w-4 h-4" /></button>
        <button type="button" className="w-8 h-8 rounded-lg shrink-0 grid place-items-center text-white hover:bg-white/15 disabled:opacity-40 disabled:pointer-events-none" onClick={onNext} disabled={playbackBlocked} aria-label="Siguiente"><SkipForward className="w-4 h-4" /></button>
        {showListButton && (
          <span className="relative" ref={listWrapRef}>
            <button
              type="button"
              className={clsx("w-8 h-8 rounded-lg shrink-0 grid place-items-center text-white hover:bg-white/15", listOpen && "bg-white/20")}
              onClick={onToggleList}
              aria-label="Ver canciones de la lista"
              aria-expanded={listOpen}
            >
              <ListMusic className="w-4 h-4" />
            </button>
            {listDropdown}
          </span>
        )}
      </div>
    </div>
  );
}
