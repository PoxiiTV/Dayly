import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { config } from "../config/env.js";

/** Central error handler: converts anything to a safe JSON response. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) {
    logger.error({ message: (err as Error)?.message }, "error after headers sent");
    return;
  }
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ message: err.message, code: err.code }, "api error");
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Prisma known errors -> human-friendly, no leak.
  const code = (err as { code?: string })?.code;
  if (code === "P2002") {
    return res.status(409).json({
      error: { code: "CONFLICT", message: "Ese valor ya existe y no puede repetirse." },
    });
  }
  if (code === "P2003") {
    return res.status(400).json({
      error: { code: "BAD_REQUEST", message: "La referencia a otro elemento es inválida." },
    });
  }
  if (code === "P2025") {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "El elemento no existe o ya fue eliminado." },
    });
  }
  if (
    (err as { name?: string }).name === "PayloadTooLargeError"
    || (err as { status?: number }).status === 413
    || (err as { statusCode?: number }).statusCode === 413
  ) {
    return res
      .status(413)
      .json({ error: { code: "PAYLOAD_TOO_LARGE", message: "El archivo es demasiado grande." } });
  }

  logger.error(
    { message: (err as Error)?.message, stack: (err as Error)?.stack },
    "Unhandled error",
  );
  if (config.nodeEnv === "test") {
    return res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: String((err as Error)?.message) } });
  }
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Ha ocurrido un error inesperado. Inténtalo de nuevo." },
  });
}

/** 404 for unknown API routes. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada." } });
}