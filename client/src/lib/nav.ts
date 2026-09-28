import { MessagesSquare, LayoutDashboard, CalendarDays, ListTodo, PanelsTopLeft, StickyNote, AlarmClock, Target, Inbox, Trash2, Settings, User, HelpCircle, LogOut, CalendarRange, KeyRound, Calculator, Globe, CreditCard } from "lucide-react";

export interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean; mobile?: boolean; }

export type AppId = "calculator" | "vault" | "browser" | "chat";

export interface AppItem {
  id: AppId;
  label: string;
  icon: typeof LayoutDashboard;
  to?: string;
}

export const NAV: { main: NavItem[]; apps: AppItem[]; bottom: NavItem[] } = {
  main: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, mobile: true },
    { to: "/day", label: "Mi día", icon: CalendarRange },
    { to: "/calendar", label: "Calendario", icon: CalendarDays },
    { to: "/tasks", label: "Tareas", icon: ListTodo, mobile: true },
    { to: "/inbox", label: "Mensajes", icon: Inbox },
    // Three `mobile` entries at most: the bar is Dashboard, Calendario, "+",
    // Tareas y "Más", and a fourth would not fit.
    { to: "/projects", label: "Proyectos", icon: PanelsTopLeft },
    { to: "/notes", label: "Notas", icon: StickyNote },
    { to: "/goals", label: "Hábitos & Objetivos", icon: Target },
    { to: "/reminders", label: "Recordatorios", icon: AlarmClock },
    { to: "/subscriptions", label: "Suscripciones", icon: CreditCard },
    { to: "/trash", label: "Papelera", icon: Trash2 },
  ],
  apps: [
    // Chat lives here, not with the sections: it is a thing you open, like the
    // calculator or the password vault.
    { id: "chat", label: "Chat", icon: MessagesSquare, to: "/chat" },
    { id: "calculator", label: "Calculadora", icon: Calculator },
    { id: "vault", label: "Contraseñas", icon: KeyRound, to: "/vault" },
    { id: "browser", label: "Navegador", icon: Globe },
  ],
  bottom: [
    { to: "/settings", label: "Ajustes", icon: Settings },
    { to: "/profile", label: "Perfil", icon: User },
    { to: "/help", label: "Ayuda", icon: HelpCircle },
  ],
};

/** The 5 top-level destinations shown in the mobile bottom tab bar. */
/**
 * The bottom bar: Dashboard, Tareas, the "+", Chat and "Más". Chat lives in
 * the apps block now, so it is added here by hand rather than flagged.
 */
export const MOBILE_TABS: NavItem[] = [
  ...NAV.main.filter((item) => item.mobile),
  { to: "/chat", label: "Chat", icon: MessagesSquare },
];

export { LogOut };
