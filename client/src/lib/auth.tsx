import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { http, ApiError, onUnauthorized } from "./api";
import type { PublicUser, Theme } from "./types";
import type { SkinId } from "./skins";
import { paintWallpaper, type WallpaperId } from "./wallpapers";
import type { ThemeSchedule } from "./theme";
import { parseNotifySound, persistNotifySound, persistNotifySoundEnabled, type NotifySoundId } from "./notifySounds";
import { clearSpotifySession } from "./spotify";

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  allowPublicRegistration: boolean;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<PublicUser>;
  register: (name: string, email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applyTheme: (t: Theme) => void;
  applyThemeSchedule: (schedule: ThemeSchedule) => void;
  applySkin: (s: SkinId) => void;
  applyWallpaper: (id: WallpaperId) => void;
  applyNotifySound: (id: NotifySoundId) => void;
  applyNotifySoundEnabled: (on: boolean) => void;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(false);
  const authGeneration = useRef(0);
  const currentUserId = useRef<string | null>(null);

  const clearPrivateClientState = useCallback(() => {
    authGeneration.current += 1;
    void queryClient.cancelQueries();
    queryClient.clear();
    clearSpotifySession();
    if (typeof window !== "undefined") {
      localStorage.removeItem("dayly.mascot.chat");
      localStorage.removeItem("dayly.mascot.session");
    }
    currentUserId.current = null;
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const generation = authGeneration.current;
    try {
      const data = await http.get<{ user: PublicUser }>("/api/auth/me");
      if (generation === authGeneration.current) {
        if (currentUserId.current && currentUserId.current !== data.user.id) clearPrivateClientState();
        currentUserId.current = data.user.id;
        setUser(data.user);
        setLoading(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && generation === authGeneration.current) {
        clearPrivateClientState();
        setUser(null);
        setLoading(false);
      }
    } finally {
      if (generation === authGeneration.current) setLoading(false);
    }
  }, [clearPrivateClientState]);

  useEffect(() => {
    if (!user) return;
    persistNotifySound(parseNotifySound(user.notifySound));
    persistNotifySoundEnabled(user.notifySoundEnabled !== false);
  }, [user?.notifySound, user?.notifySoundEnabled]);

  useEffect(() => {
    refresh();
    http.get<{ allowPublicRegistration: boolean }>("/api/auth/public-config")
      .then((d) => setAllowPublicRegistration(Boolean(d.allowPublicRegistration)))
      .catch(() => setAllowPublicRegistration(false));
    const off = () => {
      clearPrivateClientState();
      setUser(null);
      setLoading(false);
    };
    onUnauthorized.add(off);
    return () => { onUnauthorized.delete(off); };
  }, [clearPrivateClientState, refresh]);

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    const data = await http.post<{ user: PublicUser }>("/api/auth/login", { email, password, twoFactorCode });
    clearPrivateClientState();
    currentUserId.current = data.user.id;
    setUser(data.user);
    return data.user;
  };

  const register = async (name: string, email: string, password: string) => {
    await http.post("/api/auth/register", { name, email, password });
    // Auto-login after successful registration
    return login(email, password);
  };

  const logout = async () => {
    clearPrivateClientState();
    setUser(null);
    try { await http.post("/api/auth/logout"); } catch { /* local logout still wins */ }
  };

  const applyTheme = async (t: Theme) => {
    setUser((u) => (u ? { ...u, theme: t, themeScheduleEnabled: false } : u));
    try { await http.patch("/api/users/me/preferences", { theme: t, themeScheduleEnabled: false }); } catch { /* best-effort */ }
  };

  const applyThemeSchedule = async (schedule: ThemeSchedule) => {
    setUser((u) => (u ? {
      ...u,
      themeScheduleEnabled: schedule.enabled,
      themeDarkStartMin: schedule.startMin,
      themeDarkEndMin: schedule.endMin,
    } : u));
    try {
      await http.patch("/api/users/me/preferences", {
        themeScheduleEnabled: schedule.enabled,
        themeDarkStartMin: schedule.startMin,
        themeDarkEndMin: schedule.endMin,
      });
    } catch { /* best-effort */ }
  };

  const applySkin = async (s: SkinId) => {
    setUser((u) => (u ? { ...u, skin: s } : u));
    try { await http.patch("/api/users/me/preferences", { skin: s }); } catch { /* best-effort */ }
  };

  const applyWallpaper = async (id: WallpaperId) => {
    paintWallpaper(id);
    setUser((u) => (u ? { ...u, wallpaper: id } : u));
    try { await http.patch("/api/users/me/preferences", { wallpaper: id }); } catch { /* best-effort */ }
  };

  const applyNotifySound = async (id: NotifySoundId) => {
    persistNotifySound(id);
    setUser((u) => (u ? { ...u, notifySound: id } : u));
    try { await http.patch("/api/users/me/preferences", { notifySound: id }); } catch { /* best-effort */ }
  };

  const applyNotifySoundEnabled = async (on: boolean) => {
    persistNotifySoundEnabled(on);
    setUser((u) => (u ? { ...u, notifySoundEnabled: on } : u));
    try { await http.patch("/api/users/me/preferences", { notifySoundEnabled: on }); } catch { /* best-effort */ }
  };

  const value: AuthCtx = {
    user, loading, allowPublicRegistration, login, register, logout, refresh, applyTheme, applyThemeSchedule, applySkin, applyWallpaper, applyNotifySound, applyNotifySoundEnabled, isAdmin: user?.roleName === "ADMIN",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
