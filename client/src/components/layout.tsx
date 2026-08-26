import { useEffect, useState, ReactNode, useCallback, useRef, useLayoutEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Search, Bell, Plus, PanelLeftClose, PanelLeftOpen, X, Menu, MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import { NAV, LogOut, MOBILE_TABS } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { useTheme, useThemeWave } from "@/lib/theme";
import { Avatar, useToast, Button, Modal, usePresence } from "@/components/ui";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickAdd } from "@/components/QuickAdd";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { AlertEngine } from "@/lib/AlertEngine";
import { MascotWidget } from "@/components/MascotWidget";
import { http } from "@/lib/api";
import { BrandLogo, SunMoon } from "@/components/icons";
import { BrandName } from "@/components/BrandName";

const SIDEBAR_KEY = "dayly.sidebar";
const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";
const PAGE_FADE_MS = 500;

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

export function AppShell() {
  const { user, logout, isAdmin, applyTheme } = useAuth();
  const { resolved, hydrate } = useTheme();
  const themeWave = useThemeWave();
  const { push } = useToast();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"), [collapsed]);

  useEffect(() => {
    if (!user) return;
    hydrate(user.theme, user.skin);
  }, [user?.id, hydrate]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (e.altKey) {
        const map: Record<string, string> = { n: "/tasks", e: "/calendar", m: "/day", c: "/calendar", t: "/tasks" };
        if (map[e.key]) navigate(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const openQuick = useCallback(() => setQuickOpen(true), []);

  const handleLogout = async () => { await logout(); navigate("/login"); };

  const cycleTheme = (e?: React.SyntheticEvent) => {
    const next: "LIGHT" | "DARK" = resolved === "dark" ? "LIGHT" : "DARK";
    themeWave(next, e as never);
    if (user) void applyTheme(next);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {!IS_DEMO && <AlertEngine />}
      <MascotWidget />
      <div className="flex-1 min-h-0 md:flex">
      {/* Desktop sidebar */}
      <aside className={clsx("hidden md:flex flex-col border-r border-border bg-surface transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] sticky top-0 h-screen",
        collapsed ? "w-[72px]" : "w-64")}>
        <SidebarContent collapsed={collapsed} isAdmin={isAdmin} onLogout={handleLogout} onCycleTheme={cycleTheme} />
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
        <button onClick={() => setMenuOpen(true)} aria-label="Abrir menú" className="btn-ghost !p-2 -ml-1"><Menu className="w-5 h-5" /></button>
        <NavLink to="/" className="flex items-center gap-2">
          <BrandLogo className="w-7 h-7" />
          <BrandName className="text-text" />
        </NavLink>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setPaletteOpen(true)} aria-label="Buscar" className="btn-ghost !p-2"><Search className="w-5 h-5" /></button>
          <button onClick={() => setNotifOpen(true)} aria-label="Notificaciones" className="btn-ghost !p-2 relative"><Bell className="w-5 h-5" /><NotifDot /></button>
          <button onClick={(e) => cycleTheme(e)} aria-label="Tema" className="btn-ghost !p-2"><SunMoon className="w-5 h-5" /></button>
        </div>
        </div>
      </div>

      {/* Main content */}
      <main className="dayly-page flex-1 min-w-0 md:px-8 md:py-7 px-4 pt-6 pb-24 md:pb-8">
        <DissolvingOutlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border safe-bottom">
        <div className="grid grid-cols-5">
          {MOBILE_TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.exact}
              className={({ isActive }) => clsx("flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors", isActive ? "text-accent-strong" : "text-faint")}>
              <t.icon className="w-5 h-5" />
              {t.label}
            </NavLink>
          ))}
          <button onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-faint">
            <MoreHorizontal className="w-5 h-5" />
            Más
          </button>
        </div>
        {/* Floating quick-add — floats ABOVE the bottom bar, centered over Calendario */}
        <button onClick={openQuick} aria-label="Crear"
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-12 h-12 rounded-2xl bg-accent text-white grid place-items-center shadow-pop hover:bg-accent-strong active:scale-95 transition-all">
          <Plus className="w-6 h-6" />
        </button>
      </nav>

      {/* Desktop floating "+" */}
      <button onClick={openQuick} aria-label="Crear elemento" title="Crear (Alt+N)"
        className="hidden md:grid fixed bottom-7 right-7 w-14 h-14 rounded-2xl bg-accent text-white place-items-center shadow-pop hover:bg-accent-strong active:scale-95 transition-all z-40">
        <Plus className="w-6 h-6" />
      </button>

      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickAdd open={quickOpen} onClose={() => setQuickOpen(false)} />
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} onGo={(p) => { setNotifOpen(false); navigate(p); }} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} onLogout={handleLogout} isAdmin={isAdmin} />
    </div>
  );
}

