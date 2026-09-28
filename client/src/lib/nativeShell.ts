const SHELL_UA = /KalendiarioShell/i;
const SHELL_VERSION_UA = /KalendiarioShell\/(\d+\.\d+\.\d+)/i;

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriEvent<T = unknown> = { event: string; id: number; payload: T };
type TauriEventApi = {
  listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
};

type TauriCurrentWindow = {
  label?: unknown;
  startDragging?: () => Promise<void> | void;
  onMoved?: (handler: (event: TauriEvent<{ x: number; y: number }>) => void) => Promise<() => void>;
};

type TauriGlobals = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
    metadata?: {
      currentWindow?: { label?: unknown };
    };
  };
  __TAURI__?: {
    core?: { invoke?: TauriInvoke };
    event?: TauriEventApi;
    window?: {
      getCurrentWindow?: () => TauriCurrentWindow | Promise<TauriCurrentWindow>;
    };
    notification?: {
      isPermissionGranted?: () => Promise<boolean>;
      requestPermission?: () => Promise<string>;
      sendNotification?: (options: { title: string; body?: string }) => Promise<void> | void;
    };
  };
};

export type InstallerMeta = { url: string; size: number; sha256: string };

export type InstallersResponse = {
  shellVersion: string;
  windows: InstallerMeta | null;
  android: InstallerMeta | null;
};

export type InstallPlatform = "windows" | "android" | "ios" | "other";

/** True when Kalendiario is running inside the Tauri wrapper, not a browser/PWA. */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && SHELL_UA.test(navigator.userAgent)) return true;
  return nativeInvoke() !== null;
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as TauriGlobals;
  if (typeof w.__TAURI_INTERNALS__?.invoke === "function") return w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
  if (typeof w.__TAURI__?.core?.invoke === "function") return w.__TAURI__.core.invoke.bind(w.__TAURI__.core);
  return null;
}

export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  const ios = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
}

export type BrowserBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NativeChatBubbleMode = "bubble" | "panel";

export type NativeChatBubbleReason = "open" | "resize" | "hide" | "close" | "tray";

export type NativeChatBubbleBounds = BrowserBounds;

/** Shared between the child and stage-2 main-window activation. */
export const NATIVE_CHAT_BUBBLE_POSITION_KEY = "dayly.chat.native.position";

export type NativeChatBubbleStoredPosition = NativeChatBubbleBounds & {
  mode: NativeChatBubbleMode;
};

/** State emitted by the shell to both the main and chat-bubble windows. */
export type NativeChatBubbleState = {
  visible: boolean;
  mode: NativeChatBubbleMode;
  /** Optional reason added by newer shells; older shells omit it. */
  reason: NativeChatBubbleReason | null;
  /** Optional close marker added by newer shells. */
  closed?: boolean;
  /** Future shell fields are retained without weakening the required fields. */
  [key: string]: unknown;
};

export const CHAT_BUBBLE_WINDOW_LABEL = "chat-bubble";
export const CHAT_BUBBLE_STATE_EVENT = "kalendiario-chat-bubble-state";

function validChatBubbleDimensions(mode: NativeChatBubbleMode, bounds: NativeChatBubbleBounds): boolean {
  const { width, height } = bounds;
  if (![width, height].every((value) => Number.isFinite(value))) return false;
  if (mode === "bubble") return width >= 48 && width <= 240 && height >= 48 && height <= 240;
  return width >= 280 && width <= 1600 && height >= 240 && height <= 1200;
}

export function isValidNativeChatBubblePosition(value: unknown): value is NativeChatBubbleStoredPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<NativeChatBubbleStoredPosition>;
  if (position.mode !== "bubble" && position.mode !== "panel") return false;
  const bounds = {
    left: position.left,
    top: position.top,
    width: position.width,
    height: position.height,
  };
  if (![bounds.left, bounds.top].every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 100_000)) return false;
  return validChatBubbleDimensions(position.mode, bounds as NativeChatBubbleBounds);
}

