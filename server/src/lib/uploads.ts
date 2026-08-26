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
} from "./attachment-policy.js";

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENTS_PER_NOTE,
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
  ]);
  await purgeFiles(keys);
  try {
    await fs.rm(absUploadPath(userId), { recursive: true, force: true });
  } catch {
    /* folder already gone */
  }
}

async function userBytesUsed(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const [tasks, notes] = await Promise.all([
    db.taskAttachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    db.noteAttachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
  ]);
  return (tasks._sum.sizeBytes ?? 0) + (notes._sum.sizeBytes ?? 0);
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

export async function saveOwnedFiles(opts: {
  userId: string;
  kind: AttachmentKind;
  parentId: string;
  files: IncomingFile[];
}): Promise<SavedAttachment[]> {
  if (!opts.files.length) throw ApiError.badRequest("Falta el archivo.");
  const cap = maxFilesFor(opts.kind);
  if (opts.files.length > cap) {
    throw ApiError.badRequest(opts.kind === "note" ? "Máximo 8 imágenes por nota." : "Máximo 5 archivos por tarea.");
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
    const parentSql = opts.kind === "task"
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Task WHERE id = ${opts.parentId} AND userId = ${opts.userId} AND deletedAt IS NULL FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Note WHERE id = ${opts.parentId} AND userId = ${opts.userId} AND deletedAt IS NULL FOR UPDATE`;
    const parentRows = parentSql;
    if (!parentRows.length) {
      throw ApiError.notFound(opts.kind === "note" ? "Nota no encontrada." : "Tarea no encontrada.");
    }

    const count = opts.kind === "task"
      ? await tx.taskAttachment.count({ where: { taskId: opts.parentId } })
      : await tx.noteAttachment.count({ where: { noteId: opts.parentId } });
    if (count + prepared.length > cap) {
      throw ApiError.badRequest(opts.kind === "note" ? "Máximo 8 imágenes por nota." : "Máximo 5 archivos por tarea.");
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
        const row = opts.kind === "task"
          ? await tx.taskAttachment.create({
              data: {
                id,
                taskId: opts.parentId,
                userId: opts.userId,
                filename: file.filename,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                storageKey,
              },
              select: { id: true, filename: true, mimeType: true, sizeBytes: true },
            })
          : await tx.noteAttachment.create({
              data: {
                id,
                noteId: opts.parentId,
                userId: opts.userId,
                filename: file.filename,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                storageKey,
              },
              select: { id: true, filename: true, mimeType: true, sizeBytes: true },
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
