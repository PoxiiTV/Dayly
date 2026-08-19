import { LayoutDashboard, CalendarDays, ListTodo, PanelsTopLeft, StickyNote, AlarmClock, Repeat, Target, BarChart3, Inbox, Trash2, Settings, User, HelpCircle, LogOut, CalendarRange } from "lucide-react";

export interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean; mobile?: boolean; }

export const NAV: { main: NavItem[]; bottom: NavItem[] } = {
  main: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, mobile: true },
    { to: "/day", label: "Mi día", icon: CalendarRange, mobile: true },
    { to: "/calendar", label: "Calendario", icon: CalendarDays, mobile: true },
    { to: "/tasks", label: "Tareas", icon: ListTodo, mobile: true },
    { to: "/inbox", label: "Bandeja de entrada", icon: Inbox },
    { to: "/projects", label: "Proyectos", icon: PanelsTopLeft },
    { to: "/notes", label: "Notas", icon: StickyNote },
    { to: "/habits", label: "Hábitos", icon: Repeat },
    { to: "/goals", label: "Objetivos", icon: Target },
    { to: "/stats", label: "Estadísticas", icon: BarChart3 },
    { to: "/reminders", label: "Recordatorios", icon: AlarmClock },
    { to: "/trash", label: "Papelera", icon: Trash2 },
  ],
  bottom: [
    { to: "/settings", label: "Ajustes", icon: Settings },
    { to: "/profile", label: "Perfil", icon: User },
    { to: "/help", label: "Ayuda", icon: HelpCircle },
  ],
};

/** The 5 top-level destinations shown in the mobile bottom tab bar. */
export const MOBILE_TABS = NAV.main.filter((n) => n.mobile);

export { LogOut };