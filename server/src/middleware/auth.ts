import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";
import { resolveSessionUser } from "../services/auth.service.js";

/**
 * Express augmentation: after `requireAuth`, `req.user` and `req.sessionId`
 * are the authenticated principal + active session.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        roleName: string;
        roleId: string;
        mustChangePassword?: boolean;
      };
      sessionId?: string;
    }
  }
}

/** Ensure a valid, active session. Missing/invalid -> 401. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const ctx = await resolveSessionUser(req);
  if (!ctx?.user) {
    return next(ApiError.unauthorized("Sesión no válida. Inicia sesión de nuevo."));
  }
  const { id, email, name, role, mustChangePassword } = ctx.user;
  req.user = {
    id,
    email,
    name,
    roleName: role.name,
    roleId: role.id,
    mustChangePassword: Boolean(mustChangePassword),
  };
  req.sessionId = ctx.session.id;

  if (mustChangePassword) {
    const path = (req.originalUrl ?? req.path).split("?")[0];
    const allowed = new Set([
      "/api/auth/me",
      "/api/auth/first-password",
      "/api/auth/logout",
      "/api/health",
    ]);
    if (!allowed.has(path)) {
      return next(new ApiError(403, "MUST_CHANGE_PASSWORD", "Debes elegir una contraseña nueva antes de continuar."));
    }
  }
  return next();
}

/** Allow guests (optional auth) but attach user when present. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const ctx = await resolveSessionUser(req);
  if (ctx?.user) {
    const { id, email, name, role } = ctx.user;
    req.user = { id, email, name, roleName: role.name, roleId: role.id };
    req.sessionId = ctx.session.id;
  }
  return next();
}

/** RBAC middleware: require a role among the allowed set. ALWAYS re-checked on backend. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.roleName)) {
      return next(ApiError.forbidden("No tienes permiso para acceder a este recurso."));
    }
    return next();
  };
}

export function isAdmin(req: Request): boolean {
  return req.user?.roleName === "ADMIN";
}