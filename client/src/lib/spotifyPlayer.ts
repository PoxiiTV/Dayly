import { refreshSpotifyAccessToken, peekSpotifyAccessToken, primeSpotifyAccessToken, spotifyAccessToken, spotifyApiFetch, type SpotifyTrack } from "./spotify";
import { APP_NAME } from "@brand";

export type SpotifyNowPlaying = {
  name: string;
  artists: string;
  image: string | null;
  durationMs: number;
  positionMs: number;
  paused: boolean;
  uri: string;
  contextUri: string | null;
  shuffle?: boolean;
};

type SdkPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (payload: never) => void) => void;
  togglePlay: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  activateElement: () => Promise<void>;
  getCurrentState: () => Promise<SdkState | null>;
};

type SdkTrack = {
  name: string;
  uri: string;
  duration_ms?: number;
  album?: { images?: { url: string }[] };
  artists?: { name: string }[];
};

type SdkState = {
  paused: boolean;
  position: number;
  duration: number;
  shuffle?: boolean;
  context?: { uri?: string };
  track_window: {
    current_track: SdkTrack;
    next_tracks?: SdkTrack[];
    previous_tracks?: SdkTrack[];
  };
};

type SpotifySdk = {
  Player: new (opts: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
    enableMediaSession?: boolean;
  }) => SdkPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifySdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export type SpotifyDevicePlayer = {
  deviceId: string;
  toggle: () => Promise<void>;
  resume: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  /** Unlocks the audio element; only works inside a user-gesture handler. */
  activate: () => Promise<void>;
  playContext: (contextUri: string, offsetUri?: string) => Promise<void>;
  disconnect: () => void;
};

export type SpotifyPlayerEvent = { type: "autoplay_failed" | "playback_error"; message?: string };

export const SPOTIFY_BOOT_CANCELLED = "spotify-boot-cancelled";

/**
 * `spotify:user:x:playlist:id` and `spotify:playlist:id` are the same context.
 * Treating them as different re-sends PUT /play and skips / kills the stream.
 */
export function canonicalSpotifyUri(uri: string): string {
  return uri.trim().replace(/^spotify:user:[^:]+:/i, "spotify:");
}

export function sameSpotifyContext(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return canonicalSpotifyUri(a) === canonicalSpotifyUri(b);
}

export function isSpotifyTargetActive(now: SpotifyNowPlaying | null, targetUri: string | null): boolean {
  if (!now || !targetUri) return false;
  return sameSpotifyContext(now.contextUri, targetUri) || sameSpotifyContext(now.uri, targetUri);
}

let sdkLoading: Promise<SpotifySdk> | null = null;
let activeDevice: SpotifyDevicePlayer | null = null;
let booting: { generation: number; promise: Promise<SpotifyDevicePlayer> } | null = null;
let bootGeneration = 0;
let playInFlight: Promise<void> | null = null;
let playInFlightKey: string | null = null;
let playQueued: { deviceId: string; contextUri: string; offsetUri?: string } | null = null;
let lastPlayKey: string | null = null;

const listeners = new Set<(state: SpotifyNowPlaying | null) => void>();
let lastState: SpotifyNowPlaying | null = null;

function publish(state: SpotifyNowPlaying | null) {
  lastState = state;
  for (const fn of listeners) fn(state);
}

export function getSpotifyNow(): SpotifyNowPlaying | null {
  return lastState;
}

export function subscribeSpotifyState(fn: (state: SpotifyNowPlaying | null) => void): () => void {
  listeners.add(fn);
  fn(lastState);
  return () => { listeners.delete(fn); };
}

const deviceListeners = new Set<(device: SpotifyDevicePlayer | null) => void>();

function publishDevice() {
  for (const fn of deviceListeners) fn(activeDevice);
}

export function subscribeSpotifyDevice(fn: (device: SpotifyDevicePlayer | null) => void): () => void {
  deviceListeners.add(fn);
  fn(activeDevice);
  return () => { deviceListeners.delete(fn); };
}

const eventListeners = new Set<(event: SpotifyPlayerEvent) => void>();

