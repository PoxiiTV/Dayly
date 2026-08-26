import type { TaskAttachment } from "@/lib/types";
import { http } from "@/lib/api";
import {
  type AttachmentKind,
  MAX_ATTACHMENT_BYTES,
  isPreviewableImage,
  maxFilesFor,
  resolveAllowedMime,
  taskFileAccept,
} from "@attachment-policy";

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENTS_PER_NOTE,
  isPreviewableImage,
  noteImageAccept,
  taskFileAccept,
  maxFilesFor,
  resolveAllowedMime,
  sanitizeFilename,
} from "@attachment-policy";
export type { AttachmentKind } from "@attachment-policy";

export function attachmentAccept(): string {
  return taskFileAccept();
}

export async function validateAttachmentFile(file: File, kind: AttachmentKind): Promise<string | null> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return kind === "note" ? "La imagen pesa más de 2 MB." : "El archivo pesa más de 2 MB.";
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!resolveAllowedMime(buf, file.name || "archivo", kind)) {
    return kind === "note"
      ? "Solo se admiten imágenes (JPG, PNG, WebP o GIF)."
      : "Tipo no permitido. Usa imagen, PDF, texto, ZIP, Word o Excel.";
  }
  return null;
}

export type PendingAttachment = { key: string; file: File; preview: string | null };

export function countAttachments(existing: TaskAttachment[], pending: PendingAttachment[], removed: string[]): number {
  return existing.filter((a) => !removed.includes(a.id)).length + pending.length;
}

export async function uploadAttachments(kind: AttachmentKind, parentId: string, files: File[]): Promise<TaskAttachment[]> {
  if (!files.length) return [];
  if (files.length > maxFilesFor(kind)) {
    throw new Error(kind === "note" ? "Máximo 8 imágenes por nota." : "Máximo 5 archivos por tarea.");
  }
  const fd = new FormData();
  for (const file of files) fd.append("files", file);
  const path = kind === "note"
    ? `/api/notes/${parentId}/attachments`
    : `/api/tasks/${parentId}/attachments`;
  const r = await http.postForm<{ attachments?: TaskAttachment[]; attachment?: TaskAttachment }>(path, fd);
  return r.attachments ?? (r.attachment ? [r.attachment] : []);
}
