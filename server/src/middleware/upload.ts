import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ApiError } from "../lib/errors.js";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_NOTE } from "../lib/attachment-policy.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_NOTE },
});

/** Multipart field `files`. Size limit is per-file; kind caps are enforced in saveOwnedFiles. */
export function acceptAttachmentFiles(req: Request, res: Response, next: NextFunction): void {
  upload.array("files", MAX_ATTACHMENTS_PER_NOTE)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      next(ApiError.badRequest("El archivo pesa más de 2 MB."));
      return;
    }
    next(ApiError.badRequest("No se pudo leer el archivo."));
  });
}

export function postedFiles(req: Request): { buffer: Buffer; filename: string }[] {
  const raw = req.files;
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => ({ buffer: f.buffer, filename: f.originalname || "archivo" }));
}
