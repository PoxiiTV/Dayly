import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Pause, Play, Radio, SkipBack, SkipForward, Star, Volume2 } from "lucide-react";
import clsx from "clsx";
import { Button, SelectControl, Segmented, Spinner } from "@/components/ui";
import { cacheBustStream, matchRadioStation, RADIO_STATIONS, stationStreamUrls, stripCacheBust, type RadioStation } from "@/lib/radioStations";
import { http } from "@/lib/api";
import { clientReceiveKbps, formatKbps } from "@/lib/streamBitrate";
import {
  DEFAULT_SPOTIFY_EMBED,
  disconnectSpotify,
  fetchSpotifyMe,
  listPlaylistTracks,
  listSpotifyPlaylists,
  loadSpotifyConfig,
  parseSpotifyUrl,
  putSpotifyShuffle,
  readStoredEmbed,
  spotifyCanStream,
  spotifyIsConnected,
  writeStoredEmbed,
  type SpotifyEmbed,
  type SpotifyPlaylist,
} from "@/lib/spotify";
import {
  pauseActiveSpotifyDevice,
  SPOTIFY_BOOT_CANCELLED,
  armSpotifyFromUserGesture,
  getSpotifyNow,
  isSpotifyGecko,
  isSpotifyTargetActive,
  isSpotifyZen,
  sameSpotifyContext,
  spotifyNeedsUserReplay,
  SPOTIFY_ZEN_UNSUPPORTED_MSG,
  startSpotifyDevice,
  stopActiveSpotifyDevice,
  subscribeSpotifyDevice,
  subscribeSpotifyEvents,
  subscribeSpotifyState,
  warmSpotifyPlayer,
  whenSpotifySdkReady,
  type SpotifyDevicePlayer,
  type SpotifyNowPlaying,
} from "@/lib/spotifyPlayer";
import { RadioContext, useRadio, type MediaSource } from "@/lib/radioContext";
import { SpotifyPanel } from "@/components/SpotifyPanel";

export { useRadio, useOptionalRadio } from "@/lib/radioContext";
export type { MediaSource, SpotifySession } from "@/lib/radioContext";

const STATION_KEY = "dayly.radio.station";
const VOLUME_KEY = "dayly.radio.volume";
const FAVORITES_KEY = "dayly.radio.favorites";
const SOURCE_KEY = "dayly.media.source";
const SHUFFLE_KEY = "dayly.spotify.shuffle";
const DEFAULT_VOLUME = 0.5;
/** Broadcast streams already sit near digital peak; keep headroom so they do not clip. */
const MASTER_TRIM = 0.72;
const STALL_MS = 5_000;
const PLAY_WATCHDOG_MS = 8_000;

export type RadioUserIntent = {
  action: "play" | "pause" | "set_station";
  stationId?: string;
};

function normalizeRadioText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function stationFromText(q: string): RadioStation | undefined {
  return matchRadioStation(q);
}

const AGENDA_COMMAND = /\b(tarea|tareas|nota|notas|evento|eventos|recordatorio|habito|habitos|objetivo|proyecto|bandeja|papelera|calendario|cita|reunion|pomodoro|timer)\b/;

/** Detects only explicit radio commands, keeping autoplay inside the user gesture. */
export function radioIntentFromText(text: string): RadioUserIntent | null {
  const q = normalizeRadioText(text);
  const station = stationFromText(q);
  const radioContext = Boolean(station) || /radio|emisora|musica|loca|gozadera|los40|cadena dial|remember/.test(q);
  if (/\b(pausa|pausar|para|deten|silencia)\b/.test(q) && radioContext) {
    return { action: "pause" };
  }

  const wantsPlay = /\b(pon|ponga|ponme|reproduce|reproducir|escucha|sintoniza|enciende|reanuda|cambia|cambiar|selecciona|seleccionar)\b/.test(q);
  if (station && wantsPlay) return { action: "play", stationId: station.id };
  if (wantsPlay && radioContext) return { action: "play" };
  return null;
}

/** True when the message is only a radio command and should not hit the LLM. */
export function isRadioOnlyCommand(text: string): boolean {
  return Boolean(radioIntentFromText(text)) && !AGENDA_COMMAND.test(normalizeRadioText(text));
}

