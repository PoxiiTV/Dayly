import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Search, Bell, MessagesSquare, Plus, PanelLeftClose, PanelLeftOpen, Settings, X, Menu, MoreHorizontal, SlidersHorizontal, LayoutGrid, ChevronDown, Check as CheckIcon } from "lucide-react";
import clsx from "clsx";
import { NAV, LogOut, MOBILE_TABS, type AppId, type AppItem } from "@/lib/nav";
import { canHideNavItem, CHAT_SIDEBAR_EVENT, MASCOT_SIDEBAR_EVENT, useOrderedApps, useOrderedNav } from "@/lib/navOrder";
import { useReorder, type ReorderItemProps } from "@/lib/useReorder";
import { Calculator } from "@/components/Calculator";
import { useAuth } from "@/lib/auth";
import { useTheme, useThemeWave } from "@/lib/theme";
import { Avatar, usePresence } from "@/components/ui";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickAdd, type QuickKind } from "@/components/QuickAdd";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { AlertEngine } from "@/lib/AlertEngine";
import { MascotLauncher, MascotWidget } from "@/components/MascotWidget";
import { ChatSidebarWidget } from "@/components/chat/ChatSidebarWidget";
import { RadioMiniPlayer, RadioProvider } from "@/components/RadioPlayer";
import { VaultProvider } from "@/lib/vault";
import { http } from "@/lib/api";
import { BrandLogo, SunMoon } from "@/components/icons";
import { BrandName } from "@/components/BrandName";
import { AppVersion } from "@/components/AppVersion";
import { VisualizerBackground, canUseVisualizer } from "@/lib/visualizer/background";
import { ChatPresenceProvider, useChatPresence } from "@/lib/ChatPresence";
import { InstallPrompt } from "@/components/InstallPrompt";
import { InstallAppModal } from "@/components/InstallAppModal";
import { EmbeddedBrowserPanel } from "@/components/EmbeddedBrowserPanel";
import { ShellUpdateNotice } from "@/components/ShellUpdateNotice";
import { closeNativeBrowser, hideNativeBrowser, isNativeShell, listenNativeEvent, openNativeVisualizerWindow } from "@/lib/nativeShell";
import { paintWallpaper, parseWallpaper } from "@/lib/wallpapers";
import { persistNotifySound, parseNotifySound, unlockNotifyAudio } from "@/lib/notifySounds";
import { ReleaseNotesModal } from "@/components/ReleaseNotesModal";
import { useVirtualKeyboardOpen } from "@/lib/useVirtualKeyboard";
import { watchTrayState } from "@/lib/trayState";
import { ReleaseUpdateButton } from "@/components/ReleaseUpdateButton";
import { useReleaseUpdate, type ReleaseUpdateState } from "@/lib/releaseUpdate";
import { QuickPinGate } from "@/components/QuickPinGate";
import { FloatingChatBubble } from "@/components/chat/FloatingChatBubble";
import { FloatingChatProvider, useFloatingChat } from "@/lib/FloatingChat";

const SIDEBAR_KEY = "dayly.sidebar";
const APPS_EXPANDED_KEY = "dayly.sidebar.apps.expanded";
const MASCOT_DOCKED_KEY = "dayly.mascot.docked";
const MASCOT_DOCK_WIDTH_KEY = "dayly.mascot.dock.width.v1";
const DOCK_MIN = 280;
const DOCK_MAX = 640;
const MAIN_MIN = 320;
const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";
const PAGE_FADE_MS = 500;

function clampDockWidth(value: number, collapsed: boolean): number {
  const navWidth = collapsed ? 72 : 256;
  const max = Math.max(DOCK_MIN, Math.min(DOCK_MAX, window.innerWidth - navWidth - MAIN_MIN));
  return Math.min(max, Math.max(DOCK_MIN, Math.round(value)));
}

