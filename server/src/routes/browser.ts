import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { decryptBrowser, encryptBrowser, urlIndex } from "../lib/browser/crypto.js";
import { canonicalUrl, isPublicHttpsUrl, MAX_URL_LENGTH } from "../lib/browser/urls.js";

export const browserRouter = Router();
browserRouter.use(requireAuth);

/** Enough for a bookmarks bar; past this it is a filing cabinet. */
const MAX_BOOKMARKS = 200;
/** The newest ones are the useful ones, and the list travels whole. */
const MAX_HISTORY = 500;
const MAX_TITLE = 160;

const urlField = z.string().trim().max(MAX_URL_LENGTH).refine(isPublicHttpsUrl, "Solo se admiten direcciones HTTPS públicas.");

const pageSchema = z.object({
  url: urlField,
  title: z.string().trim().max(MAX_TITLE).optional(),
});

const renameSchema = z.object({ title: z.string().trim().max(MAX_TITLE) });

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY).optional(),
});

const settingsSchema = z.object({
  historyEnabled: z.boolean().optional(),
  // Null puts the default search page back.
  homeUrl: urlField.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que cambiar." });

type MarkRow = {
  id: string;
  urlEnc: string;
  titleEnc: string | null;
  createdAt?: Date;
  visitedAt?: Date;
  visits?: number;
};

/** A stored row as the browser reads it. A broken one is skipped, not fatal. */
function viewMark(row: MarkRow): { id: string; url: string; title: string | null; at: Date; visits?: number } | null {
  try {
    return {
      id: row.id,
      url: decryptBrowser(row.urlEnc),
      title: row.titleEnc ? decryptBrowser(row.titleEnc) : null,
      at: row.visitedAt ?? row.createdAt ?? new Date(0),
      ...(row.visits === undefined ? {} : { visits: row.visits }),
    };
  } catch {
    return null;
  }
}

function present<T>(rows: (T | null)[]): T[] {
  return rows.filter((row): row is T => row !== null);
}

// ---------- Settings ----------

browserRouter.get("/settings", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { browserHistoryEnabled: true, browserHomeUrl: true },
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ settings: { historyEnabled: user.browserHistoryEnabled, homeUrl: user.browserHomeUrl } });
}));

browserRouter.patch("/settings", validate(settingsSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof settingsSchema>;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(body.historyEnabled === undefined ? {} : { browserHistoryEnabled: body.historyEnabled }),
      ...(body.homeUrl === undefined ? {} : { browserHomeUrl: body.homeUrl }),
    },
    select: { browserHistoryEnabled: true, browserHomeUrl: true },
  });
  res.json({ settings: { historyEnabled: user.browserHistoryEnabled, homeUrl: user.browserHomeUrl } });
}));

// ---------- Bookmarks ----------

browserRouter.get("/bookmarks", asyncHandler(async (req, res) => {
  const rows = await prisma.browserBookmark.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: MAX_BOOKMARKS,
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ bookmarks: present(rows.map(viewMark)) });
}));

browserRouter.post("/bookmarks", validate(pageSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const body = req.body as z.infer<typeof pageSchema>;
  const url = canonicalUrl(body.url);
  const hash = urlIndex(url);

  const existing = await prisma.browserBookmark.findUnique({ where: { userId_urlHash: { userId, urlHash: hash } } });
  // Starring the same page twice is not an error.
  if (existing) {
    res.json({ bookmark: viewMark(existing) });
    return;
  }

  const count = await prisma.browserBookmark.count({ where: { userId } });
  if (count >= MAX_BOOKMARKS) {
    throw ApiError.conflict(`Tienes ${MAX_BOOKMARKS} favoritos. Quita alguno para guardar este.`);
  }

  const bookmark = await prisma.browserBookmark.create({
    data: {
      userId,
      urlHash: hash,
      urlEnc: encryptBrowser(url),
      titleEnc: body.title ? encryptBrowser(body.title) : null,
      sortOrder: count,
    },
  });
  res.status(201).json({ bookmark: viewMark(bookmark) });
}));

browserRouter.patch("/bookmarks/:id", validate(renameSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof renameSchema>;
  const updated = await prisma.browserBookmark.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { titleEnc: body.title ? encryptBrowser(body.title) : null },
  });
  if (updated.count === 0) throw ApiError.notFound("Ese favorito no existe.");
  res.json({ ok: true });
}));

browserRouter.delete("/bookmarks/:id", asyncHandler(async (req, res) => {
  // Scoped by user, so someone else's id is simply not found.
  const removed = await prisma.browserBookmark.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  if (removed.count === 0) throw ApiError.notFound("Ese favorito no existe.");
  res.json({ ok: true });
}));

// ---------- History ----------

browserRouter.get("/history", validate(historyQuerySchema, "query"), asyncHandler(async (req, res) => {
  const query = (req as Request & { validatedQuery?: z.infer<typeof historyQuerySchema> }).validatedQuery ?? {};
  const rows = await prisma.browserVisit.findMany({
    where: { userId: req.user!.id },
    orderBy: { visitedAt: "desc" },
    take: query.limit ?? 200,
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ visits: present(rows.map(viewMark)) });
}));

browserRouter.post("/history", validate(pageSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { browserHistoryEnabled: true } });
  // Off means off: nothing is written, and the caller is told so rather than
  // being left to believe the page was recorded.
  if (!user.browserHistoryEnabled) {
    res.json({ recorded: false });
    return;
  }

  const body = req.body as z.infer<typeof pageSchema>;
  const url = canonicalUrl(body.url);
  const hash = urlIndex(url);
  const titleEnc = body.title ? encryptBrowser(body.title) : null;

  await prisma.browserVisit.upsert({
    where: { userId_urlHash: { userId, urlHash: hash } },
    create: { userId, urlHash: hash, urlEnc: encryptBrowser(url), titleEnc },
    update: {
      visitedAt: new Date(),
      visits: { increment: 1 },
      // A page that gained a title keeps it; one that lost it is not wiped.
      ...(titleEnc ? { titleEnc } : {}),
    },
  });

  // The list is capped rather than swept on a timer: the oldest rows go when
  // there are more than the browser would ever show.
  const count = await prisma.browserVisit.count({ where: { userId } });
  if (count > MAX_HISTORY) {
    const stale = await prisma.browserVisit.findMany({
      where: { userId },
      orderBy: { visitedAt: "desc" },
      skip: MAX_HISTORY,
      select: { id: true },
    });
    if (stale.length) await prisma.browserVisit.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
  res.json({ recorded: true });
}));

browserRouter.delete("/history/:id", asyncHandler(async (req, res) => {
  const removed = await prisma.browserVisit.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  if (removed.count === 0) throw ApiError.notFound("Esa entrada no existe.");
  res.json({ ok: true });
}));

browserRouter.delete("/history", asyncHandler(async (req, res) => {
  const removed = await prisma.browserVisit.deleteMany({ where: { userId: req.user!.id } });
  res.json({ ok: true, removed: removed.count });
}));
