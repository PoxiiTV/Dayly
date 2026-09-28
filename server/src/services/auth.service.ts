import type { Request } from "express";
import { prisma } from "../lib/prisma.js";
import { config } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { parseNotifySound } from "../lib/notifySound.js";

export const SESSION_COOKIE = "dayly_session";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  quickPinEnabled: boolean;
  quickPinConfigured: boolean;
  // settings
  timezone: string;
  weatherCity: string | null;
  language: string;
  firstDayOfWeek: number;
  timeFormat24: boolean;
  theme: string;
  themeScheduleEnabled: boolean;
  themeDarkStartMin: number;
  themeDarkEndMin: number;
  skin: string;
  density: string;
  calendarStartHour: number;
  calendarEndHour: number;
  avatarUrl: string | null;
  /** Decorated display name; null means the account name is shown. */
  nick: string | null;
  nickColor: string | null;
  nickBold: boolean;
  /** Coloured pieces when the nick is multicoloured; null when it is not. */
  nickSegments: { t: string; c?: string | null }[] | null;
  subnick: string | null;
  wallpaper: string;
  notifySound: string;
  notifySoundEnabled: boolean;
  /** Sidebar layout and compact mascot placement, shared across every device. */
  navLayout: { order?: string[]; hidden?: string[]; apps?: string[]; mascotSidebar?: boolean; chatSidebar?: boolean } | null;
  notifyReminders: boolean;
  notifyEvents: boolean;
  notifyTasks: boolean;
  notifyEmail: boolean;
  mustChangePassword: boolean;
}

/** Strip any sensitive fields before returning a user to the client. */
export function toPublicUser(
  u: { id: string; email: string; name: string; role?: { name: string }; roleId: string; emailVerifiedAt: Date | null; twoFactorEnabled: boolean; quickPinHash?: string | null; quickPinEnabled?: boolean; timezone: string; weatherCity: string | null; language: string; firstDayOfWeek: number; timeFormat24: boolean; theme: string; themeScheduleEnabled?: boolean; themeDarkStartMin?: number; themeDarkEndMin?: number; skin?: string; density: string; calendarStartHour: number; calendarEndHour: number; avatarUrl: string | null; nick?: string | null; nickColor?: string | null; nickBold?: boolean; subnick?: string | null; nickSegments?: unknown; wallpaper?: string; notifySound?: string; notifySoundEnabled?: boolean; navLayout?: unknown; notifyReminders: boolean; notifyEvents: boolean; notifyTasks: boolean; notifyEmail: boolean },
): PublicUser {
  const roleName = (u as { role?: { name: string } }).role?.name ?? "";
  const { passwordHash: _p, twoFactorSecret: _s, recoveryCodes: _r, emailLower: _e, quickPinHash: _q, ...rest } = u as unknown as Record<string, unknown>;
  void _p; void _s; void _r; void _e; void _q; void rest;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    roleName,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    twoFactorEnabled: u.twoFactorEnabled,
    quickPinEnabled: Boolean(u.quickPinEnabled && u.quickPinHash),
    quickPinConfigured: Boolean(u.quickPinHash),
    timezone: u.timezone,
    weatherCity: u.weatherCity,
    language: u.language,
    firstDayOfWeek: u.firstDayOfWeek,
    timeFormat24: u.timeFormat24,
    theme: u.theme,
    themeScheduleEnabled: Boolean(u.themeScheduleEnabled),
    themeDarkStartMin: typeof u.themeDarkStartMin === "number" ? u.themeDarkStartMin : 1200,
    themeDarkEndMin: typeof u.themeDarkEndMin === "number" ? u.themeDarkEndMin : 360,
    skin: u.skin ?? "ink",
    density: u.density,
    calendarStartHour: u.calendarStartHour,
    calendarEndHour: u.calendarEndHour,
    avatarUrl: u.avatarUrl,
    nick: u.nick ?? null,
    nickColor: u.nickColor ?? null,
    nickBold: Boolean(u.nickBold),
    nickSegments: (u.nickSegments ?? null) as PublicUser["nickSegments"],
    subnick: u.subnick ?? null,
    wallpaper: u.wallpaper ?? "none",
    notifySound: parseNotifySound(u.notifySound),
    navLayout: (u.navLayout ?? null) as PublicUser["navLayout"],
    notifySoundEnabled: u.notifySoundEnabled !== false,
    notifyReminders: u.notifyReminders,
    notifyEvents: u.notifyEvents,
    notifyTasks: u.notifyTasks,
    notifyEmail: u.notifyEmail,
    mustChangePassword: Boolean((u as { mustChangePassword?: boolean }).mustChangePassword),
  };
}

/** Create a session row + set the HttpOnly cookie. Returns the raw token. */
export async function createSession(
  req: Request,
  userId: string,
  ttlMs = config.sessionTtlMs,
): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ip: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string)?.slice(0, 300) ?? null,
      expiresAt,
    },
  });
  setSessionCookie(req, token, expiresAt);
  return token;
}

export function setSessionCookie(req: Request, token: string, expiresAt: Date) {
  const res = req.res;
  if (!res) return;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(req: Request) {
  const res = req.res;
  if (!res) return;
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" });
}

/** Resolve the authenticated user from the session cookie (if any). */
export async function resolveSessionUser(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return null;
  const tokenHash = hashToken(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true } } },
  });

  if (!session || !session.user) {
    // Stale/revoked: invalid cookie silently.
    return null;
  }
  if (session.revokedAt) return null;
  if (session.user.status !== "ACTIVE") return null; // suspended user
  if (session.expiresAt < new Date()) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }

  // Opportunistic last-used + last-login refresh, throttled to avoid writes per request.
  const now = Date.now();
  if (now - session.lastUsedAt.getTime() > 60_000) {
    void prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  return { session, user: session.user, tokenHash };
}
