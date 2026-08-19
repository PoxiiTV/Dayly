import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { http, ApiError, onUnauthorized } from "./api";
import type { PublicUser, Theme } from "./types";

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<PublicUser>;
  register: (name: string, email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applyTheme: (t: Theme) => void;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await http.get<{ user: PublicUser }>("/api/auth/me");
      setUser(data.user);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = () => setUser(null);
    onUnauthorized.add(off);
    return () => { onUnauthorized.delete(off); };
  }, [refresh]);

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    const data = await http.post<{ user: PublicUser }>("/api/auth/login", { email, password, twoFactorCode });
    setUser(data.user);
    return data.user;
  };

  const register = async (name: string, email: string, password: string) => {
    await http.post("/api/auth/register", { name, email, password });
    // Auto-login after successful registration
    return login(email, password);
  };

  const logout = async () => {
    try { await http.post("/api/auth/logout"); } catch { /* noop */ }
    setUser(null);
  };

  const applyTheme = async (t: Theme) => {
    setUser((u) => (u ? { ...u, theme: t } : u));
    try { await http.patch("/api/users/me/preferences", { theme: t }); } catch { /* best-effort */ }
  };

  const value: AuthCtx = {
    user, loading, login, register, logout, refresh, applyTheme, isAdmin: user?.roleName === "ADMIN",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}