export function radioReplyFromIntent(intent: RadioUserIntent): string {
  const station = intent.stationId ? RADIO_STATIONS.find((item) => item.id === intent.stationId) : undefined;
  switch (intent.action) {
    case "pause":
      return "Listo, radio en pausa.";
    case "play":
      return station ? `Listo, reproduzco ${station.name}.` : "Listo, reproduzco la radio.";
    case "set_station":
      return station ? `Listo, he seleccionado ${station.name}.` : "Listo, he cambiado la emisora.";
    default: {
      const _never: never = intent.action;
      return _never;
    }
  }
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof DOMException && error.name === "NotAllowedError"
    ? "El navegador ha bloqueado la reproducción; pulsa Escuchar de nuevo."
    : "La emisora no se puede reproducir dentro de la agenda.";
}

function readStoredShuffle(): boolean {
  return localStorage.getItem(SHUFFLE_KEY) === "1";
}

function readStoredVolume(): number {
  const raw = Number(localStorage.getItem(VOLUME_KEY) ?? String(DEFAULT_VOLUME));
  if (!Number.isFinite(raw)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, raw));
}

function readStoredFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((id): id is string => typeof id === "string" && RADIO_STATIONS.some((station) => station.id === id)))];
  } catch {
    return [];
  }
}

function applyPlaybackVolume(audio: HTMLAudioElement, slider: number) {
  audio.volume = Math.min(1, Math.max(0, slider * MASTER_TRIM));
}

function attachStream(audio: HTMLAudioElement, url: string) {
  audio.src = url;
  audio.load();
}

