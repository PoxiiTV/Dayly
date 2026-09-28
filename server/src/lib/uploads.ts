import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { config } from "../config/env.js";
import { ApiError } from "./errors.js";
import {
  type AttachmentKind,
  MAX_ATTACHMENT_BYTES,
  DEFAULT_UPLOAD_QUOTA_BYTES,
  contentDisposition,
  isPreviewableImage,
  maxFilesFor,
  resolveAllowedMime,
  sanitizeFilename,
  attachmentCapMessage,
  attachmentParentMissing,
} from "./attachment-policy.js";

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_ATTACHMENTS_PER_REMINDER,
  contentDisposition,
  isPreviewableImage,
  maxFilesFor,
  sanitizeFilename,
} from "./attachment-policy.js";

export type SavedAttachment = { id: string; filename: string; mimeType: string; sizeBytes: number };

function uploadQuotaBytes(): number {
  const n = Number(process.env.UPLOAD_QUOTA_BYTES ?? DEFAULT_UPLOAD_QUOTA_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPLOAD_QUOTA_BYTES;
}

export function absUploadPath(storageKey: string): string {
  const root = path.resolve(config.uploadDir);
  const resolved = path.resolve(root, storageKey);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw ApiError.badRequest("Ruta no válida.");
  return resolved;
}

export function attachmentFileExists(storageKey: string): boolean {
  return existsSync(absUploadPath(storageKey));
}

export async function writeAttachmentFile(storageKey: string, data: Buffer): Promise<void> {
  const full = absUploadPath(storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function removeAttachmentFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(absUploadPath(storageKey));
  } catch {
    /* already gone */
  }
}

export async function purgeFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(storageKeys.map((k) => removeAttachmentFile(k)));
}

export async function purgeUserUploads(userId: string): Promise<void> {
  const keys = await listAttachmentKeys({ userId });
  await prisma.$transaction([
    prisma.taskAttachment.deleteMany({ where: { userId } }),
    prisma.noteAttachment.deleteMany({ where: { userId } }),
    prisma.reminderAttachment.deleteMany({ where: { userId } }),
  ]);
  await purgeFiles(keys);
  try {
    await fs.rm(absUploadPath(userId), { recursive: true, force: true });
  } catch {
    /* folder already gone */
  }
}

async function userBytesUsed(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const [tasks, notes, reminders] = await Promise.all([
    db.taskAttachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    db.noteAttachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    db.reminderAttachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
  ]);
  return (tasks._sum.sizeBytes ?? 0) + (notes._sum.sizeBytes ?? 0) + (reminders._sum.sizeBytes ?? 0);
}

export async function listAttachmentKeys(opts: {
  userId: string;
  kind?: AttachmentKind;
  parentIds?: string[];
  onlySoftDeleted?: boolean;
}): Promise<string[]> {
  const keys: string[] = [];
  const wantTasks = !opts.kind || opts.kind === "task";
  const wantNotes = !opts.kind || opts.kind === "note";
  const wantReminders = (!opts.kind || opts.kind === "reminder") && !opts.onlySoftDeleted;
  if (wantTasks) {
    const rows = await prisma.taskAttachment.findMany({
      where: {
        userId: opts.userId,
        ...(opts.parentIds ? { taskId: { in: opts.parentIds } } : {}),
        ...(opts.onlySoftDeleted ? { task: { deletedAt: { not: null } } } : {}),
      },
      select: { storageKey: true },
    });
    keys.push(...rows.map((r) => r.storageKey));
  }
  if (wantNotes) {
    const rows = await prisma.noteAttachment.findMany({
      where: {
        userId: opts.userId,
        ...(opts.parentIds ? { noteId: { in: opts.parentIds } } : {}),
        ...(opts.onlySoftDeleted ? { note: { deletedAt: { not: null } } } : {}),
      },
      select: { storageKey: true },
    });
    keys.push(...rows.map((r) => r.storageKey));
  }
  if (wantReminders) {
    const rows = await prisma.reminderAttachment.findMany({
      where: {
        userId: opts.userId,
        ...(opts.parentIds ? { reminderId: { in: opts.parentIds } } : {}),
      },
      select: { storageKey: true },
    });
    keys.push(...rows.map((r) => r.storageKey));
  }
  return keys;
}

export async function purgeOwnedAttachments(opts: {
  userId: string;
  kind?: AttachmentKind;
  parentIds?: string[];
  onlySoftDeleted?: boolean;
}): Promise<void> {
  const keys = await listAttachmentKeys(opts);
  await purgeFiles(keys);
}

type IncomingFile = { buffer: Buffer; filename: string };
const ATTACHMENT_META = { select: { id: true, filename: true, mimeType: true, sizeBytes: true } } as const;

