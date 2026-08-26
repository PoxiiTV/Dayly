import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";
import {
  absUploadPath,
  attachmentFileExists,
  purgeFiles,
  saveOwnedFiles,
  sendAttachmentHeaders,
} from "../lib/uploads.js";
import { acceptAttachmentFiles, postedFiles } from "../middleware/upload.js";

export const notesRouter = Router();
notesRouter.use(requireAuth);

const attachmentMeta = {
  select: { id: true, filename: true, mimeType: true, sizeBytes: true },
  orderBy: { createdAt: "asc" as Prisma.SortOrder },
};

const noteInclude = {
  tags: true,
  folder: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  attachments: attachmentMeta,
};

// ---------- Notes ----------
notesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, folderId, archived, pinned } = req.query as Record<string, string | undefined>;
    const whereAny: Prisma.NoteWhereInput = { userId: req.user!.id, deletedAt: null };
    if (folderId) whereAny.folderId = folderId as never;
    whereAny.archived = archived === "true";
    if (pinned === "true") whereAny.pinned = true;
    if (q) whereAny.OR = [{ title: { contains: q } }, { content: { contains: q } }];
    const notes = await prisma.note.findMany({
      where: whereAny,
      include: noteInclude,
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 300,
    });
    res.json({ notes });
  }),
);

notesRouter.post(
  "/",
  validate(schemas.createNoteSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as unknown as z.infer<typeof schemas.createNoteSchema>;
    const userId = req.user!.id;
    const data: Prisma.NoteCreateInput = {
      title: b.title ?? "Sin título",
      content: b.content ?? null,
      pinned: b.pinned ?? false,
      archived: b.archived ?? false,
      favorite: b.favorite ?? false,
      color: b.color ?? null,
      user: { connect: { id: userId } },
    };
    if (b.folderId) { const f = await prisma.noteFolder.findFirst({ where: { id: b.folderId, userId } }); if (!f) throw ApiError.badRequest("Carpeta no válida."); data.folder = { connect: { id: f.id } }; }
    if (b.projectId) { const p = await prisma.project.findFirst({ where: { id: b.projectId, userId } }); if (!p) throw ApiError.badRequest("Proyecto no válido."); data.project = { connect: { id: p.id } }; }
    if (b.tagIds?.length) data.tags = { connect: b.tagIds.map((id) => ({ id })) };
    const note = await prisma.note.create({ data, include: noteInclude });
    res.status(201).json({ note });
  }),
);

// Autosave partial patch (content only) — fast path for editor.
notesRouter.patch(
  "/:id/autosave",
  validate(z.object({ title: z.string().max(300).optional(), content: z.string().max(200000).nullish().optional() })),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.note as never, req.params.id);
    const { title, content } = req.body as { title?: string; content?: string | null };
    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: { title: title ?? undefined, content },
      include: noteInclude,
    });
    res.json({ note });
  }),
);

notesRouter.patch(
  "/:id",
  validate(schemas.updateNoteSchema),
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.note as never, req.params.id);
    const b = req.body as unknown as z.infer<typeof schemas.updateNoteSchema>;
    const userId = req.user!.id;
    const data: Prisma.NoteUpdateInput = {};
    for (const k of ["title", "content", "pinned", "archived", "favorite", "color"] as const) if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
    if (b.folderId !== undefined) data.folder = b.folderId ? { connect: { id: b.folderId } } : { disconnect: true };
    if (b.projectId !== undefined) data.project = b.projectId ? { connect: { id: b.projectId } } : { disconnect: true };
    if (b.tagIds !== undefined) data.tags = { set: b.tagIds.map((id) => ({ id })) };
    const note = await prisma.note.update({ where: { id: req.params.id }, data, include: noteInclude });
    res.json({ note });
  }),
);

notesRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.note as never, req.params.id);
    const src = await prisma.note.findUniqueOrThrow({ where: { id: req.params.id } });
    const note = await prisma.note.create({ data: { userId: req.user!.id, title: `${src.title} (copia)`, content: src.content, folderId: src.folderId, color: src.color }, include: noteInclude });
    res.status(201).json({ note });
  }),
);

notesRouter.delete("/:id", asyncHandler(async (req, res) => { await assertOwned(req, prisma.note as never, req.params.id); await prisma.note.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } }); res.json({ ok: true }); }));
notesRouter.post("/:id/restore", asyncHandler(async (req, res) => { await assertOwned(req, prisma.note as never, req.params.id); await prisma.note.update({ where: { id: req.params.id }, data: { deletedAt: null } }); res.json({ ok: true }); }));
notesRouter.delete("/:id/permanent", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.note as never, req.params.id);
  const files = await prisma.noteAttachment.findMany({ where: { noteId: req.params.id }, select: { storageKey: true } });
  await prisma.note.delete({ where: { id: req.params.id } });
  await purgeFiles(files.map((f) => f.storageKey));
  res.json({ ok: true });
}));

notesRouter.post(
  "/:id/attachments",
  acceptAttachmentFiles,
  asyncHandler(async (req, res) => {
    await assertOwned(req, prisma.note as never, req.params.id);
    const attachments = await saveOwnedFiles({
      userId: req.user!.id,
      kind: "note",
      parentId: req.params.id,
      files: postedFiles(req),
    });
    res.status(201).json({ attachments });
  }),
);

notesRouter.get(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.noteAttachment.findFirst({
      where: { id: req.params.attId, noteId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    const full = absUploadPath(att.storageKey);
    if (!attachmentFileExists(att.storageKey)) throw ApiError.notFound("Archivo no encontrado.");
    sendAttachmentHeaders(res, att);
    res.sendFile(full);
  }),
);

notesRouter.delete(
  "/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.noteAttachment.findFirst({
      where: { id: req.params.attId, noteId: req.params.id, userId: req.user!.id },
    });
    if (!att) throw ApiError.notFound("Archivo no encontrado.");
    await prisma.noteAttachment.delete({ where: { id: att.id } });
    await purgeFiles([att.storageKey]);
    res.json({ ok: true });
  }),
);

// ---------- Folders ----------
notesRouter.get("/folders", asyncHandler(async (req, res) => {
  const folders = await prisma.noteFolder.findMany({ where: { userId: req.user!.id }, include: { notes: { select: { id: true }, where: { deletedAt: null } } }, orderBy: { name: "asc" } });
  res.json({ folders });
}));
notesRouter.post("/folders", validate(schemas.createFolderSchema), asyncHandler(async (req, res) => {
  const b = req.body as { name: string; parentId?: string | null };
  const folder = await prisma.noteFolder.create({ data: { userId: req.user!.id, name: b.name, parentId: b.parentId ?? null } });
  res.status(201).json({ folder });
}));
notesRouter.patch("/folders/:id", validate(schemas.updateFolderSchema), asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.noteFolder as never, req.params.id);
  const { name } = req.body as { name?: string };
  const folder = await prisma.noteFolder.update({ where: { id: req.params.id }, data: { name } });
  res.json({ folder });
}));
notesRouter.delete("/folders/:id", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.noteFolder as never, req.params.id);
  // Move orphaned notes out before deleting the folder.
  await prisma.note.updateMany({ where: { folderId: req.params.id }, data: { folderId: null } });
  await prisma.noteFolder.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));