function publishEvent(event: SpotifyPlayerEvent) {
  for (const fn of eventListeners) fn(event);
}

export function subscribeSpotifyEvents(fn: (event: SpotifyPlayerEvent) => void): () => void {
  eventListeners.add(fn);
  return () => { eventListeners.delete(fn); };
}

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
const SDK_LOAD_MS = 12_000;
const DEVICE_READY_MS = 8_000;
const GECKO_DEVICE_READY_MS = 20_000;
const DEVICE_LIST_WAIT_MS = 3_000;
const DEVICE_NOT_FOUND_RETRY_MS = 700;
const BOOT_RETRY_DELAY_MS = 1_000;
const TIMEOUT_PREFIX = "Spotify ha tardado";

type ArmedPlayer = {
  player: SdkPlayer;
  ready: Promise<string>;
  generation: number;
};

let armed: ArmedPlayer | null = null;
let drmPoisoned = false;
let playbackFailed = false;
let iframeAllowHooked = false;
let lastSdkState: SdkState | null = null;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

function deviceReadyTimeoutMs(): number {
  return isSpotifyGecko() ? GECKO_DEVICE_READY_MS : DEVICE_READY_MS;
}

/** True after DRM/autoplay failure until the next successful Play. */
export function spotifyNeedsUserReplay(): boolean {
  return drmPoisoned || playbackFailed;
}

export const SPOTIFY_ZEN_UNSUPPORTED_MSG =
  "Zen Browser aún no tiene licencia Widevine (DRM). Spotify no puede reproducirse aquí. Usa Firefox, Chrome/Brave o la app de escritorio.";

/** Zen on Windows/macOS lacks a Widevine license — Spotify Web Playback SDK cannot work. */
export function isSpotifyZen(): boolean {
  const ua = navigator.userAgent;
  return /\bZen\b|\bZenBrowser\b/i.test(ua);
}

/** Firefox and other Gecko builds — not Chrome/Edge/Zen. */
export function isSpotifyGecko(): boolean {
  if (isSpotifyZen()) return false;
  const ua = navigator.userAgent;
  return /Gecko\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (!ua) return true;
  return ua.isActive;
}

const IFRAME_ALLOW = "encrypted-media *; autoplay *; encrypted-media; autoplay";

function ensureIframeAllow(el: HTMLIFrameElement) {
  const current = el.getAttribute("allow") ?? "";
  if (/encrypted-media/i.test(current) && /autoplay/i.test(current)) return;
  el.setAttribute("allow", current ? `${current}; ${IFRAME_ALLOW}` : IFRAME_ALLOW);
}

function wrapIframeAllow(el: HTMLIFrameElement) {
  ensureIframeAllow(el);
  el.setAttribute("allowfullscreen", "true");
  const originalSet = el.setAttribute.bind(el);
  el.setAttribute = ((name: string, value: string) => {
    if (String(name).toLowerCase() === "allow" && !/encrypted-media/i.test(value)) {
      value = `${value}; ${IFRAME_ALLOW}`;
    }
    originalSet(name, value);
  }) as typeof el.setAttribute;
}

/**
 * Spotify requires `allow="encrypted-media"` on the SDK iframe *before* it
 * loads. Setting it afterwards is too late on Firefox (preview ~10s then cut).
 * Chromium ignores a missing allow; Gecko then only plays a short preview.
 */
function hookIframeEncryptedMedia() {
  if (iframeAllowHooked) return;
  iframeAllowHooked = true;
  const originalCreate = document.createElement.bind(document);
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const el = originalCreate(tagName, options);
    if (String(tagName).toLowerCase() === "iframe") wrapIframeAllow(el as HTMLIFrameElement);
    return el;
  }) as typeof document.createElement;
  const originalNs = document.createElementNS.bind(document);
  document.createElementNS = ((ns: string | null, tagName: string, options?: ElementCreationOptions | string) => {
    const el = originalNs(ns, tagName, options as ElementCreationOptions);
    if (String(tagName).toLowerCase() === "iframe") wrapIframeAllow(el as HTMLIFrameElement);
    return el;
  }) as typeof document.createElementNS;
}