function loadDockWidth(collapsed: boolean): number {
  const raw = Number(localStorage.getItem(MASCOT_DOCK_WIDTH_KEY));
  return clampDockWidth(Number.isFinite(raw) ? raw : 400, collapsed);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

function hasOpenDialog(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

function DissolvingOutlet() {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (first.current) {
      first.current = false;
      return;
    }
    el.style.transition = "none";
    el.style.opacity = "0";
    void el.offsetHeight;
    el.style.transition = `opacity ${PAGE_FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    el.style.opacity = "1";
  }, [location.pathname]);

  return (
    <div ref={ref}>
      <Outlet />
    </div>
  );
}

/** Connect the existing web PIN gate to the single floating-chat context. */
function FloatingChatQuickPinGate({ children }: { children: React.ReactNode }) {
  const { setLocked } = useFloatingChat();
  return <QuickPinGate onLockedChange={setLocked}>{children}</QuickPinGate>;
}

export function AppShell() {
  const { user, logout, isAdmin, applyTheme } = useAuth();
  const { resolved, hydrate } = useTheme();
  const releaseUpdate = useReleaseUpdate();
  const themeWave = useThemeWave();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [mascotDocked, setMascotDocked] = useState(() => localStorage.getItem(MASCOT_DOCKED_KEY) === "1");
  const [mascotSidebar, setMascotSidebar] = useState(() => user?.navLayout?.mascotSidebar === true);
  const [chatSidebar, setChatSidebar] = useState(() => user?.navLayout?.chatSidebar === true);
  const [mascotDockWidth, setMascotDockWidth] = useState(() => loadDockWidth(collapsed));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<QuickKind | undefined>();
  const [calcOpen, setCalcOpen] = useState(false);
  const [installAppOpen, setInstallAppOpen] = useState(false);
  const [nativeBrowserOpen, setNativeBrowserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openQuick = useCallback((kind?: QuickKind) => {
    setQuickKind(kind);
    setQuickOpen(true);
  }, []);
  const hideBrowser = useCallback(async () => {
    if (!nativeBrowserOpen) return;
    try {
      await hideNativeBrowser();
      setNativeBrowserOpen(false);
    } catch {
      // Shell 1.0.0 cannot hide child WebViews; its update notice stays visible.
    }
  }, [nativeBrowserOpen]);

  useEffect(() => {
    if (!nativeBrowserOpen || !isNativeShell()) return;
    let active = true;
    let unlisten = () => {};
    void listenNativeEvent("dayly-browser-pip-entered", () => void hideBrowser())
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => { /* PiP remains usable even if automatic return is unavailable. */ });
    return () => {
      active = false;
      unlisten();
    };
  }, [hideBrowser, nativeBrowserOpen]);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"), [collapsed]);
  useEffect(() => localStorage.setItem(MASCOT_DOCKED_KEY, mascotDocked ? "1" : "0"), [mascotDocked]);
  useEffect(() => localStorage.setItem(MASCOT_DOCK_WIDTH_KEY, String(mascotDockWidth)), [mascotDockWidth]);
  useEffect(() => {
    const onMascotSidebarChange = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value === "boolean") setMascotSidebar(value);
    };
    window.addEventListener(MASCOT_SIDEBAR_EVENT, onMascotSidebarChange);
    return () => window.removeEventListener(MASCOT_SIDEBAR_EVENT, onMascotSidebarChange);
  }, []);
  useEffect(() => {
    const onChatSidebarChange = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value === "boolean") setChatSidebar(value);
    };
    window.addEventListener(CHAT_SIDEBAR_EVENT, onChatSidebarChange);
    return () => window.removeEventListener(CHAT_SIDEBAR_EVENT, onChatSidebarChange);
  }, []);
  useEffect(() => {
    if (!user) return;
    const mascot = user.navLayout?.mascotSidebar === true;
    setMascotSidebar(mascot);
    setChatSidebar(user.navLayout?.chatSidebar === true && !mascot);
  }, [user?.id, user?.navLayout?.mascotSidebar, user?.navLayout?.chatSidebar]);
  useEffect(() => {
    // The compact sidebar chat and the full right dock are alternative homes.
    if (mascotSidebar && mascotDocked) setMascotDocked(false);
  }, [mascotSidebar, mascotDocked]);
  useEffect(() => {
    const resize = () => setMascotDockWidth((width) => clampDockWidth(width, collapsed));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [collapsed]);

  useEffect(() => {
    if (!user) return;
    hydrate(user.theme, user.skin, {
      enabled: user.themeScheduleEnabled,
      startMin: user.themeDarkStartMin,
      endMin: user.themeDarkEndMin,
    }, user.timezone);
    paintWallpaper(parseWallpaper(user.wallpaper));
    persistNotifySound(parseNotifySound(user.notifySound));
  }, [user?.id, hydrate]);

  useEffect(() => {
    const unlock = () => unlockNotifyAudio();
    document.addEventListener("pointerdown", unlock, { capture: true });
    return () => document.removeEventListener("pointerdown", unlock, { capture: true });
  }, []);

  // Global shortcuts. Use e.code so Alt does not depend on keyboard layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[data-quick-pin-lock]")) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyK") { e.preventDefault(); setPaletteOpen((v) => !v); }
        return;
      }
      if (e.key === "Enter" && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing) {
        if (quickOpen || paletteOpen || calcOpen || hasOpenDialog() || isTypingTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openQuick();
        return;
      }
      if (!e.altKey || e.repeat) return;
      switch (e.code) {
        case "KeyC":
          e.preventDefault();
          void hideBrowser();
          setCalcOpen((v) => !v);
          return;
        case "KeyN":
          e.preventDefault();
          openQuick("task");
          return;
        case "KeyE":
          e.preventDefault();
          openQuick("event");
          return;
        case "KeyM":
          e.preventDefault();
          void hideBrowser();
          navigate("/day");
          return;
        case "KeyT":
          e.preventDefault();
          void hideBrowser();
          navigate("/tasks");
          return;
        case "KeyA":
          e.preventDefault();
          void hideBrowser();
          navigate("/chat");
          return;
        case "KeyV":
          // Only the wrapper can capture audio, so only it has a visualizer.
          if (!canUseVisualizer()) return;
          e.preventDefault();
          void openNativeVisualizerWindow();
          return;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [navigate, openQuick, quickOpen, paletteOpen, calcOpen, hideBrowser]);
  const openApp = useCallback((id: AppId) => {
    switch (id) {
      case "calculator":
        void hideBrowser();
        setCalcOpen(true);
        return;
      case "vault":
        void hideBrowser();
        navigate("/vault");
        return;
      case "chat":
        void hideBrowser();
        navigate("/chat");
        return;
      case "browser":
        if (isNativeShell()) setNativeBrowserOpen(true);
        else setInstallAppOpen(true);
        return;
      default: {
        const _never: never = id;
        return _never;
      }
    }
  }, [hideBrowser, navigate]);

  const previousPath = useRef(location.pathname);
  useEffect(() => {
    const changed = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (changed) void hideBrowser();
  }, [hideBrowser, location.pathname]);

  // The dashboard already renders the full radio card; elsewhere only the strip.
  const showMiniRadio = location.pathname !== "/" && location.pathname !== "/vault";
  const keyboardOpen = useVirtualKeyboardOpen();
  // Ctrl+Espacio is registered by the shell itself, so it also works while the
  // window is hidden; here we only follow what it decided.
  useEffect(() => watchTrayState(), []);
  const hideMascot = location.pathname === "/vault";

  const handleLogout = async () => {
    if (isNativeShell()) {
      await closeNativeBrowser().catch(() => {});
      setNativeBrowserOpen(false);
    }
    await logout();
    navigate("/login");
  };

  const cycleTheme = (e?: React.SyntheticEvent) => {
    const next: "LIGHT" | "DARK" = resolved === "dark" ? "LIGHT" : "DARK";
    themeWave(next, e as never);
    if (user) void applyTheme(next);
  };

  return (
    <FloatingChatProvider>
    <FloatingChatQuickPinGate>
    <VaultProvider>
    <ChatPresenceProvider>
    <RadioProvider>
    <div className="min-h-screen flex flex-col">
      <VisualizerBackground />
      {!IS_DEMO && <AlertEngine />}
      {!IS_DEMO && <InstallPrompt />}
      <ReleaseNotesModal />
      <ShellUpdateNotice />
      <div className="flex-1 min-h-0 md:flex">
      {/* Desktop sidebar */}
      <aside className={clsx("hidden md:flex flex-col border-r border-border bg-surface transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] sticky top-0 h-screen",
        collapsed ? "w-[72px]" : "w-64")}>
        <SidebarContent collapsed={collapsed} isAdmin={isAdmin} onCycleTheme={cycleTheme} showMiniRadio={showMiniRadio} showMascot={!hideMascot} mascotSidebar={mascotSidebar} chatSidebar={chatSidebar} mascotDocked={mascotDocked} mascotDockWidth={mascotDockWidth} onDockChange={setMascotDocked} onDockWidthChange={(width) => setMascotDockWidth(clampDockWidth(width, collapsed))} onOpenApp={openApp} onNavigate={() => void hideBrowser()} appActive={nativeBrowserOpen ? "browser" : calcOpen ? "calculator" : location.pathname === "/vault" ? "vault" : null} releaseUpdate={releaseUpdate} />
        <button onClick={() => setCollapsed(!collapsed)} className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-surface border border-border grid place-items-center text-muted hover:text-text shadow-soft z-10">
          {collapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
        </button>
      </aside>

      {/* Mobile chrome: notch once, demo strip, then top bar */}
      <div className="md:hidden sticky top-0 z-40 safe-top bg-bg/90 backdrop-blur-md border-b border-border">
        {IS_DEMO && (
          <div className="flex items-center justify-center gap-2 bg-amber-400 text-amber-950 px-3 py-1.5" role="status">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]">Modo demo</span>
            <span className="w-px h-3 bg-amber-950/20" aria-hidden />
            <span className="text-[11px] font-medium text-amber-950/80">Se reinicia al recargar</span>
          </div>
        )}
        <div className="flex items-center gap-1 px-2 h-14">
        <button onClick={() => setMenuOpen(true)} aria-label="Abrir menú" className="btn-ghost btn-icon -ml-1"><Menu className="w-5 h-5" /></button>
        {/* The version is its own link (changelog), so it sits beside the home link, not inside it. */}
        <div className="flex items-center gap-2 min-w-0">
          <NavLink to="/" onClick={() => void hideBrowser()} aria-label="Inicio" className="shrink-0">
            <BrandLogo className="w-7 h-7" />
          </NavLink>
          <span className="flex flex-col min-w-0 leading-none">
            <NavLink to="/" onClick={() => void hideBrowser()}><BrandName className="text-text" /></NavLink>
            <AppVersion className="mt-0.5" />
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {!hideMascot && <MascotLauncher />}
          <button onClick={() => setPaletteOpen(true)} aria-label="Buscar" className="btn-ghost btn-icon"><Search className="w-5 h-5" /></button>
          <button onClick={() => setNotifOpen(true)} aria-label="Notificaciones" className="btn-ghost btn-icon relative"><Bell className="w-5 h-5" /><NotifDot /></button>
          <ReleaseUpdateButton {...releaseUpdate} />
          <button onClick={(e) => cycleTheme(e)} aria-label="Tema" className="btn-ghost btn-icon"><SunMoon className="w-5 h-5" /></button>
        </div>
        </div>
      </div>

      {/* Main content */}
      <main className="dayly-page mascot-dock-main flex-1 min-w-0 md:px-8 md:py-7 px-4 pt-6 pb-24 md:pb-8 transition-[margin] duration-300" style={{ "--mascot-dock-w": !hideMascot && mascotDocked ? `${mascotDockWidth}px` : "0px" } as React.CSSProperties}>
        <DissolvingOutlet />
      </main>

      {/* Mobile bottom tab bar */}
      {/* Hidden while typing: the keyboard already owns the bottom of the
          screen and the bar would only steal another row of content. */}
      <nav className={clsx("md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border safe-bottom",
        keyboardOpen && "hidden")}>
        {/* Two tabs, "crear" in the middle and two more: the thumb reaches the
            button without covering a section. "Más" lives in the top bar. */}
        <div className="grid grid-cols-5">
          {MOBILE_TABS.slice(0, 2).map((t) => <MobileTab key={t.to} tab={t} onNavigate={() => void hideBrowser()} />)}
          <div className="grid place-items-center">
            <button onClick={() => openQuick()} aria-label="Crear"
              className="-mt-5 w-14 h-14 rounded-2xl bg-accent text-white grid place-items-center shadow-pop ring-4 ring-surface active:scale-95 transition-all">
              <Plus className="w-6 h-6" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map((t) => <MobileTab key={t.to} tab={t} onNavigate={() => void hideBrowser()} />)}
          <button onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-faint">
            <MoreHorizontal className="w-5 h-5" />
            Más
          </button>
        </div>
      </nav>

      {/* Desktop floating "+": above every page, including the chat, which now
          runs edge to edge. Below modals (z-100) and toasts (z-90). The
          calculator is in APP'S in the sidebar and on Alt+C. */}
      <div
        className="mascot-dock-fab hidden md:flex flex-row items-center gap-2.5 fixed bottom-7 z-[60]"
        style={{ "--mascot-dock-w": !hideMascot && mascotDocked ? `${mascotDockWidth}px` : "0px" } as React.CSSProperties}
      >
        <button type="button" onClick={() => openQuick()} aria-label="Crear elemento" title="Crear"
          className="w-14 h-14 rounded-2xl bg-accent text-white grid place-items-center shadow-pop hover:bg-accent-strong active:scale-95 transition-all">
          <Plus className="w-6 h-6" />
        </button>
      </div>

      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickAdd open={quickOpen} onClose={() => setQuickOpen(false)} initialKind={quickKind} />
      <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />
      <InstallAppModal open={installAppOpen} onClose={() => setInstallAppOpen(false)} />
      {nativeBrowserOpen && <EmbeddedBrowserPanel collapsed={collapsed} onClose={() => setNativeBrowserOpen(false)} />}
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} onGo={(p) => { setNotifOpen(false); void hideBrowser(); navigate(p); }} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} onLogout={handleLogout} isAdmin={isAdmin} onOpenApp={openApp} onNavigate={() => void hideBrowser()} />
      <FloatingChatBubble />
    </div>
    </RadioProvider>
    </ChatPresenceProvider>
    </VaultProvider>
    </FloatingChatQuickPinGate>
    </FloatingChatProvider>
  );
}

/** One entry of the mobile bar. */
function MobileTab({ tab, onNavigate }: { tab: (typeof MOBILE_TABS)[number]; onNavigate: () => void }) {
  // Read here rather than passed down: the provider sits between the shell and
  // this row, so the shell itself cannot see the counter.
  const { unreadTotal, pendingIncoming } = useChatPresence();
  const count = tab.to === "/chat" ? unreadTotal + pendingIncoming : 0;
  return (
    <NavLink
      to={tab.to}
      end={tab.exact}
      onClick={onNavigate}
      className={({ isActive }) => clsx(
        "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
        isActive ? "text-accent-strong" : "text-faint",
      )}
    >
      <span className="relative">
        <tab.icon className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-white tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </span>
      {tab.label}
    </NavLink>
  );
}

/** Full mobile navigation sheet: every section visible at a glance in a grid. */
function MobileMenu({ open, onClose, onLogout, isAdmin, onOpenApp, onNavigate }: { open: boolean; onClose: () => void; onLogout: () => void; isAdmin: boolean; onOpenApp: (id: AppId) => void; onNavigate: () => void }) {
  const { user } = useAuth();
  const { items } = useOrderedNav();
  const { present, leaving } = usePresence(open);
  const close = () => onClose();
  const Item = ({ to, label, Icon, end }: { to: string; label: string; Icon: any; end?: boolean }) => (
    <NavLink to={to} end={end} onClick={() => { onNavigate(); close(); }}
      className={({ isActive }) => clsx("flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 min-h-[64px] border transition-all",
        isActive ? "bg-accent-soft border-transparent text-accent-strong" : "border-border text-muted bg-surface hover:border-accent/40 hover:text-text")}>
      <Icon className="w-5 h-5" />
      <span className="text-[11px] leading-tight text-center">{label}</span>
    </NavLink>
  );
  if (!present) return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] md:hidden">
      <div className={clsx("absolute inset-0 bg-black/45 backdrop-blur-[1px]", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={close} />
      <div className={clsx("absolute bottom-0 inset-x-0 bg-surface rounded-t-3xl shadow-pop max-h-[90vh] flex flex-col safe-bottom will-change-transform", leaving ? "animate-slide-down-out" : "animate-slide-up")}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo className="w-7 h-7 shrink-0" />
            <div className="min-w-0 flex flex-col leading-none">
              <div className="flex items-center gap-1.5">
                <BrandName className="text-[15px] text-text" />
                <span className="text-xs text-faint truncate"> · todas las secciones</span>
              </div>
              <AppVersion className="mt-0.5" />
            </div>
          </div>
          <button onClick={close} aria-label="Cerrar menú" className="btn-ghost btn-icon"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint px-1 mb-2">Agenda</p>
            <div className="grid grid-cols-3 gap-2">
              {items.map((it) => <Item key={it.to} to={it.to} label={it.label} Icon={it.icon} end={it.to === "/"} />)}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint px-1 mb-2">APP's</p>
            <div className="grid grid-cols-3 gap-2">
              {NAV.apps.map((app) => app.to ? (
                <Item key={app.id} to={app.to} label={app.label} Icon={app.icon} />
              ) : (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => { onOpenApp(app.id); close(); }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 min-h-[64px] border border-border text-muted bg-surface hover:border-accent/40 hover:text-text transition-all"
                >
                  <app.icon className="w-5 h-5" />
                  <span className="text-[11px] leading-tight text-center">{app.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint px-1 mb-2">Cuenta</p>
            <div className="grid grid-cols-3 gap-2">
              {NAV.bottom.map((it) => <Item key={it.to} to={it.to} label={it.label} Icon={it.icon} />)}
              {isAdmin && <Item to="/admin" label="Admin" Icon={PanelLeftOpen} />}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-2.5 shrink-0">
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size={32} />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text truncate">{user?.name}</p><p className="text-xs text-faint truncate">{user?.roleName === "ADMIN" ? "Administrador" : "Usuario"}</p></div>
          <button onClick={onLogout} className="btn-ghost text-danger"><LogOut className="w-4 h-4" />Salir</button>
        </div>
      </div>
    </div>,
    // #root is its own stacking context (z-index 1): inside it the sheet could
    // never rise above the mascot, which lives on <body>.
    document.body,
  );
}

/**
 * Sits next to the brand like the bell does, but only for the chat: friend
 * requests and conversations with something to read.
 */
function ChatBell({ count, onNavigate }: { count: number; onNavigate?: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => { onNavigate?.(); navigate("/chat"); }}
      className="btn-ghost btn-icon relative shrink-0"
      title={count > 0 ? `${count} sin leer en el chat` : "Chat"}
      aria-label={count > 0 ? `Chat, ${count} sin leer` : "Chat"}
    >
      <MessagesSquare className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[9px] grid place-items-center font-bold">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

function NotifDot() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try { const d = await http.get<{ unreadCount: number }>("/api/notifications"); if (on) setN(d.unreadCount); } catch { /* */ }
    };
    load();
    const t = setInterval(load, 45000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return n > 0 ? <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[9px] grid place-items-center font-bold">{n}</span> : null;
}

function DemoSticker({ collapsed }: { collapsed?: boolean }) {
  if (!IS_DEMO) return null;
  return (
    <span
      role="status"
      title="Datos de prueba. Se reinician al recargar."
      className={clsx(
        "pointer-events-none select-none bg-amber-400 text-amber-950 font-extrabold uppercase tracking-wider shadow-[0_1px_0_rgba(0,0,0,0.08),0_3px_8px_rgba(245,158,11,0.35)]",
        collapsed
          ? "absolute -right-2.5 -top-1 z-10 rounded-[3px] px-1 py-[2px] text-[7px] leading-none rotate-12"
          : "ml-1 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] leading-none -rotate-6",
      )}
    >
      {collapsed ? "Demo" : "Modo demo"}
    </span>
  );
}

function SidebarContent({ collapsed, isAdmin, onCycleTheme, showMiniRadio, showMascot, mascotSidebar, chatSidebar, mascotDocked, mascotDockWidth, onDockChange, onDockWidthChange, onOpenApp, onNavigate, appActive, releaseUpdate }: {
  collapsed: boolean;
  isAdmin: boolean;
  onCycleTheme: (e: React.SyntheticEvent) => void;
  showMiniRadio: boolean;
  showMascot: boolean;
  mascotSidebar: boolean;
  chatSidebar: boolean;
  mascotDocked: boolean;
  mascotDockWidth: number;
  onDockChange: (docked: boolean) => void;
  onDockWidthChange: (width: number) => void;
  onOpenApp: (id: AppId) => void;
  onNavigate: () => void;
  appActive: AppId | null;
  releaseUpdate: ReleaseUpdateState;
}) {
  const { active: floatingChatActive } = useFloatingChat();
  const { unreadTotal, pendingIncoming } = useChatPresence();
  const chatBadge = unreadTotal + pendingIncoming;
  const { user } = useAuth();
  const { items, allItems, hidden, move, toggleHidden } = useOrderedNav();
  const [picking, setPicking] = useState(false);
  const [appsExpanded, setAppsExpanded] = useState(() => localStorage.getItem(APPS_EXPANDED_KEY) !== "0");
  const { apps, move: moveApp } = useOrderedApps();
  const sections = useReorder(move);
  const appOrder = useReorder(moveApp);
  useEffect(() => localStorage.setItem(APPS_EXPANDED_KEY, appsExpanded ? "1" : "0"), [appsExpanded]);
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="relative shrink-0">
          <BrandLogo className="w-8 h-8" />
          {collapsed && <DemoSticker collapsed />}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex flex-1 flex-col justify-center leading-none">
            <div className="flex items-center">
              <BrandName className="text-[15px] leading-tight text-text whitespace-nowrap" />
              <DemoSticker />
            </div>
            <AppVersion className="mt-0.5" />
          </div>
        )}
        {!collapsed && <ChatBell count={chatBadge} onNavigate={onNavigate} />}
      </div>
      <nav className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-0.5">
          {items.map((item) => (
            <SideLink
              key={item.to}
              item={item}
              collapsed={collapsed}
              badge={item.to === "/chat" ? chatBadge : undefined}
              onNavigate={onNavigate}
              suppressActive={appActive === "browser"}
              dragging={sections.dragging === item.to}
              dropTarget={sections.over === item.to}
              reorder={sections.itemProps(item.to)}
            />
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPicking((was) => !was)}
              aria-expanded={picking}
              title="Elegir qué secciones se ven"
              className={clsx(
                "mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-faint transition-colors hover:bg-bg hover:text-text",
                collapsed && "justify-center px-0",
              )}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">Secciones</span>}
            </button>
            {picking && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPicking(false)} aria-hidden />
                <div className="absolute left-2 right-2 z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-pop">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Secciones visibles</p>
                  {allItems.map((item) => {
                    const visible = !hidden.has(item.to);
                    const locked = !canHideNavItem(item.to);
                    return (
                      <button
                        key={item.to}
                        type="button"
                        disabled={locked}
                        onClick={() => toggleHidden(item.to)}
                        aria-pressed={visible}
                        className={clsx(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg",
                          visible ? "text-text" : "text-faint",
                          locked && "cursor-default opacity-60",
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {visible && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent-strong" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="mt-5 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setAppsExpanded((expanded) => !expanded)}
              aria-expanded={appsExpanded}
              aria-controls={appsExpanded ? "sidebar-apps" : undefined}
              title={appsExpanded ? "Plegar Apps" : "Desplegar Apps"}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-bg hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                collapsed && "justify-center px-0",
              )}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">Apps</span>}
              {!collapsed && <ChevronDown className={clsx("ml-auto h-4 w-4 transition-transform duration-150", appsExpanded && "rotate-180")} aria-hidden="true" />}
            </button>
            {appsExpanded && (
              <div id="sidebar-apps" className="space-y-0.5">
                {apps.map((app) => (
                  <AppLink
                    key={app.id}
                    app={app}
                    collapsed={collapsed}
                    badge={app.id === "chat" ? chatBadge : undefined}
                    active={appActive === app.id}
                    suppressRouteActive={appActive === "browser"}
                    onNavigate={onNavigate}
                    onOpen={() => onOpenApp(app.id)}
                    dragging={appOrder.dragging === app.id}
                    dropTarget={appOrder.over === app.id}
                    reorder={appOrder.itemProps(app.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {chatSidebar && !floatingChatActive && (
          <div className={clsx("shrink-0 px-3 pb-2", collapsed && "px-2")}>
            <ChatSidebarWidget collapsed={collapsed} />
          </div>
        )}
        {showMascot && !chatSidebar && mascotSidebar && (
          <div className={clsx("shrink-0 px-3 pb-2", collapsed && "px-2")}>
            <MascotWidget
              placement="sidebar"
              sidebarCollapsed={collapsed}
              docked={mascotDocked}
              dockWidth={mascotDockWidth}
              onDockChange={onDockChange}
              onDockWidthChange={onDockWidthChange}
            />
          </div>
        )}
        {showMascot && !mascotSidebar && (
          <MascotWidget
            placement="floating"
            sidebarCollapsed={collapsed}
            docked={mascotDocked}
            dockWidth={mascotDockWidth}
            onDockChange={onDockChange}
            onDockWidthChange={onDockWidthChange}
          />
        )}
      </nav>
      {/* No heading and no account entries: your name and photo at the foot
          open the profile, the gear beside them opens the settings, and
          logging out lives inside the profile. */}
      <div className="px-3 py-3 border-t border-border space-y-0.5 shrink-0">
        {isAdmin && (
          <SideLink collapsed={collapsed} item={{ to: "/admin", label: "Panel admin", icon: PanelLeftOpen }} onNavigate={onNavigate} suppressActive={appActive === "browser"} />
        )}
        {NAV.bottom
          .filter((item) => item.to !== "/settings" && item.to !== "/profile" && !(chatSidebar && item.to === "/help"))
          .map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} suppressActive={appActive === "browser"} />)}
      </div>
      {showMiniRadio && (
        <div className={clsx("border-t border-border px-3 py-2.5", collapsed && "px-2")}>
          <RadioMiniPlayer collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      )}
      <div className={clsx("px-4 py-3 border-t border-border flex items-center gap-1.5", collapsed && "flex-col justify-center gap-2.5")}>
        <NavLink
          to="/profile"
          title="Perfil"
          onClick={onNavigate}
          className={clsx(
            "flex min-w-0 items-center gap-2.5 rounded-xl transition-colors hover:bg-bg",
            collapsed ? "shrink-0" : "-ml-1 flex-1 p-1",
          )}
        >
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size={30} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">{user?.name}</span>
              <span className="block truncate text-xs text-faint">{user?.roleName === "ADMIN" ? "Administrador" : "Usuario"}</span>
            </span>
          )}
        </NavLink>
        <ReleaseUpdateButton {...releaseUpdate} />
        <NavLink
          to="/settings"
          title="Ajustes"
          aria-label="Ajustes"
          onClick={onNavigate}
          className="btn-ghost btn-icon shrink-0"
        >
          <Settings className="w-5 h-5" />
        </NavLink>
        <button type="button" onClick={onCycleTheme} aria-label="Cambiar tema" className="btn-ghost btn-icon shrink-0">
          <SunMoon className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}

function AppLink({ app, collapsed, active, badge, suppressRouteActive, onNavigate, onOpen, dragging, dropTarget, reorder }: {
  app: AppItem;
  collapsed: boolean;
  active: boolean;
  /** Unread count, for the apps that carry one (chat). */
  badge?: number;
  suppressRouteActive: boolean;
  onNavigate: () => void;
  onOpen: () => void;
  dragging?: boolean;
  dropTarget?: boolean;
  /** Handlers from `useReorder`; without them the item is not draggable. */
  reorder?: ReorderItemProps;
}) {
  const content = (
    <>
      <span className="relative shrink-0">
        <app.icon className="w-[18px] h-[18px]" />
        {collapsed && !!badge && badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
        )}
      </span>
      {!collapsed && <span className="truncate">{app.label}</span>}
      {!collapsed && !!badge && badge > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </>
  );
  const cls = (isActive?: boolean) => clsx("side-link w-full min-w-0", ((isActive && !suppressRouteActive) || active) && "is-active", collapsed && "justify-center px-0");
  const link = app.to
    ? (
      <NavLink to={app.to} title={app.label} draggable={false} onClick={onNavigate} className={({ isActive }) => cls(isActive)}>
        {content}
      </NavLink>
    )
    : (
      <button type="button" title={app.label} onClick={onOpen} className={cls()}>
        {content}
      </button>
    );

  if (!reorder) return link;
  return (
    <div
      title="Arrastra para reordenar"
      className={clsx("rounded-xl touch-pan-y", dragging && "opacity-40", dropTarget && "ring-1 ring-accent")}
      {...reorder}
    >
      {link}
    </div>
  );
}

function SideLink({ item, collapsed, badge, onClick, onNavigate, suppressActive, danger, dragging, dropTarget, reorder }: {
  item: { to: string; label: string; icon: any };
  collapsed: boolean;
  /** Unread counter; a dot when the sidebar is collapsed. */
  badge?: number;
  onClick?: () => void;
  onNavigate?: () => void;
  suppressActive?: boolean;
  danger?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  /** Handlers from `useReorder`; without them the row is not draggable. */
  reorder?: ReorderItemProps;
}) {
  const count = badge ?? 0;
  const content = (
    <>
      <span className="relative shrink-0">
        <item.icon className="w-[18px] h-[18px]" />
        {count > 0 && collapsed && (
          <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
        )}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {count > 0 && !collapsed && (
        <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
      {count > 0 && <span className="sr-only">{count} sin leer</span>}
    </>
  );
  const cls = (active?: boolean) => clsx("side-link w-full min-w-0", active && "is-active", danger && "is-danger",
    collapsed && "justify-center px-0");
  const link = onClick
    ? <button type="button" onClick={onClick} className={cls()}>{content}</button>
    : (
      <NavLink
        to={item.to}
        end={item.to === "/"}
        draggable={false}
        onClick={onNavigate}
        className={({ isActive }) => cls(isActive && !suppressActive)}
      >
        {content}
      </NavLink>
    );
  if (!reorder) return link;
  return (
    <div
      title="Arrastra para reordenar"
      className={clsx("rounded-xl touch-pan-y", dragging && "opacity-40", dropTarget && "ring-1 ring-accent")}
      {...reorder}
    >
      {link}
    </div>
  );
}
