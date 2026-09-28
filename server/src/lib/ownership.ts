import type { Request } from "express";
import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";

type PrismaModel = {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null>;
};

/**
 * Build an ownership-scoped where clause for the authenticated user.
 * Every data access MUST go through code that adds `userId: req.user.id`.
 * This is our IDOR/BOLA defense: changing an ID can never cross users.
 */
export function owned(scope: string, extra: Record<string, unknown> = {}) {
  return { userId: scope, deletedAt: null, ...extra };
}

/**
 * Verify a resource exists AND belongs to the requester, else throw 404
 * (returning 404 — not 403 — avoids leaking whether a resource exists).
 *
 * Models without a `deletedAt` column (reminders, tags, note folders) must
 * pass `{ softDelete: false }` — Prisma rejects unknown fields and the
 * client sees a 500 instead of deleting the row.
 */
export async function assertOwned(
  req: Request,
  model: PrismaModel,
  id: string,
  extra: Record<string, unknown> = {},
  opts: { softDelete?: boolean } = {},
): Promise<void> {
  const where: Record<string, unknown> = { id, userId: req.user!.id, ...extra };
  if (opts.softDelete !== false && !("deletedAt" in extra)) {
    where.deletedAt = null;
  }
  const found = await model.findFirst({ where });
  if (!found) throw ApiError.notFound("El elemento no existe o ya fue eliminado.");
}

/** Resolve ownership of a related entity given its own owner column. */
export async function assertOwnedBy(
  userId: string,
  model: PrismaModel,
  id: string,
): Promise<void> {
  const found = await model.findFirst({ where: { id, userId } });
  if (!found) throw ApiError.notFound("El elemento no existe.");
}

/** Pagination helper returning a safe slice. */
export function paginate(page = 1, pageSize = 50) {
  const p = Math.max(1, page);
  const ps = Math.min(100, Math.max(1, pageSize));
  return { skip: (p - 1) * ps, take: ps + 1, page: p, pageSize: ps }; // +1 to detect hasMore
}