export function readNativeChatBubblePosition(): NativeChatBubbleStoredPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NATIVE_CHAT_BUBBLE_POSITION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidNativeChatBubblePosition(parsed)) return null;
    const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
    const left = Number.isFinite(screen.availLeft) ? screen.availLeft! : 0;
    const top = Number.isFinite(screen.availTop) ? screen.availTop! : 0;
    const width = Number.isFinite(screen.availWidth) && screen.availWidth > 0 ? screen.availWidth : window.innerWidth;
    const height = Number.isFinite(screen.availHeight) && screen.availHeight > 0 ? screen.availHeight : window.innerHeight;
    const visible = parsed.left < left + width && parsed.left + parsed.width > left
      && parsed.top < top + height && parsed.top + parsed.height > top;
    return visible ? parsed : null;
  } catch {
    return null;
  }
}

export function persistNativeChatBubblePosition(mode: NativeChatBubbleMode, bounds: NativeChatBubbleBounds): void {
  if (typeof window === "undefined") return;
  const position: NativeChatBubbleStoredPosition = { mode, ...bounds };
  if (!isValidNativeChatBubblePosition(position)) return;
  try {
    window.localStorage.setItem(NATIVE_CHAT_BUBBLE_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Restricted storage must not stop the native bubble.
  }
}

export type BrowserState = { url: string };

/** Where a plain search goes when what was typed is not an address. */
const SEARCH_URL = "https://duckduckgo.com/?q=";

/**
 * What the user typed, as something the browser can open.
 *
 * A scheme is respected, something shaped like a domain gets https://, and
 * anything else is a search: typing `gatos` used to become `https://gatos` and
 * fail validation, which is not what anyone meant by it.
 */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (looksLikeHost(trimmed)) return `https://${trimmed}`;
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`;
}

/** A dotted name with no spaces, or localhost-style: that is an address. */
function looksLikeHost(text: string): boolean {
  if (/\s/.test(text)) return false;
  const host = text.split(/[/?#]/)[0] ?? "";
  return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?$/.test(host);
}

/**
 * The embedded WebView may only load public HTTPS. Blocks file:, localhost and RFC1918.
 * DNS rebinding is still possible; the Tauri command repeats the same host checks.
 */
export function isAllowedBrowserUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    return false;
  }
  if (host === "::1" || host === "0.0.0.0") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host)) return false;
  return true;
}

export function getNativeBrowserBounds(collapsed: boolean, toolbarHeight = 56): BrowserBounds {
  const compactViewport = typeof window !== "undefined" && window.innerWidth < 768;
  const sidebarWidth = compactViewport ? 0 : collapsed ? 72 : 256;
  return {
    left: sidebarWidth,
    top: toolbarHeight,
    width: Math.max(1, window.innerWidth - sidebarWidth),
    height: Math.max(1, window.innerHeight - toolbarHeight),
  };
}

/** Version embedded in the Windows wrapper user-agent (for shell updates). */
export function getNativeShellVersion(userAgent?: string): string | null {
  const value = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  return SHELL_VERSION_UA.exec(value)?.[1] ?? null;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Installed wrapper version, asking the binary first. The user-agent is a
 * hand-written copy in `tauri.conf.json` that has drifted before, so it is only
 * the fallback for wrappers older than the `shell_version` command (< 1.0.5).
 */
export async function resolveNativeShellVersion(): Promise<string | null> {
  const invoke = nativeInvoke();
  if (invoke) {
    try {
      const version = await invoke("shell_version");
      if (typeof version === "string" && SEMVER.test(version.trim())) return version.trim();
    } catch { /* Older wrappers do not expose the command; fall back below. */ }
  }
  return getNativeShellVersion();
}

/**
 * Version the wrapper's own updater would install, or null when it reports
 * nothing pending. Null from an older wrapper without the command means
 * "unknown", so callers must tell that apart from a confirmed "no update".
 */
export async function fetchNativeShellUpdate(): Promise<{ known: boolean; version: string | null }> {
  const invoke = nativeInvoke();
  if (!invoke) return { known: false, version: null };
  try {
    const version = await invoke("shell_update_available");
    if (version === null || version === undefined) return { known: true, version: null };
    return typeof version === "string" && SEMVER.test(version.trim())
      ? { known: true, version: version.trim() }
      : { known: false, version: null };
  } catch {
    return { known: false, version: null };
  }
}

/**
 * Returns the current Tauri window label when the global window API is
 * available. A missing label is deliberately treated as unknown: a browser
 * or an older shell must never be allowed to render the dedicated chat view.
 */
export async function getNativeWindowLabel(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const globals = window as TauriGlobals;
  const metadataLabel = globals.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  if (typeof metadataLabel === "string" && metadataLabel.trim()) return metadataLabel;

  const getCurrentWindow = globals.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") return null;
  try {
    const current = await getCurrentWindow();
    return typeof current?.label === "string" && current.label.trim() ? current.label : null;
  } catch {
    return null;
  }
}

/** The route is valid only inside the dedicated Tauri child window. */
export async function isNativeChatBubbleWindow(): Promise<boolean> {
  if (!isNativeShell()) return false;
  return (await getNativeWindowLabel()) === CHAT_BUBBLE_WINDOW_LABEL;
}

function isNativeChatBubbleMode(value: unknown): value is NativeChatBubbleMode {
  return value === "bubble" || value === "panel";
}

function isNativeChatBubbleReason(value: unknown): value is NativeChatBubbleReason {
  return value === "open" || value === "resize" || value === "hide" || value === "close" || value === "tray";
}

/** Runtime validation keeps malformed or future event payloads out of React. */
export function parseNativeChatBubbleState(value: unknown): NativeChatBubbleState | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.visible !== "boolean" || !isNativeChatBubbleMode(payload.mode)) return null;
  const { visible, mode, reason, closed, ...futureFields } = payload;
  const state: NativeChatBubbleState = {
    ...futureFields,
    visible,
    mode,
    reason: isNativeChatBubbleReason(reason) ? reason : null,
  };
  if (typeof closed === "boolean") state.closed = closed;
  return state;
}

/**
 * Opens the single native chat window. `false` is a safe no-op for a browser
 * or a pre-chat-bubble shell (for example 1.0.18), so stage 2 can retain its
 * web fallback without branching on shell internals.
 */
export async function openNativeChatBubble(mode: NativeChatBubbleMode, bounds?: NativeChatBubbleBounds): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    const args: Record<string, unknown> = { mode };
    if (bounds) args.bounds = bounds;
    await invoke("open_chat_bubble", args);
    return true;
  } catch {
    return false;
  }
}

/** Resizes or changes mode for the main window or the chat-bubble window. */
export async function resizeNativeChatBubble(mode: NativeChatBubbleMode, bounds: NativeChatBubbleBounds): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("resize_chat_bubble", { mode, bounds });
    return true;
  } catch {
    return false;
  }
}

/** Hides the native child; the shell broadcasts visible:false to both views. */
export async function hideNativeChatBubble(): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("hide_chat_bubble");
    return true;
  } catch {
    return false;
  }
}

/** Closes the native child and leaves the main window available. */
export async function closeNativeChatBubble(): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("close_chat_bubble");
    return true;
  } catch {
    return false;
  }
}

/** Child-only escape hatch: restore the main window so its PIN gate can run. */
export async function restoreMainForPin(): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("restore_main_for_pin");
    return true;
  } catch {
    return false;
  }
}

/** Reads the current native state so a child that missed `open` can recover. */
export async function getNativeChatBubbleState(): Promise<NativeChatBubbleState | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  try {
    return parseNativeChatBubbleState(await invoke("chat_bubble_state"));
  } catch {
    // Shells before the chat-bubble state command fail closed.
    return null;
  }
}

/** Moves only the native chat-bubble child without changing its mode or emitting state. */
export async function moveNativeChatBubble(left: number, top: number): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("move_chat_bubble", { left, top });
    return true;
  } catch {
    return false;
  }
}

/** Compatibility path for shells that expose Tauri's native drag API. */
export async function startNativeChatBubbleDragging(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const getCurrentWindow = (window as TauriGlobals).__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") return false;
  try {
    const current = await getCurrentWindow();
    if (typeof current?.startDragging !== "function") return false;
    await current.startDragging();
    return true;
  } catch {
    return false;
  }
}

/** Converts a Tauri physical window position into the logical pixels used by the shell commands. */
export function physicalToLogicalWindowPosition(x: number, y: number, scale: number): { left: number; top: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { left: Math.round(x / factor), top: Math.round(y / factor) };
}

/** Follows every OS move of the current native window, including native drags. */
export async function watchNativeWindowMoved(handler: (position: { left: number; top: number }) => void): Promise<() => void> {
  if (typeof window === "undefined") return () => {};
  const getCurrentWindow = (window as TauriGlobals).__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") return () => {};
  const current = await getCurrentWindow();
  if (typeof current?.onMoved !== "function") return () => {};
  return current.onMoved(({ payload }) => {
    const position = physicalToLogicalWindowPosition(payload?.x, payload?.y, window.devicePixelRatio);
    if (position) handler(position);
  });
}

/** Opens the shell menu outside the compact window at the pointer position. */
export async function showNativeChatBubbleMenu(): Promise<boolean> {
  const invoke = nativeInvoke();
  if (!invoke) return false;
  try {
    await invoke("show_chat_bubble_menu");
    return true;
  } catch {
    return false;
  }
}

/** Watches state transitions, ignoring malformed payloads and old-shell gaps. */
export function watchNativeChatBubbleState(handler: (state: NativeChatBubbleState) => void): Promise<() => void> {
  return listenNativeEvent<unknown>(CHAT_BUBBLE_STATE_EVENT, (payload) => {
    const state = parseNativeChatBubbleState(payload);
    if (state) handler(state);
  });
}

function requireNativeInvoke(): TauriInvoke {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("La app de escritorio no está disponible.");
  return invoke;
}

function nativeNotifications() {
  if (typeof window === "undefined") return null;
  return (window as TauriGlobals).__TAURI__?.notification ?? null;
}

/** Requests the Windows permission only from the explicit Settings action. */
export async function enableNativeNotifications(): Promise<{ ok: boolean; detail: string }> {
  const api = nativeNotifications();
  if (!api?.isPermissionGranted || !api.requestPermission || !api.sendNotification) {
    return { ok: false, detail: "Esta versión del .exe todavía no admite avisos nativos." };
  }
  try {
    let granted = await api.isPermissionGranted();
    if (!granted) granted = (await api.requestPermission()) === "granted";
    if (!granted) return { ok: false, detail: "Los avisos de Windows están bloqueados para Kalendiario." };
    await api.sendNotification({ title: "Prueba de avisos", body: "Kalendiario puede avisarte aunque esté en la bandeja." });
    return { ok: true, detail: "Avisos de Windows activados." };
  } catch {
    return { ok: false, detail: "No se pudieron activar los avisos de Windows." };
  }
}

/** Shows one native toast while the shell is hidden in the tray. */
export async function sendNativeNotification(title: string, body: string): Promise<boolean> {
  const api = nativeNotifications();
  if (!api?.isPermissionGranted || !api.sendNotification) return false;
  try {
    if (!(await api.isPermissionGranted())) return false;
    await api.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

export async function openNativeBrowser(url: string, bounds: BrowserBounds): Promise<void> {
  const href = normalizeBrowserUrl(url);
  if (!isAllowedBrowserUrl(href)) {
    throw new Error("Solo se admiten direcciones https públicas.");
  }
  const invoke = requireNativeInvoke();
  await invoke("open_browser", { url: href, bounds });
}

/** Show an existing browser without navigating it. Returns false if none exists. */
export async function showNativeBrowser(bounds: BrowserBounds): Promise<boolean> {
  return Boolean(await requireNativeInvoke()("show_browser", { bounds }));
}

/** Hide without closing so media and page state keep running. */
export async function hideNativeBrowser(): Promise<void> {
  await requireNativeInvoke()("hide_browser");
}

export async function resizeNativeBrowser(bounds: BrowserBounds): Promise<void> {
  await requireNativeInvoke()("resize_browser", { bounds });
}

export async function browserAction(action: "back" | "forward" | "reload" | "focus"): Promise<void> {
  await requireNativeInvoke()("browser_action", { action });
}

export async function getNativeBrowserState(): Promise<BrowserState | null> {
  const state = await requireNativeInvoke()("browser_state");
  return (state as BrowserState | null) ?? null;
}

export async function closeNativeBrowser(): Promise<void> {
  await requireNativeInvoke()("close_browser");
}

/** WARP in proxy mode listens here; the shell refuses anything but loopback. */
export const WARP_PROXY_URL = "socks5://127.0.0.1:40000";

export type BrowserProxyStatus = {
  /** The route in use right now, null for a direct connection. */
  proxy: string | null;
  defaultProxy: string;
  /** Whether something is actually listening on that port. */
  reachable: boolean;
};

export type BrowserProxyResult = {
  proxy: string | null;
  /** True when the open browser was rebuilt on the spot. */
  reopened: boolean;
};

/**
 * Changes how the browser reaches the internet.
 *
 * The proxy is baked into the webview when it is created, so switching means
 * building it again: the page comes back, everything inside it (scroll, forms,
 * the session of that site) does not.
 */
export async function setNativeBrowserProxy(proxy: string | null, bounds?: BrowserBounds): Promise<BrowserProxyResult> {
  const result = await requireNativeInvoke()("set_browser_proxy", { proxy, bounds: bounds ?? null });
  return result as BrowserProxyResult;
}

/** Null asks about the endpoint the shell offers, without changing anything. */
export async function nativeBrowserProxyStatus(proxy?: string | null): Promise<BrowserProxyStatus | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  try {
    return (await invoke("browser_proxy_status", { proxy: proxy ?? null })) as BrowserProxyStatus;
  } catch {
    // An older shell does not know the command; the toggle stays out of sight.
    return null;
  }
}

/** Cookies, cache and storage of the browser — never the app's own session. */
export async function clearNativeBrowserData(): Promise<{ complete: boolean }> {
  const result = await requireNativeInvoke()("clear_browser_data");
  return (result as { complete: boolean }) ?? { complete: false };
}

export type ShellUpdateProgress = {
  phase: "downloading" | "installing";
  downloaded: number;
  total: number | null;
};

export async function installNativeShellUpdate(): Promise<void> {
  await requireNativeInvoke()("install_shell_update");
}

export type NativeAudioFormat = { sampleRate: number; channels: number };

/** True when running inside a wrapper that can capture system audio. */
export function supportsAudioCapture(): boolean {
  if (typeof window === "undefined") return false;
  return nativeInvoke() !== null && typeof (window as TauriGlobals).__TAURI__?.event?.listen === "function";
}

const AUDIO_BLOCK_EVENT = "kalendiario-audio-block";

function decodeAudioBlock(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Subscribes to the system audio the wrapper captures. Blocks arrive as mono
 * 16-bit little-endian PCM, base64 encoded over the same event channel the
 * updater progress uses — a binary `Channel` never delivered anything to the
 * page, while this path is known to work here.
 */
export async function startNativeAudioCapture(
  onBlock: (pcm: ArrayBuffer) => void,
): Promise<{ format: NativeAudioFormat; stop: () => Promise<void> }> {
  const invoke = requireNativeInvoke();
  const unlisten = await listenNativeEvent<string>(AUDIO_BLOCK_EVENT, (payload) => {
    if (typeof payload === "string") onBlock(decodeAudioBlock(payload));
  });
  try {
    const format = (await invoke("start_audio_capture")) as NativeAudioFormat;
    return {
      format,
      stop: async () => {
        unlisten();
        await invoke("stop_audio_capture");
      },
    };
  } catch (error) {
    unlisten();
    throw error;
  }
}

export type NativeCaptureStatus = {
  running: boolean;
  blocksSent: number;
  subscribers: number;
  lastError: string | null;
};

/** Tells "still starting" apart from "the device is sending nothing". */
export async function nativeAudioCaptureStatus(): Promise<NativeCaptureStatus | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  try {
    return (await invoke("audio_capture_status")) as NativeCaptureStatus;
  } catch {
    return null;
  }
}

/** Opens the visualizer in its own window, so it can live on another screen. */
export async function openNativeVisualizerWindow(): Promise<void> {
  await requireNativeInvoke()("open_visualizer_window");
}

/** Closes it from the wrapper, so a stuck page still has a way out. */
export async function closeNativeVisualizerWindow(): Promise<void> {
  const invoke = nativeInvoke();
  if (!invoke) return;
  await invoke("close_visualizer_window");
}

/** Parks the window next to the clock, out of the taskbar. */
export async function hideNativeToTray(): Promise<void> {
  const invoke = nativeInvoke();
  if (!invoke) return;
  try {
    await invoke("hide_to_tray");
  } catch {
    /* Not in the wrapper, or the window is already gone. */
  }
}

/**
 * Pulses the taskbar button until the user comes back, the way chat apps do.
 * Silently ignored outside the wrapper: the browser has no equivalent.
 */
export async function flashNativeTaskbar(on: boolean): Promise<void> {
  const invoke = nativeInvoke();
  if (!invoke) return;
  try {
    await invoke("flash_taskbar", { on });
  } catch {
    /* Not worth surfacing: the message and the sound already landed. */
  }
}

export async function listenNativeEvent<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (typeof window === "undefined") return () => {};
  const api = (window as TauriGlobals).__TAURI__?.event;
  if (!api || typeof api.listen !== "function") return () => {};
  return api.listen<T>(event, (message) => handler(message.payload));
}