/** Full mobile navigation sheet: every section visible at a glance in a grid. */
function MobileMenu({ open, onClose, onLogout, isAdmin }: { open: boolean; onClose: () => void; onLogout: () => void; isAdmin: boolean }) {
  const { user } = useAuth();
  const { present, leaving } = usePresence(open);
  const close = () => onClose();
  const Item = ({ to, label, Icon, end }: { to: string; label: string; Icon: any; end?: boolean }) => (
    <NavLink to={to} end={end} onClick={close}
      className={({ isActive }) => clsx("flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 min-h-[64px] border transition-all",
        isActive ? "bg-accent-soft border-transparent text-accent-strong" : "border-border text-muted bg-surface hover:border-accent/40 hover:text-text")}>
      <Icon className="w-5 h-5" />
      <span className="text-[11px] leading-tight text-center">{label}</span>
    </NavLink>
  );
  if (!present) return null;
  return (
    <div className="fixed inset-0 z-[85] md:hidden">
      <div className={clsx("absolute inset-0 bg-black/45 backdrop-blur-[1px]", leaving ? "animate-fade-out" : "animate-fade-in")} onClick={close} />
      <div className={clsx("absolute bottom-0 inset-x-0 bg-surface rounded-t-3xl shadow-pop max-h-[90vh] flex flex-col safe-bottom will-change-transform", leaving ? "animate-slide-down-out" : "animate-slide-up")}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <BrandLogo className="w-7 h-7" />
            <BrandName className="text-[15px] text-text" />
            <span className="text-xs text-faint"> · todas las secciones</span>
          </div>
          <button onClick={close} aria-label="Cerrar menú" className="btn-ghost !p-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint px-1 mb-2">Agenda</p>
            <div className="grid grid-cols-3 gap-2">
              {NAV.main.map((it) => <Item key={it.to} to={it.to} label={it.label} Icon={it.icon} end={it.to === "/"} />)}
              {isAdmin && <Item to="/admin" label="Admin" Icon={PanelLeftOpen} />}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-faint px-1 mb-2">Cuenta</p>
            <div className="grid grid-cols-3 gap-2">
              {NAV.bottom.map((it) => <Item key={it.to} to={it.to} label={it.label} Icon={it.icon} />)}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-2.5 shrink-0">
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size={32} />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text truncate">{user?.name}</p><p className="text-xs text-faint truncate">{user?.roleName === "ADMIN" ? "Administrador" : "Usuario"}</p></div>
          <button onClick={onLogout} className="btn-ghost !text-danger"><LogOut className="w-4 h-4" />Salir</button>
        </div>
      </div>
    </div>
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

function SidebarContent({ collapsed, isAdmin, onLogout, onCycleTheme }: { collapsed: boolean; isAdmin: boolean; onLogout: () => void; onCycleTheme: (e: React.SyntheticEvent) => void }) {
  const { user } = useAuth();
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="relative shrink-0">
          <BrandLogo className="w-8 h-8" />
          {collapsed && <DemoSticker collapsed />}
        </div>
        {!collapsed && (
          <div className="flex items-center min-w-0">
            <BrandName className="text-[15px] leading-tight text-text whitespace-nowrap" />
            <DemoSticker />
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV.main.map((item) => (
          <SideLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        {isAdmin && <div className="pt-3 mt-3 border-t border-border">
          <p className={clsx("text-[10px] uppercase tracking-wider text-faint px-3 pb-1", collapsed && "text-center")}>{collapsed ? "•" : "Administración"}</p>
          <SideLink collapsed={collapsed} item={{ to: "/admin", label: "Panel admin", icon: PanelLeftOpen }} />
        </div>}
      </nav>
      <div className="px-3 py-3 border-t border-border space-y-0.5 shrink-0">
        {NAV.bottom.map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
        <SideLink collapsed={collapsed} item={{ to: "", label: "Cerrar sesión", icon: LogOut }} onClick={onLogout} danger />
      </div>
      <div className={clsx("px-4 py-3 border-t border-border flex items-center gap-2.5", collapsed && "flex-col justify-center")}>
        <NavLink to="/profile" title="Perfil" className="shrink-0">
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size={30} />
        </NavLink>
        {!collapsed && <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text truncate">{user?.name}</p><p className="text-xs text-faint truncate">{user?.roleName === "ADMIN" ? "Administrador" : "Usuario"}</p></div>}
        <button type="button" onClick={onCycleTheme} aria-label="Cambiar tema" className="btn-ghost !p-2 shrink-0">
          <SunMoon className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}

function SideLink({ item, collapsed, onClick, danger }: { item: { to: string; label: string; icon: any }; collapsed: boolean; onClick?: () => void; danger?: boolean }) {
  const content = (
    <>
      <item.icon className={clsx("w-4.5 h-4.5 shrink-0", "w-[18px] h-[18px]")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </>
  );
  const cls = (active?: boolean) => clsx("flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors duration-200",
    danger ? "text-danger hover:bg-danger/10" : active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-surface hover:text-text",
    collapsed && "justify-center px-0");
  if (onClick) return <button onClick={onClick} className={cls()}>{content}</button>;
  return <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => cls(isActive)}>{content}</NavLink>;
}