function discardPlayer() {
  bootGeneration += 1;
  playInFlight = null;
  playInFlightKey = null;
  playQueued = null;
  lastPlayKey = null;
  lastState = null;
  lastSdkState = null;
  booting = null;
  armed?.player.disconnect();
  armed = null;
  activeDevice = null;
  publish(null);
  publishDevice();
}

function revealSdkIframe() {
  const iframe = document.querySelector("iframe[src*='sdk.scdn.co'], iframe[src*='spotify.com']") as HTMLIFrameElement | null;
  if (!iframe) return;
  ensureIframeAllow(iframe);
  iframe.style.setProperty("display", "block", "important");
  iframe.style.setProperty("position", "fixed", "important");
  iframe.style.setProperty("left", "auto", "important");
  iframe.style.setProperty("right", "0", "important");
  iframe.style.setProperty("bottom", "0", "important");
  iframe.style.setProperty("width", "16px", "important");
  iframe.style.setProperty("height", "16px", "important");
  iframe.style.setProperty("opacity", "1", "important");
  iframe.style.setProperty("pointer-events", "none", "important");
  iframe.style.setProperty("border", "0", "important");
  iframe.style.setProperty("z-index", "2", "important");
}

function watchSdkIframe() {
  revealSdkIframe();
  const observer = new MutationObserver(() => revealSdkIframe());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style", "allow"] });
  window.setTimeout(() => observer.disconnect(), 20_000);
}

