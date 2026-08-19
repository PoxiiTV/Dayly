import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * Write a structured audit record. Never contains secrets: only action,
 * entity refs, optional safe metadata, IP and UA. Failures are swallowed so
 * audit can never break the triggering request.
 */
export async function audit(
  req: Request,
  action: string,
  opts: { entityType?: string; entityId?: string; metadata?: Record<string, unknown> } = {},
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? undefined,
        action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        metadata: (opts.metadata ?? {}) as object,
        ip: req.ip ?? undefined,
        userAgent: (req.headers["user-agent"] as string)?.slice(0, 300) ?? undefined,
      },
    });
  } catch (err) {
    logger.warn({ err }, "audit write failed");
  }
}

/** Express middleware wrapper for ergonomic use in route handlers. */
export function auditMiddleware(action: string, getRefs?: (req: Request) => { entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const refs = getRefs?.(req) ?? {};
    try {
      await prisma.auditLog.create({
        data: {
          userId: req.user?.id ?? undefined,
          action,
          entityType: refs.entityType,
          entityId: refs.entityId,
          metadata: (refs.metadata ?? {}) as object,
          ip: req.ip ?? undefined,
          userAgent: (req.headers["user-agent"] as string)?.slice(0, 300) ?? undefined,
        },
      });
    } catch (err) {
      logger.warn({ err }, "audit write failed");
    }
    return next();
  };
}