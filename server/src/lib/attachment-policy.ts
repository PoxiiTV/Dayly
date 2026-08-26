/** Canonical attachment rules. Pure TS — imported by the API and the Vite client. */

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 5;
export const MAX_ATTACHMENTS_PER_NOTE = 8;
export const DEFAULT_UPLOAD_QUOTA_BYTES = 200 * 1024 * 1024;

export type AttachmentKind = "task" | "note";

export const NOTE_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const TASK_FILE_MIMES = [
  ...NOTE_IMAGE_MIMES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const NOTE_SET = new Set<string>(NOTE_IMAGE_MIMES);
const TASK_SET = new Set<string>(TASK_FILE_MIMES);

export function maxFilesFor(kind: AttachmentKind): number {
  return kind === "note" ? MAX_ATTACHMENTS_PER_NOTE : MAX_ATTACHMENTS_PER_TASK;
}

export function allowedMimesFor(kind: AttachmentKind): ReadonlySet<string> {
  return kind === "note" ? NOTE_SET : TASK_SET;
}

export function isPreviewableImage(mime: string): boolean {
  return NOTE_SET.has(mime === "image/jpg" ? "image/jpeg" : mime);
}

export function noteImageAccept(): string {
  return "image/jpeg,image/png,image/webp,image/gif";
}

export function taskFileAccept(): string {
  return TASK_FILE_MIMES.join(",");
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  return base || "archivo";
}

function hasPrefix(buf: Uint8Array, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function looksLikeText(buf: Uint8Array): boolean {
  if (!buf.length || buf[0] === 0x3c /* < */) return false;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return false;
  }
  return true;
}

/** Detect MIME from bytes. Client-declared type is ignored. */
export function sniffMime(buf: Uint8Array, filename: string): string | null {
  if (hasPrefix(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasPrefix(buf, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (hasPrefix(buf, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    buf.length >= 12
    && hasPrefix(buf, [0x52, 0x49, 0x46, 0x46])
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  if (hasPrefix(buf, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (hasPrefix(buf, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buf, [0x50, 0x4b, 0x05, 0x06])) {
    const name = filename.toLowerCase();
    if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/zip";
  }
  const name = filename.toLowerCase();
  if (looksLikeText(buf)) {
    if (name.endsWith(".csv")) return "text/csv";
    if (name.endsWith(".txt") || name.endsWith(".text")) return "text/plain";
  }
  return null;
}

export function resolveAllowedMime(buf: Uint8Array, filename: string, kind: AttachmentKind): string | null {
  const mime = sniffMime(buf, filename);
  if (!mime) return null;
  return allowedMimesFor(kind).has(mime) ? mime : null;
}

export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = sanitizeFilename(filename).replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(sanitizeFilename(filename));
  return `${inline ? "inline" : "attachment"}; filename="${ascii || "archivo"}"; filename*=UTF-8''${encoded}`;
}

export const TRASH_TYPES = ["task", "event", "note", "project", "goal"] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export function parseTrashType(raw: string | undefined): TrashType | null {
  if (!raw) return null;
  return (TRASH_TYPES as readonly string[]).includes(raw) ? (raw as TrashType) : null;
}