function loadSdk(): Promise<SpotifySdk> {
  hookIframeEncryptedMedia();
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise((resolve, reject) => {
    let settled = false;
    const stop = () => {
      window.clearInterval(poll);
      window.clearTimeout(timer);
    };
    const done = () => {
      if (settled || !window.Spotify) return;
      settled = true;
      stop();
      resolve(window.Spotify);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      stop();
      sdkLoading = null;
      reject(new Error(message));
    };
    const poll = window.setInterval(done, 100);
    const timer = window.setTimeout(() => fail("Spotify ha tardado demasiado en cargar el reproductor."), SDK_LOAD_MS);
    window.onSpotifyWebPlaybackSDKReady = done;
    if (document.querySelector(`script[src="${SDK_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => fail("No se pudo cargar el reproductor de Spotify.");
    document.head.appendChild(script);
  });
  return sdkLoading;
}

export function warmSpotifyPlayer() {
  hookIframeEncryptedMedia();
  void loadSdk().catch(() => undefined);
  void spotifyAccessToken().catch(() => undefined);
}

export function isSpotifySdkReady(): boolean {
  return Boolean(window.Spotify);
}

export function whenSpotifySdkReady(): Promise<void> {
  return loadSdk().then(() => undefined);
}

/**
 * Call from a click handler with no awaits beforehand.
 * `new Player()`, `activateElement()` and `connect()` must share that
 * user-activation stack; otherwise Chrome/Firefox block Widevine and audio dies at ~10s.
 * Never construct a Player after an await — bootDevice reuses this instance.
 */
export function armSpotifyFromUserGesture(volume: number): boolean {
  hookIframeEncryptedMedia();
  primeSpotifyAccessToken();
  const sdk = window.Spotify;
  if (!sdk) return false;
  // Firefox/Zen: mousedown is not a user activation. Building the Player there
  // poisons Widevine and audio dies at ~10s. Wait for a real click.
  if (!hasUserActivation()) return false;

  if (drmPoisoned) {
    discardPlayer();
    drmPoisoned = false;
    armed = attachPlayer(sdk, volume, bootGeneration);
    return true;
  }
  if (activeDevice) {
    void activeDevice.activate();
    return true;
  }
  if (armed && armed.generation === bootGeneration) {
    void armed.player.activateElement();
    return true;
  }
  if (booting && booting.generation === bootGeneration) {
    if (armed) void armed.player.activateElement();
    return true;
  }
  armed = attachPlayer(sdk, volume, bootGeneration);
  return true;
}

function mapSdkTrack(track: SdkTrack | undefined): SpotifyTrack | null {
  if (!track?.uri || !track.name) return null;
  return {
    uri: track.uri,
    name: track.name,
    artists: (track.artists ?? []).map((item) => item.name).join(", "),
    durationMs: track.duration_ms ?? 0,
    image: track.album?.images?.[0]?.url ?? null,
  };
}

function mapState(state: SdkState | null): SpotifyNowPlaying | null {
  lastSdkState = state;
  const track = state?.track_window.current_track;
  if (!state || !track) return null;
  return {
    name: track.name,
    artists: (track.artists ?? []).map((item) => item.name).join(", "),
    image: track.album?.images?.[0]?.url ?? null,
    durationMs: state.duration || track.duration_ms || 0,
    positionMs: state.position,
    paused: state.paused,
    uri: track.uri,
    contextUri: state.context?.uri ?? null,
    shuffle: Boolean(state.shuffle),
  };
}

export function getSpotifySdkWindowTracks(): SpotifyTrack[] {
  const windowTracks = lastSdkState?.track_window;
  if (!windowTracks) return [];
  const tracks: SpotifyTrack[] = [];
  for (const item of [...(windowTracks.previous_tracks ?? []), windowTracks.current_track, ...(windowTracks.next_tracks ?? [])]) {
    const mapped = mapSdkTrack(item);
    if (mapped) tracks.push(mapped);
  }
  return tracks;
}

export function getActiveSpotifyDevice(): SpotifyDevicePlayer | null {
  return activeDevice;
}

export function pauseActiveSpotifyDevice() {
  void activeDevice?.pause();
}

export function stopActiveSpotifyDevice() {
  drmPoisoned = false;
  lastSdkState = null;
  discardPlayer();
  publish(null);
}

export function startSpotifyDevice(volume: number): Promise<SpotifyDevicePlayer> {
  if (activeDevice) return Promise.resolve(activeDevice);
  if (booting && booting.generation === bootGeneration) return booting.promise;
  const generation = bootGeneration;
  const promise = bootWithRetry(volume, generation);
  booting = { generation, promise };
  const clear = () => { if (booting?.promise === promise) booting = null; };
  promise.then(clear, clear);
  return promise;
}

async function bootWithRetry(volume: number, generation: number): Promise<SpotifyDevicePlayer> {
  try {
    return await bootDevice(volume, generation);
  } catch (err: unknown) {
    if (generation !== bootGeneration) throw err;
    if (!(err instanceof Error) || !err.message.startsWith(TIMEOUT_PREFIX)) throw err;
    await new Promise<void>((resolve) => { window.setTimeout(resolve, BOOT_RETRY_DELAY_MS); });
    if (generation !== bootGeneration) throw new Error(SPOTIFY_BOOT_CANCELLED);
    return bootDevice(volume, generation);
  }
}

function playBody(contextUri: string, offsetUri?: string): Record<string, unknown> {
  const uri = canonicalSpotifyUri(contextUri);
  if (/:track:/.test(uri) && !uri.startsWith("spotify:playlist:") && !uri.startsWith("spotify:album:")) {
    return { uris: [uri] };
  }
  if (offsetUri) return { context_uri: uri, offset: { uri: offsetUri } };
  return { context_uri: uri };
}

function playKey(contextUri: string, offsetUri?: string): string {
  return `${canonicalSpotifyUri(contextUri)}\0${offsetUri ?? ""}`;
}

function startPutPlay(deviceId: string, contextUri: string, offsetUri?: string): Promise<void> {
  const body = playBody(contextUri, offsetUri);
  const key = playKey(contextUri, offsetUri);
  playInFlightKey = key;
  lastPlayKey = key;
  playInFlight = putPlay(deviceId, body).then(() => {
    playbackFailed = false;
  }, (err: unknown) => {
    lastPlayKey = null;
    playbackFailed = true;
    throw err;
  }).finally(() => {
    playInFlight = null;
    playInFlightKey = null;
    const next = playQueued;
    playQueued = null;
    if (next) void startPutPlay(next.deviceId, next.contextUri, next.offsetUri);
  });
  return playInFlight;
}

async function waitUntilDeviceListed(deviceId: string, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await spotifyApiFetch("https://api.spotify.com/v1/me/player/devices");
      if (res.ok) {
        const json = await res.json() as { devices?: { id?: string }[] };
        if ((json.devices ?? []).some((item) => item.id === deviceId)) return;
      }
    } catch {
      /* keep polling */
    }
    await waitMs(250);
  }
}

function isDeviceNotFound(status: number, body: string): boolean {
  return status === 404 && /device not found/i.test(body);
}

async function putPlay(deviceId: string, body: Record<string, unknown>): Promise<void> {
  const url = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
  const send = () => spotifyApiFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let res = await send();
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    // Firefox/Zen: `ready` fires before the Web API cluster has the device.
    // One retry of the same PUT is not a second Play — the first never landed.
    if (isDeviceNotFound(res.status, text)) {
      await waitUntilDeviceListed(deviceId, DEVICE_LIST_WAIT_MS);
      await waitMs(DEVICE_NOT_FOUND_RETRY_MS);
      res = await send();
      if (res.ok || res.status === 204) return;
      const retryText = await res.text().catch(() => "");
      throw new Error(`Spotify no ha podido reproducir esa lista. (${res.status}${retryText ? `: ${retryText}` : ""})`);
    }
    throw new Error(`Spotify no ha podido reproducir esa lista. (${res.status}${text ? `: ${text}` : ""})`);
  }
}

function attachPlayer(sdk: SpotifySdk, volume: number, generation: number): ArmedPlayer {
  const player = new sdk.Player({
    name: APP_NAME,
    volume: Math.min(1, Math.max(0, volume)),
    enableMediaSession: false,
    getOAuthToken: (cb) => {
      const sync = peekSpotifyAccessToken();
      if (sync) {
        cb(sync);
        return;
      }
      void (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const token = attempt === 0
              ? await spotifyAccessToken()
              : await refreshSpotifyAccessToken();
            if (token) {
              cb(token);
              return;
            }
          } catch {
            if (attempt === 0) {
              await new Promise<void>((resolve) => { window.setTimeout(resolve, 1_200); });
            }
          }
        }
        publishEvent({ type: "playback_error", message: "No se pudo renovar el token de Spotify." });
      })();
    },
  });

  const ready = new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      fn();
    };
    const fail = (message: string) => {
      finish(() => {
        player.disconnect();
        if (armed?.player === player) armed = null;
        reject(new Error(message));
      });
    };

    player.addListener("ready", ((payload: { device_id: string }) => {
      revealSdkIframe();
      const already = finished;
      finish(() => resolve(payload.device_id));
      if (already && armed?.player === player) {
        activeDevice = wrapDevice(player, payload.device_id);
        publishDevice();
      }
    }) as (payload: never) => void);
    player.addListener("not_ready", (() => {
      if (activeDevice) {
        activeDevice = null;
        publishDevice();
      }
    }) as (payload: never) => void);
    player.addListener("player_state_changed", ((state: SdkState | null) => {
      const mapped = mapState(state);
      if (!mapped) return;
      publish(mapped);
    }) as (payload: never) => void);
    player.addListener("initialization_error", ((e: { message?: string }) => {
      fail(e.message || "No se pudo iniciar Spotify.");
    }) as (payload: never) => void);
    player.addListener("authentication_error", ((e: { message?: string }) => {
      void refreshSpotifyAccessToken().catch(() => {
        publishEvent({ type: "playback_error", message: e.message || "Spotify ha rechazado la sesión." });
      });
    }) as (payload: never) => void);
    player.addListener("account_error", (() => {
      fail("El reproductor interno necesita Spotify Premium.");
    }) as (payload: never) => void);
    player.addListener("playback_error", ((e: { message?: string }) => {
      playbackFailed = true;
      lastPlayKey = null;
      if (lastState) publish({ ...lastState, paused: true });
      if (isSpotifyGecko()) drmPoisoned = true;
      publishEvent({ type: "playback_error", message: e.message });
    }) as (payload: never) => void);
    player.addListener("autoplay_failed", (() => {
      playbackFailed = true;
      lastPlayKey = null;
      if (isSpotifyGecko()) drmPoisoned = true;
      publishEvent({ type: "autoplay_failed" });
    }) as (payload: never) => void);

    hookIframeEncryptedMedia();
    watchSdkIframe();
    void player.activateElement();
    void player.connect().then((ok) => {
      revealSdkIframe();
      if (!ok) fail("Spotify no ha conectado el reproductor.");
    });
  });

  return { player, ready, generation };
}

function wrapDevice(player: SdkPlayer, deviceId: string): SpotifyDevicePlayer {
  return {
    deviceId,
    toggle: () => player.togglePlay().then(() => undefined, () => undefined),
    resume: () => player.resume().then(() => undefined, () => undefined),
    next: () => player.nextTrack().then(() => undefined, () => undefined),
    previous: () => player.previousTrack().then(() => undefined, () => undefined),
    seek: (ms) => player.seek(ms).then(() => undefined, () => undefined),
    setVolume: (value) => player.setVolume(Math.min(1, Math.max(0, value))),
    pause: () => player.pause().then(() => undefined, () => undefined),
    activate: () => player.activateElement(),
    playContext: (contextUri, offsetUri) => {
      const key = playKey(contextUri, offsetUri);
      const blocked = playbackFailed || drmPoisoned;
      if (!blocked && !offsetUri && lastState && !lastState.paused && isSpotifyTargetActive(lastState, contextUri)) {
        return Promise.resolve();
      }
      if (!blocked && !offsetUri && lastPlayKey === key && (playInFlight || (lastState && isSpotifyTargetActive(lastState, contextUri)))) {
        if (lastState?.paused) return player.resume().then(() => undefined, () => undefined);
        return playInFlight ?? Promise.resolve();
      }
      playQueued = null;
      if (playInFlight) {
        if (playInFlightKey === key) return playInFlight;
        playQueued = { deviceId, contextUri, offsetUri };
        return playInFlight;
      }
      return startPutPlay(deviceId, contextUri, offsetUri);
    },
    disconnect: () => {
      if (activeDevice?.deviceId === deviceId) {
        activeDevice = null;
        publishDevice();
      }
      player.disconnect();
    },
  };
}

async function bootDevice(volume: number, generation: number): Promise<SpotifyDevicePlayer> {
  if (!window.Spotify) await loadSdk();
  if (generation !== bootGeneration) throw new Error(SPOTIFY_BOOT_CANCELLED);
  const sdk = window.Spotify;
  if (!sdk) throw new Error("No se pudo cargar el reproductor de Spotify.");

  if (!armed || armed.generation !== generation) {
    throw new Error("Pulsa play otra vez para activar el audio de Spotify.");
  }

  let deviceId: string;
  try {
    deviceId = await Promise.race([
      armed.ready,
      new Promise<string>((_, reject) => {
        window.setTimeout(() => reject(new Error(`${TIMEOUT_PREFIX} demasiado en conectar.`)), deviceReadyTimeoutMs());
      }),
    ]);
  } catch (err) {
    if (generation !== bootGeneration) throw new Error(SPOTIFY_BOOT_CANCELLED);
    throw err;
  }

  if (!armed || armed.generation !== generation) throw new Error(SPOTIFY_BOOT_CANCELLED);
  await waitUntilDeviceListed(deviceId, isSpotifyGecko() ? DEVICE_LIST_WAIT_MS : 800);
  if (!armed || armed.generation !== generation) throw new Error(SPOTIFY_BOOT_CANCELLED);
  const device = wrapDevice(armed.player, deviceId);
  activeDevice = device;
  publishDevice();
  void armed.player.getCurrentState().then((state) => {
    const mapped = mapState(state);
    if (mapped) publish(mapped);
  }).catch(() => undefined);
  return device;
}

if (typeof document !== "undefined") hookIframeEncryptedMedia();