async function lockParent(
  tx: Prisma.TransactionClient,
  kind: AttachmentKind,
  userId: string,
  parentId: string,
): Promise<{ id: string }[]> {
  switch (kind) {
    case "task":
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM Task WHERE id = ${parentId} AND userId = ${userId} AND deletedAt IS NULL FOR UPDATE`;
    case "note":
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM Note WHERE id = ${parentId} AND userId = ${userId} AND deletedAt IS NULL FOR UPDATE`;
    case "reminder":
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM Reminder WHERE id = ${parentId} AND userId = ${userId} FOR UPDATE`;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

async function countOwnedFiles(tx: Prisma.TransactionClient, kind: AttachmentKind, parentId: string): Promise<number> {
  switch (kind) {
    case "task": return tx.taskAttachment.count({ where: { taskId: parentId } });
    case "note": return tx.noteAttachment.count({ where: { noteId: parentId } });
    case "reminder": return tx.reminderAttachment.count({ where: { reminderId: parentId } });
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

async function createOwnedFile(
  tx: Prisma.TransactionClient,
  kind: AttachmentKind,
  data: { id: string; userId: string; parentId: string; filename: string; mimeType: string; sizeBytes: number; storageKey: string },
): Promise<SavedAttachment> {
  const shared = {
    id: data.id,
    userId: data.userId,
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    storageKey: data.storageKey,
  };
  switch (kind) {
    case "task":
      return tx.taskAttachment.create({ data: { ...shared, taskId: data.parentId }, ...ATTACHMENT_META });
    case "note":
      return tx.noteAttachment.create({ data: { ...shared, noteId: data.parentId }, ...ATTACHMENT_META });
    case "reminder":
      return tx.reminderAttachment.create({ data: { ...shared, reminderId: data.parentId }, ...ATTACHMENT_META });
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export async function saveOwnedFiles(opts: {
  userId: string;
  kind: AttachmentKind;
  parentId: string;
  files: IncomingFile[];
}): Promise<SavedAttachment[]> {
  if (!opts.files.length) throw ApiError.badRequest("Falta el archivo.");
  const cap = maxFilesFor(opts.kind);
  if (opts.files.length > cap) {
    throw ApiError.badRequest(attachmentCapMessage(opts.kind));
  }
  for (const f of opts.files) {
    if (!f.buffer.length) throw ApiError.badRequest("El archivo está vacío.");
    if (f.buffer.length > MAX_ATTACHMENT_BYTES) throw ApiError.badRequest("El archivo pesa más de 2 MB.");
  }

  const prepared = opts.files.map((f) => {
    const filename = sanitizeFilename(f.filename);
    const mimeType = resolveAllowedMime(f.buffer, filename, opts.kind);
    if (!mimeType) {
      throw ApiError.badRequest(
        opts.kind === "note"
          ? "Solo se admiten imágenes (JPG, PNG, WebP o GIF)."
          : "Tipo de archivo no permitido.",
      );
    }
    return { buffer: f.buffer, filename, mimeType, sizeBytes: f.buffer.length };
  });

  const incomingBytes = prepared.reduce((n, f) => n + f.sizeBytes, 0);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${opts.userId} FOR UPDATE`;
    const parentRows = await lockParent(tx, opts.kind, opts.userId, opts.parentId);
    if (!parentRows.length) {
      throw ApiError.notFound(attachmentParentMissing(opts.kind));
    }

    const count = await countOwnedFiles(tx, opts.kind, opts.parentId);
    if (count + prepared.length > cap) {
      throw ApiError.badRequest(attachmentCapMessage(opts.kind));
    }

    const used = await userBytesUsed(tx, opts.userId);
    if (used + incomingBytes > uploadQuotaBytes()) {
      throw ApiError.badRequest("Has alcanzado el límite de almacenamiento de archivos.");
    }

    const saved: SavedAttachment[] = [];
    for (const file of prepared) {
      const id = nanoid();
      const storageKey = `${opts.userId}/${opts.kind}/${id}`;
      const tmpKey = `${opts.userId}/tmp/${id}`;
      await writeAttachmentFile(tmpKey, file.buffer);
      try {
        await fs.mkdir(path.dirname(absUploadPath(storageKey)), { recursive: true });
        const row = await createOwnedFile(tx, opts.kind, {
          id,
          userId: opts.userId,
          parentId: opts.parentId,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey,
        });
        await fs.rename(absUploadPath(tmpKey), absUploadPath(storageKey));
        saved.push(row);
      } catch (err) {
        await removeAttachmentFile(tmpKey);
        await removeAttachmentFile(storageKey);
        throw err;
      }
    }
    return saved;
  });
}

export function sendAttachmentHeaders(
  res: { setHeader: (k: string, v: string) => void },
  att: { mimeType: string; filename: string },
): void {
  const inline = isPreviewableImage(att.mimeType) || att.mimeType === "application/pdf";
  res.setHeader("Content-Type", att.mimeType);
  res.setHeader("Content-Disposition", contentDisposition(att.filename, inline));
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024;

export function wallpaperStorageKey(userId: string): string {
  return `${userId}/wallpaper.jpg`;
}

export function isJpegBuffer(data: Buffer): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
