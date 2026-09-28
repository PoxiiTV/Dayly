import type { TaskAttachment } from "@/lib/types";
import { http } from "@/lib/api";
import {
  type AttachmentKind,
  MAX_ATTACHMENT_BYTES,
  isPreviewableImage,
  maxFilesFor,
  resolveAllowedMime,
  taskFileAccept,
  attachmentCapMessage,
} from "@attachment-policy";

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_ATTACHMENTS_PER_REMINDER,
  isPreviewableImage,
  noteImageAccept,
  taskFileAccept,
  maxFilesFor,
  resolveAllowedMime,
  sanitizeFilename,
  attachmentCapMessage,
  attachmentDropHint,
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

/** Files from a paste event (screenshots, copied images, or other allowed attachments). */
export function filesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && file.size > 0) files.push(file);
  }
  if (files.length) return files;
  return Array.from(data.files ?? []).filter((file) => file.size > 0);
}

export async function uploadAttachments(kind: AttachmentKind, parentId: string, files: File[]): Promise<TaskAttachment[]> {
  if (!files.length) return [];
  if (files.length > maxFilesFor(kind)) {
    throw new Error(attachmentCapMessage(kind));
  }
  const fd = new FormData();
  for (const file of files) fd.append("files", file);
  const path = (() => {
    switch (kind) {
      case "note": return `/api/notes/${parentId}/attachments`;
      case "task": return `/api/tasks/${parentId}/attachments`;
      case "reminder": return `/api/reminders/${parentId}/attachments`;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  })();
  const r = await http.postForm<{ attachments?: TaskAttachment[]; attachment?: TaskAttachment }>(path, fd);
  return r.attachments ?? (r.attachment ? [r.attachment] : []);
}
