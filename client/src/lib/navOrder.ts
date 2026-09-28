import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import type { AppItem, NavItem } from "@/lib/nav";
import type { NavLayout } from "@/lib/types";
import { NAV } from "@/lib/nav";

const PREFIX = "dayly.navOrder.";
const HIDDEN_PREFIX = "dayly.navHidden.";
const APPS_PREFIX = "dayly.appOrder.";
export const MASCOT_SIDEBAR_EVENT = "dayly:mascot-sidebar-change";
export const CHAT_SIDEBAR_EVENT = "dayly:chat-sidebar-change";
/** Always reachable: hiding the dashboard would strand the user. */
const ALWAYS_VISIBLE = new Set(["/"]);

export function navOrderKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function defaultNavOrder(): string[] {
  return NAV.main.map((item) => item.to);
}

export function parseNavOrder(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) return null;
    return value.filter((x): x is string => typeof x === "string" && x.startsWith("/") && x.length < 40).slice(0, 20);
  } catch {
    return null;
  }
}

export function loadNavOrder(userId: string): string[] {
  try {
    return parseNavOrder(localStorage.getItem(navOrderKey(userId))) ?? defaultNavOrder();
  } catch {
    return defaultNavOrder();
  }
}

export function saveNavOrderLocal(userId: string, order: string[]): void {
  try {
    localStorage.setItem(navOrderKey(userId), JSON.stringify(order));
  } catch { /* quota */ }
}

export function navHiddenKey(userId: string): string {
  return `${HIDDEN_PREFIX}${userId}`;
}

export function parseNavHidden(raw: string | null | undefined): string[] {
  const parsed = parseNavOrder(raw) ?? [];
  return parsed.filter((to) => !ALWAYS_VISIBLE.has(to));
}

export function loadNavHidden(userId: string): string[] {
  try {
    return parseNavHidden(localStorage.getItem(navHiddenKey(userId)));
  } catch {
    return [];
  }
}

export function saveNavHiddenLocal(userId: string, hidden: string[]): void {
  try {
    localStorage.setItem(navHiddenKey(userId), JSON.stringify(hidden));
  } catch { /* quota */ }
}

export function canHideNavItem(to: string): boolean {
  return !ALWAYS_VISIBLE.has(to);
}

export function applyNavOrder(items: NavItem[], order: string[]): NavItem[] {
  const byTo = new Map(items.map((item) => [item.to, item]));
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const to of order) {
    const item = byTo.get(to);
    if (item && !seen.has(to)) {
      out.push(item);
      seen.add(to);
    }
  }
  for (const item of items) {
    if (!seen.has(item.to)) out.push(item);
  }
  return out;
}

function moveNavItem(order: string[], fromTo: string, toTo: string): string[] {
  const next = [...order];
  const from = next.indexOf(fromTo);
  const to = next.indexOf(toTo);
  if (from < 0 || to < 0 || from === to) return order;
  next.splice(from, 1);
  next.splice(to, 0, fromTo);
  return next;
}

function parseIds(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    return value.filter((x): x is string => typeof x === "string" && x.length < 40).slice(0, 20);
  } catch {
    return null;
  }
}

function reorder(order: string[], fromId: string, toId: string): string[] {
  const next = [...order];
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return order;
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

/** Same ordering the sections have, for the APP'S block. */
export function useOrderedApps(): { apps: AppItem[]; move: (fromId: string, toId: string) => void } {
  const { user } = useAuth();
  const [order, setOrder] = useState<string[]>(() => NAV.apps.map((app) => app.id));

  useEffect(() => {
    if (!user) return;
    // The account wins: the layout has to be the same on every device. The
    // local copy is only what keeps the sidebar steady before /me answers.
    const stored = (() => {
      try { return parseIds(localStorage.getItem(`${APPS_PREFIX}${user.id}`)); } catch { return null; }
    })();
    setOrder(user.navLayout?.apps ?? stored ?? NAV.apps.map((app) => app.id));
  }, [user?.id, user?.navLayout]);

  const apps = useMemo(() => {
    const byId = new Map(NAV.apps.map((app) => [app.id as string, app]));
    const seen = new Set<string>();
    const out: AppItem[] = [];
    for (const id of order) {
      const app = byId.get(id);
      if (app && !seen.has(id)) { out.push(app); seen.add(id); }
    }
    for (const app of NAV.apps) if (!seen.has(app.id)) out.push(app);
    return out;
  }, [order]);

  const move = useCallback((fromId: string, toId: string) => {
    setOrder((prev) => {
      const base = prev.length ? prev : NAV.apps.map((app) => app.id);
      const next = reorder(base, fromId, toId);
      if (user) {
        try { localStorage.setItem(`${APPS_PREFIX}${user.id}`, JSON.stringify(next)); } catch { /* quota */ }
        void saveNavLayout({ apps: next });
      }
      return next;
    });
  }, [user]);

  return { apps, move };
}

/**
 * Persists the layout on the account. Best effort on purpose: the sidebar has
 * already moved locally, and a failed save must not undo the gesture.
 */
async function saveNavLayout(patch: Partial<NavLayout>): Promise<void> {
  try {
    await http.patch("/api/users/me/preferences", { navLayout: { ...pendingLayout, ...patch } });
    Object.assign(pendingLayout, patch);
  } catch {
    /* offline or denied: the local copy still holds */
  }
}

/** What we last sent, so a partial change does not drop the other lists. */
const pendingLayout: NavLayout = {};

export function useOrderedNav(): {
  /** What the sidebar shows, in the user's order. */
  items: NavItem[];
  /** Every section, hidden ones included, for the visibility picker. */
  allItems: NavItem[];
  hidden: Set<string>;
  move: (fromTo: string, toTo: string) => void;
  toggleHidden: (to: string) => void;
} {
  const { user } = useAuth();
  const [order, setOrder] = useState<string[]>(defaultNavOrder);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    const layout = user.navLayout ?? null;
    if (layout?.order) pendingLayout.order = layout.order;
    if (layout?.hidden) pendingLayout.hidden = layout.hidden;
    if (layout?.apps) pendingLayout.apps = layout.apps;
    if (layout?.mascotSidebar !== undefined) pendingLayout.mascotSidebar = layout.mascotSidebar;
    if (layout?.chatSidebar !== undefined) pendingLayout.chatSidebar = layout.chatSidebar;
    setOrder(layout?.order ?? loadNavOrder(user.id));
    setHidden(layout?.hidden ?? loadNavHidden(user.id));
  }, [user?.id, user?.navLayout]);

  const allItems = useMemo(() => applyNavOrder(NAV.main, order), [order]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const items = useMemo(() => allItems.filter((item) => !hiddenSet.has(item.to)), [allItems, hiddenSet]);

  const toggleHidden = useCallback((to: string) => {
    if (!canHideNavItem(to)) return;
    setHidden((prev) => {
      const next = prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to];
      if (user) {
        saveNavHiddenLocal(user.id, next);
        void saveNavLayout({ hidden: next });
      }
      return next;
    });
  }, [user]);

  const move = useCallback((fromTo: string, toTo: string) => {
    setOrder((prev) => {
      const base = applyNavOrder(NAV.main, prev.length ? prev : defaultNavOrder()).map((item) => item.to);
      const next = moveNavItem(base, fromTo, toTo);
      if (user) {
        saveNavOrderLocal(user.id, next);
        void saveNavLayout({ order: next });
      }
      return next;
    });
  }, [user]);

  return { items, allItems, hidden: hiddenSet, move, toggleHidden };
}