export function RadioProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<MediaSource>(() => localStorage.getItem(SOURCE_KEY) === "spotify" ? "spotify" : "radio");
  const [stationId, setStationId] = useState(() => {
    const saved = localStorage.getItem(STATION_KEY);
    return RADIO_STATIONS.some((item) => item.id === saved) ? saved! : RADIO_STATIONS[0]!.id;
  });
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState(readStoredFavorites);
  const [streamKbps, setStreamKbps] = useState<number | null>(null);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);
  const [spotifyEmbed, setSpotifyEmbedState] = useState<SpotifyEmbed | null>(
    () => readStoredEmbed() ?? DEFAULT_SPOTIFY_EMBED,
  );
  const [spotifyEnabled, setSpotifyEnabled] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(spotifyIsConnected);
  const [spotifyPremium, setSpotifyPremium] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyStarting, setSpotifyStarting] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [spotifyDevice, setSpotifyDevice] = useState<SpotifyDevicePlayer | null>(null);
  const [spotifyNow, setSpotifyNow] = useState<SpotifyNowPlaying | null>(null);
  const [spotifyPreview, setSpotifyPreview] = useState<SpotifyNowPlaying | null>(null);
  const [spotifySdkReady, setSpotifySdkReady] = useState(false);
  const [spotifyShuffle, setSpotifyShuffleState] = useState(readStoredShuffle);
  const spotifyDeviceRef = useRef<SpotifyDevicePlayer | null>(null);
  const spotifyContextRef = useRef<string | null>(null);
  const spotifyPlayGenRef = useRef(0);
  const shuffleOnRef = useRef(spotifyShuffle);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const station = RADIO_STATIONS.find((item) => item.id === stationId) ?? RADIO_STATIONS[0]!;
  const stationRef = useRef(station);
  const volumeRef = useRef(volume);
  const playingRef = useRef(playing);
  const playGen = useRef(0);
  const wantsPlaybackRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const streamIndexRef = useRef(0);
  const stallTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const clearReconnectRef = useRef<() => void>(() => {});
  const remountStreamRef = useRef<(reason?: "stall" | "error") => void>(() => {});
  stationRef.current = station;
  volumeRef.current = volume;
  playingRef.current = playing;
  shuffleOnRef.current = spotifyShuffle;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    applyPlaybackVolume(audio, volume);
    let swapping = false;
    const clearTimer = (ref: { current: number | null }) => {
      if (ref.current !== null) {
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    };
    const clearReconnect = () => {
      clearTimer(reconnectTimerRef);
      clearTimer(stallTimerRef);
      clearTimer(watchdogTimerRef);
      setReconnecting(false);
    };
    const remountStream = (reason: "stall" | "error" = "error") => {
      if (!wantsPlaybackRef.current) return;
      const urls = stationStreamUrls(stationRef.current);
      if (!urls.length) return;
      if (reconnectAttemptRef.current >= 5) {
        wantsPlaybackRef.current = false;
        clearReconnect();
        setPlayError(playbackErrorMessage(new Error("stream")));
        return;
      }
      if (reason === "error" || reconnectAttemptRef.current > 0) {
        streamIndexRef.current = (streamIndexRef.current + 1) % urls.length;
      }
      reconnectAttemptRef.current += 1;
      setReconnecting(true);
      const url = cacheBustStream(urls[streamIndexRef.current]!, Date.now());
      swapping = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      attachStream(audio, url);
      setActiveStreamUrl(stripCacheBust(url));
      window.setTimeout(() => { swapping = false; }, 0);
      void audio.play().catch((error: unknown) => {
        if (!wantsPlaybackRef.current) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          wantsPlaybackRef.current = false;
          clearReconnect();
          setPlayError(playbackErrorMessage(error));
          return;
        }
        if (reconnectTimerRef.current !== null) return;
        const delay = Math.min(20_000, 2_000 * 2 ** Math.min(4, reconnectAttemptRef.current));
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          remountStream("error");
        }, delay);
      });
    };
    const armStall = () => {
      if (!wantsPlaybackRef.current || stallTimerRef.current !== null) return;
      stallTimerRef.current = window.setTimeout(() => {
        stallTimerRef.current = null;
        if (!wantsPlaybackRef.current) return;
        remountStream("stall");
      }, STALL_MS);
    };
    clearReconnectRef.current = clearReconnect;
    remountStreamRef.current = remountStream;
    const onPlaying = () => {
      if (!wantsPlaybackRef.current) return;
      reconnectAttemptRef.current = 0;
      clearReconnect();
      setPlaying(true);
      setPlayError(null);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (swapping || !wantsPlaybackRef.current) return;
      setPlaying(false);
      remountStream("error");
    };
    const onError = () => {
      setPlaying(false);
      if (swapping || !wantsPlaybackRef.current) return;
      setPlayError(null);
      remountStream("error");
    };
    const onWaiting = () => armStall();
    const onStalled = () => armStall();
    const onTimeUpdate = () => {
      if (stallTimerRef.current !== null) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    };
    const onOnline = () => {
      if (wantsPlaybackRef.current) remountStream("error");
    };
    const onOffline = () => { if (wantsPlaybackRef.current) setReconnecting(true); };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("timeupdate", onTimeUpdate);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    audioRef.current = audio;
    return () => {
      wantsPlaybackRef.current = false;
      clearReconnect();
      audio.pause();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      audio.src = "";
      audioRef.current = null;
      clearReconnectRef.current = () => {};
      remountStreamRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    setStreamKbps(null);
  }, [station.id]);

  useEffect(() => {
    if (source !== "radio" || !playing) return;
    const src = audioRef.current?.src ?? "";
    const url = activeStreamUrl ?? stationStreamUrls(station)[0] ?? "";
    if (!url) return;
    let cancelled = false;
    const pull = async () => {
      const live = clientReceiveKbps(src);
      if (live) {
        if (!cancelled) setStreamKbps(live);
        return;
      }
      try {
        const info = await http.get<{ kbps: number | null }>("/api/radio/stream-info", { stationId: station.id, url });
        if (!cancelled && info.kbps) setStreamKbps(info.kbps);
      } catch {
        /* keep last known value */
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [source, playing, station.id, activeStreamUrl]);

  useEffect(() => subscribeSpotifyState((state) => {
    if (state?.contextUri) spotifyContextRef.current = state.contextUri;
    if (state && !state.paused) setSpotifyError(null);
    if (typeof state?.shuffle === "boolean") {
      shuffleOnRef.current = state.shuffle;
      setSpotifyShuffleState(state.shuffle);
      localStorage.setItem(SHUFFLE_KEY, state.shuffle ? "1" : "0");
    }
    setSpotifyNow(state);
  }), []);

  // The device lifecycle lives in the player module: when it drops (network
  // change, sleep) this flips to null and the boot effect below re-connects.
  useEffect(() => subscribeSpotifyDevice((device) => {
    spotifyDeviceRef.current = device;
    setSpotifyDevice(device);
    if (device) setSpotifyStarting(false);
  }), []);

  useEffect(() => () => stopActiveSpotifyDevice(), []);

  useEffect(() => {
    if (isSpotifyZen()) setSpotifyError(SPOTIFY_ZEN_UNSUPPORTED_MSG);
  }, []);

  useEffect(() => subscribeSpotifyEvents((event) => {
    if (isSpotifyZen()) return;
    if (event.type === "autoplay_failed") {
      setSpotifyError("El navegador ha bloqueado el inicio automático. Pulsa play otra vez.");
    }
    if (event.type === "playback_error") {
      setSpotifyError(isSpotifyGecko()
        ? "Firefox ha bloqueado el audio cifrado. Pulsa play otra vez. Si sigue, activa «Reproducir contenido DRM» y permite Spotify en la protección de rastreo."
        : "El audio DRM se ha cortado. Pulsa play otra vez.");
    }
  }), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (spotifyIsConnected() && !isSpotifyZen()) warmSpotifyPlayer();
      const cfg = await loadSpotifyConfig();
      if (cancelled) return;
      setSpotifyEnabled(cfg.available);
      if (!cfg.available || !spotifyIsConnected()) return;
      setSpotifyLoading(true);
      try {
        const [me, lists] = await Promise.all([fetchSpotifyMe(), listSpotifyPlaylists()]);
        if (cancelled) return;
        setSpotifyConnected(true);
        setSpotifyPremium(me.premium);
        setSpotifyPlaylists(lists);
      } catch (err: unknown) {
        if (cancelled) return;
        setSpotifyConnected(spotifyIsConnected());
        setSpotifyPremium(false);
        setSpotifyError(err instanceof Error ? err.message : "No se pudo conectar con Spotify.");
      } finally {
        if (!cancelled) setSpotifyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!spotifyConnected) return;
    void whenSpotifySdkReady()
      .then(() => setSpotifySdkReady(true))
      .catch((err: unknown) => {
        setSpotifyError(err instanceof Error ? err.message : "No se pudo cargar el reproductor de Spotify.");
      });
  }, [spotifyConnected]);

  // No boot on mount: the SDK's Player constructor MUST run inside a user
  // gesture (click) or the browser blocks the DRM-encrypted audio element.
  // The device is created lazily on the first play/seek by ensureDevice().

  useEffect(() => {
    if (!spotifyConnected || spotifyDevice) return;
    if (!spotifyCanStream()) {
      setSpotifyError("Tu sesión de Spotify no incluye permiso de reproducción. Pulsa Reconectar.");
      return;
    }
  }, [spotifyConnected, spotifyDevice]);

  /**
   * Ensures the SDK device exists before issuing playback commands. Must be
   * called inside a click handler so `new Spotify.Player()` runs in the
   * user-gesture callstack — without that, the browser blocks Widevine and
   * audio dies at ~10s with playback_error + auto-skip.
   */
  const ensureDevice = async (): Promise<SpotifyDevicePlayer | null> => {
    if (isSpotifyZen()) {
      setSpotifyError(SPOTIFY_ZEN_UNSUPPORTED_MSG);
      return null;
    }
    const existing = spotifyDeviceRef.current;
    if (existing) return existing;
    if (!spotifyConnected || !spotifyCanStream()) return null;
    setSpotifyStarting(true);
    setSpotifyError(null);
    try {
      const device = await startSpotifyDevice(volumeRef.current);
      spotifyDeviceRef.current = device;
      setSpotifyDevice(device);
      return device;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === SPOTIFY_BOOT_CANCELLED) return null;
      const reason = err instanceof Error ? err.message : "El reproductor interno de Spotify no arrancó.";
      setSpotifyError(reason);
      return null;
    } finally {
      setSpotifyStarting(false);
    }
  };

  const spotifyRetry = () => {
    if (isSpotifyZen()) {
      setSpotifyError(SPOTIFY_ZEN_UNSUPPORTED_MSG);
      return;
    }
    setSpotifyError(null);
  };

  useEffect(() => {
    if (!spotifyNow || spotifyNow.paused) return;
    const started = Date.now();
    const origin = spotifyNow.positionMs;
    const tick = window.setInterval(() => {
      setSpotifyNow((current) => current && !current.paused
        ? { ...current, positionMs: Math.min(current.durationMs, origin + (Date.now() - started)) }
        : current);
    }, 500);
    return () => window.clearInterval(tick);
  }, [spotifyNow?.uri, spotifyNow?.paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (nextStationId?: string) => {
    pauseActiveSpotifyDevice();
    const target = nextStationId ? RADIO_STATIONS.find((item) => item.id === nextStationId) : stationRef.current;
    if (!target) return;
    const urls = stationStreamUrls(target);
    if (!urls.length) {
      wantsPlaybackRef.current = false;
      clearReconnectRef.current();
      window.open(target.pageUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    const gen = ++playGen.current;
    wantsPlaybackRef.current = true;
    reconnectAttemptRef.current = 0;
    streamIndexRef.current = 0;
    clearReconnectRef.current();
    stationRef.current = target;
    setSourceState("radio");
    localStorage.setItem(SOURCE_KEY, "radio");
    setStationId(target.id);
    localStorage.setItem(STATION_KEY, target.id);
    setPlayError(null);
    setReconnecting(true);
    applyPlaybackVolume(audio, volumeRef.current);
    attachStream(audio, cacheBustStream(urls[0]!, Date.now()));
    setActiveStreamUrl(stripCacheBust(urls[0]!));
    void audio.play().catch((error: unknown) => {
      if (playGen.current !== gen) return;
      setPlaying(false);
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        wantsPlaybackRef.current = false;
        setPlayError(playbackErrorMessage(error));
      } else {
        remountStreamRef.current("error");
      }
    });
    watchdogTimerRef.current = window.setTimeout(() => {
      watchdogTimerRef.current = null;
      if (!wantsPlaybackRef.current || playingRef.current) return;
      remountStreamRef.current("stall");
    }, PLAY_WATCHDOG_MS);
  };

  const pause = () => {
    playGen.current += 1;
    wantsPlaybackRef.current = false;
    clearReconnectRef.current();
    audioRef.current?.pause();
    setPlaying(false);
  };

  const setSource = (next: MediaSource) => {
    setSourceState(next);
    localStorage.setItem(SOURCE_KEY, next);
    if (next !== "spotify") return;
    pause();
  };

  const setSpotifyEmbed = (embed: SpotifyEmbed | null) => {
    setSpotifyEmbedState(embed);
    writeStoredEmbed(embed);
    if (embed) setSource("spotify");
  };

  const setStation = (id: string) => {
    const next = RADIO_STATIONS.find((item) => item.id === id);
    if (!next) return;
    if (playingRef.current && stationStreamUrls(next).length) {
      play(next.id);
      return;
    }
    const audio = audioRef.current;
    wantsPlaybackRef.current = false;
    clearReconnectRef.current();
    setPlayError(null);
    audio?.pause();
    setPlaying(false);
    streamIndexRef.current = 0;
    if (audio) {
      const urls = stationStreamUrls(next);
      if (urls[0]) {
        attachStream(audio, urls[0]);
        setActiveStreamUrl(urls[0]);
      } else {
        audio.removeAttribute("src");
        audio.load();
      }
    }
    stationRef.current = next;
    setStationId(next.id);
    localStorage.setItem(STATION_KEY, next.id);
  };

  const setVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolumeState(next);
    localStorage.setItem(VOLUME_KEY, String(next));
    if (audioRef.current) applyPlaybackVolume(audioRef.current, next);
    // The SDK sets volume on the device itself, so no REST call and no rate limit.
    void spotifyDeviceRef.current?.setVolume(next).catch(() => undefined);
  };

  /**
   * Single-source playback: only the SDK drives the audio element. The REST
   * call pushes the context to our device; the SDK's own state change handles
   * the rest. No competing toggle/resume afterwards — that was what made
   * tracks skip and stall at 10s.
   */
  const playSpotifyEmbed = (embed: SpotifyEmbed, offsetUri?: string) => {
    if (isSpotifyZen()) {
      setSpotifyError(SPOTIFY_ZEN_UNSUPPORTED_MSG);
      return;
    }
    const uri = `spotify:${embed.kind}:${embed.id}`;
    if (!armSpotifyFromUserGesture(volumeRef.current)) {
      setSpotifyError("Cargando Spotify… pulsa play otra vez.");
      return;
    }
    setSpotifyEmbed(embed);
    if (embed.kind === "track") setSpotifyPreview(null);
    setSpotifyError(null);
    const current = getSpotifyNow();
    if (!offsetUri && isSpotifyTargetActive(current, uri) && !spotifyNeedsUserReplay()) {
      if (current?.paused) void spotifyDeviceRef.current?.toggle();
      return;
    }
    const gen = ++spotifyPlayGenRef.current;
    void (async () => {
      const device = await ensureDevice();
      if (!device) return;
      if (spotifyPlayGenRef.current !== gen) return;
      spotifyContextRef.current = uri;
      void device.playContext(uri, offsetUri).then(() => {
        if (spotifyPlayGenRef.current !== gen) return;
        if (shuffleOnRef.current) void putSpotifyShuffle(device.deviceId, true).catch(() => undefined);
      }).catch((err: unknown) => {
        if (spotifyPlayGenRef.current !== gen) return;
        setSpotifyError(err instanceof Error ? err.message : "Spotify no ha podido reproducir esa lista.");
      });
    })();
  };

  const loadSpotifyPlaylist = (id: string) => {
    const chosen = spotifyPlaylists.find((item) => item.id === id);
    if (!chosen) return;
    setSpotifyEmbed({ kind: "playlist", id: chosen.id });
    setSpotifyError(null);
    setSpotifyPreview({
      name: chosen.name,
      artists: chosen.tracks ? `${chosen.tracks} canciones` : "Lista",
      image: chosen.image,
      durationMs: 0,
      positionMs: 0,
      paused: true,
      uri: "",
      contextUri: chosen.uri,
    });
    void listPlaylistTracks(chosen.id).then((tracks) => {
      const first = tracks[0];
      const live = getSpotifyNow();
      if (live && !live.paused && sameSpotifyContext(live.contextUri, chosen.uri)) return;
      setSpotifyPreview({
        name: first?.name ?? chosen.name,
        artists: first?.artists ?? (chosen.tracks ? `${chosen.tracks} canciones` : "Lista"),
        image: first?.image ?? chosen.image,
        durationMs: first?.durationMs ?? 0,
        positionMs: 0,
        paused: true,
        uri: first?.uri ?? "",
        contextUri: chosen.uri,
      });
    }).catch(() => undefined);
  };

  const spotifyToggle = () => {
    if (isSpotifyZen()) {
      setSpotifyError(SPOTIFY_ZEN_UNSUPPORTED_MSG);
      return;
    }
    if (!armSpotifyFromUserGesture(volumeRef.current)) {
      setSpotifyError("Cargando Spotify… pulsa play otra vez.");
      return;
    }
    const embedUri = spotifyEmbed ? `spotify:${spotifyEmbed.kind}:${spotifyEmbed.id}` : null;
    void (async () => {
      const device = await ensureDevice();
      if (!device) return;
      const now = getSpotifyNow();
      if (embedUri && (!isSpotifyTargetActive(now, embedUri) || spotifyNeedsUserReplay())) {
        const gen = ++spotifyPlayGenRef.current;
        spotifyContextRef.current = embedUri;
        void device.playContext(embedUri).then(() => {
          if (spotifyPlayGenRef.current !== gen) return;
          if (shuffleOnRef.current) void putSpotifyShuffle(device.deviceId, true).catch(() => undefined);
        }).catch((err: unknown) => {
          if (spotifyPlayGenRef.current !== gen) return;
          setSpotifyError(err instanceof Error ? err.message : "Spotify no ha podido reproducir esa lista.");
        });
        return;
      }
      if (!spotifyContextRef.current && embedUri) {
        spotifyContextRef.current = embedUri;
        const gen = ++spotifyPlayGenRef.current;
        void device.playContext(embedUri).then(() => {
          if (spotifyPlayGenRef.current !== gen) return;
          if (shuffleOnRef.current) void putSpotifyShuffle(device.deviceId, true).catch(() => undefined);
        }).catch((err: unknown) => {
          if (spotifyPlayGenRef.current !== gen) return;
          setSpotifyError(err instanceof Error ? err.message : "Spotify no ha podido reproducir esa lista.");
        });
        return;
      }
      void device.toggle();
    })();
  };

  const spotifyNext = () => {
    void spotifyDeviceRef.current?.next().catch(() => undefined);
  };
  const spotifyPrevious = () => { void spotifyDeviceRef.current?.previous().catch(() => undefined); };
  const spotifySeek = (positionMs: number) => {
    void spotifyDeviceRef.current?.seek(Math.max(0, positionMs)).catch(() => undefined);
  };

  const setSpotifyShuffle = (on: boolean) => {
    shuffleOnRef.current = on;
    setSpotifyShuffleState(on);
    localStorage.setItem(SHUFFLE_KEY, on ? "1" : "0");
    const deviceId = spotifyDeviceRef.current?.deviceId;
    if (deviceId) void putSpotifyShuffle(deviceId, on).catch(() => undefined);
  };

  const spotifyForget = () => {
    stopActiveSpotifyDevice();
    spotifyDeviceRef.current = null;
    spotifyContextRef.current = null;
    setSpotifyDevice(null);
    setSpotifyStarting(false);
    setSpotifyConnected(false);
    setSpotifyPremium(false);
    setSpotifyPlaylists([]);
    setSpotifyNow(null);
    setSpotifyPreview(null);
    setSpotifyError(null);
    void disconnectSpotify().catch(async (error: unknown) => {
      const cfg = await loadSpotifyConfig().catch(() => null);
      setSpotifyConnected(Boolean(cfg?.connected));
      setSpotifyPremium(Boolean(cfg?.connection?.premium));
      setSpotifyError(error instanceof Error ? error.message : "No se pudo desconectar Spotify.");
    });
  };

  const toggleFavorite = (id: string) => {
    if (!RADIO_STATIONS.some((item) => item.id === id)) return;
    setFavoriteIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggle = () => {
    if (source === "spotify") {
      setSource("radio");
      return;
    }
    if (playing) pause();
    else play();
  };

  return (
    <RadioContext.Provider value={{
      source, station, playing, reconnecting, volume, playError, favoriteIds, streamKbps, spotifyEmbed,
      spotify: {
        enabled: spotifyEnabled,
        connected: spotifyConnected,
        premium: spotifyPremium,
        loading: spotifyLoading,
        starting: spotifyStarting,
        error: spotifyError,
        zenUnsupported: isSpotifyZen(),
        device: spotifyDevice,
        playlists: spotifyPlaylists,
        now: spotifyNow,
        preview: spotifyPreview,
        sdkReady: spotifySdkReady,
      },
      setSource, setStation, setVolume, toggleFavorite, setSpotifyEmbed,
      loadSpotifyPlaylist, playSpotifyEmbed, spotifyToggle, spotifyNext, spotifyPrevious, spotifySeek, spotifyRetry, spotifyForget,
      spotifyShuffle, setSpotifyShuffle,
      play, pause, toggle,
    }}>
      {children}
    </RadioContext.Provider>
  );
}

export function RadioPlayer() {
  const { source, setSource, station, playing, reconnecting, volume, playError, favoriteIds, streamKbps, setStation, setVolume, toggleFavorite, toggle } = useRadio();
  const orderedStations = [
    ...RADIO_STATIONS.filter((item) => favoriteIds.includes(item.id)),
    ...RADIO_STATIONS.filter((item) => !favoriteIds.includes(item.id)),
  ];
  const isFavorite = favoriteIds.includes(station.id);
  const kbpsLabel = formatKbps(streamKbps);
  return (
    <section className="card p-5 overflow-visible h-full flex flex-col relative z-50">
      {source === "spotify" ? (
        <SpotifyPanel
            headerStart={<h2 className="section-title mb-0 shrink-0"><Radio className="w-3.5 h-3.5" />Radio</h2>}
            headerEnd={
              <Segmented
                className="shrink-0"
                value={source}
                onChange={setSource}
                options={[
                  { value: "radio", label: "Emisoras" },
                  { value: "spotify", label: "Spotify" },
                ]}
              />
            }
          />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="section-title mb-0"><Radio className="w-3.5 h-3.5" />Radio</h2>
            <Segmented
              className="shrink-0"
              value={source}
              onChange={setSource}
              options={[
                { value: "radio", label: "Emisoras" },
                { value: "spotify", label: "Spotify" },
              ]}
            />
          </div>
          <div className="flex-1 min-h-[7.5rem] overflow-hidden">
            <div className="flex items-center gap-3">
              <PlayButton station={station} playing={playing} reconnecting={reconnecting} onToggle={toggle} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-text truncate min-w-0 flex-1">{station.name}</p>
                  <button
                    type="button"
                    className={clsx("btn-ghost btn-icon-sm shrink-0", isFavorite && "text-warn")}
                    onClick={() => toggleFavorite(station.id)}
                    aria-label={isFavorite ? `Quitar ${station.name} de favoritas` : `Añadir ${station.name} a favoritas`}
                    title={isFavorite ? "Quitar de favoritas" : "Añadir a favoritas"}
                  >
                    <Star className="w-4 h-4" fill={isFavorite ? "currentColor" : "none"} />
                  </button>
                  {stationStreamUrls(station).length > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Volume2 className="w-3.5 h-3.5 text-faint shrink-0" aria-hidden />
                      <input
                        className="range"
                        style={{ width: "4.5rem" }}
                        type="range" min={0} max={1} step={0.05}
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        aria-label="Volumen de la radio"
                      />
                      <span className="text-[11px] text-faint tabular-nums w-8 text-right shrink-0">{Math.round(volume * 100)}%</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted truncate">
                  {station.note ?? "Emisora online"}
                  {kbpsLabel ? ` · ${kbpsLabel}` : ""}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <SelectControl value={station.id} onChange={(e) => setStation(e.target.value)} aria-label="Emisora" dense>
                {orderedStations.map((item) => <option key={item.id} value={item.id}>{favoriteIds.includes(item.id) ? "★ " : ""}{item.name}</option>)}
              </SelectControl>
            </div>
          </div>
        </>
      )}
      {source === "radio" && reconnecting && (
        <p className="text-xs text-muted mt-3" role="status">Conexión interrumpida. Intentando reconectar…</p>
      )}
      {source === "radio" && playError && (
        <p className="text-xs text-danger mt-3" role="status">
          {playError}{" "}
          <a href={station.pageUrl} target="_blank" rel="noreferrer" className="underline">Abrir web oficial</a>
        </p>
      )}
    </section>
  );
}

/**
 * Playback survives navigation, so every page outside the dashboard gets this
 * strip. It lives in normal flow: a fixed pill used to sit on top of the
 * sidebar profile block.
 */
export function RadioMiniPlayer({ collapsed = false, onNavigate }: {
  collapsed?: boolean;
  /** Runs before leaving, so the caller can tidy up (hide the browser). */
  onNavigate?: () => void;
}) {
  const { source, station, playing, reconnecting, favoriteIds, streamKbps, spotify, toggleFavorite, toggle, spotifyToggle, spotifyNext, spotifyPrevious } = useRadio();
  const navigate = useNavigate();
  const isFavorite = favoriteIds.includes(station.id);
  const kbpsLabel = formatKbps(streamKbps);
  /** Everything that is not a control opens the radio card in the dashboard. */
  const openRadio = () => {
    onNavigate?.();
    navigate("/");
  };
  if (source === "spotify") {
    const now = spotify.now ?? spotify.preview;
    const spotifyPlaying = Boolean(spotify.now && !spotify.now.paused);
    return (
      <div className={clsx("flex items-center gap-1.5 rounded-xl border border-border bg-bg p-1.5", collapsed && "flex-col")}>
        <Button icon size="sm" variant={spotifyPlaying ? "secondary" : "primary"} onClick={spotifyToggle} aria-label={spotifyPlaying ? "Pausar Spotify" : "Reproducir Spotify"}>
          {spotify.starting ? <Spinner size={14} /> : spotifyPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-px" />}
        </Button>
        {!collapsed && (
          <button
            type="button"
            onClick={openRadio}
            title="Abrir la radio en el panel"
            className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-surface"
          >
            <span className="block text-xs font-medium text-text truncate">{now?.name ?? "Spotify"}</span>
            {now?.artists && <span className="block text-[11px] text-faint truncate">{now.artists}</span>}
          </button>
        )}
        <div className={clsx("flex items-center gap-0.5 shrink-0", collapsed && "flex-col")}>
          <button type="button" className="btn-ghost btn-icon-sm" onClick={spotifyPrevious} aria-label="Canción anterior">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="btn-ghost btn-icon-sm" onClick={spotifyNext} aria-label="Canción siguiente">
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={clsx("flex items-center gap-2 rounded-xl border border-border bg-bg p-1.5", collapsed && "justify-center")}>
      <PlayButton compact station={station} playing={playing} reconnecting={reconnecting} onToggle={toggle} />
      {!collapsed && (
        <>
          <button
            type="button"
            onClick={openRadio}
            title="Abrir la radio en el panel"
            className="min-w-0 flex-1 truncate rounded-lg px-1 py-0.5 text-left text-xs font-medium text-text transition-colors hover:bg-surface"
          >
            {station.name}{kbpsLabel ? ` · ${kbpsLabel}` : ""}
          </button>
          <button
            type="button"
            className={clsx("btn-ghost btn-icon-sm shrink-0", isFavorite && "text-warn")}
            onClick={() => toggleFavorite(station.id)}
            aria-label={isFavorite ? `Quitar ${station.name} de favoritas` : `Añadir ${station.name} a favoritas`}
            title={isFavorite ? "Quitar de favoritas" : "Añadir a favoritas"}
          >
            <Star className="w-3.5 h-3.5" fill={isFavorite ? "currentColor" : "none"} />
          </button>
        </>
      )}
    </div>
  );
}

function PlayButton({ station, playing, reconnecting, onToggle, compact }: {
  station: RadioStation; playing: boolean; reconnecting?: boolean; onToggle: () => void; compact?: boolean;
}) {
  const streamable = stationStreamUrls(station).length > 0;
  return (
    <Button
      icon
      size={compact ? "sm" : "md"}
      variant={playing ? "secondary" : "primary"}
      className={clsx(!compact && "w-11 h-11 rounded-full")}
      onClick={onToggle}
      aria-label={streamable ? (playing ? "Pausar radio" : "Reproducir radio") : "Abrir radio oficial"}
    >
      {!streamable ? <ExternalLink className="w-4 h-4" /> : reconnecting && !playing ? <Spinner size={16} /> : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-px" />}
    </Button>
  );
}
