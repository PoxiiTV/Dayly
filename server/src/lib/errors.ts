import type { NextFunction, Request, Response } from "express";

/**
 * Typed API errors with an HTTP status. Human-friendly `message` is what the
 * client ever sees; never leak internal details (see errorHandler).
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  isOperational: boolean;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(message = "Solicitud no válida", details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }
  static unauthorized(message = "No autorizado") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "No tienes permiso para esto") {
    return new ApiError(403, "FORBIDDEN", message);
  }
  static notFound(message = "No encontrado") {
    return new ApiError(404, "NOT_FOUND", message);
  }
  static conflict(message = "Conflicto", details?: unknown) {
    return new ApiError(409, "CONFLICT", message, details);
  }
  static tooMany(message = "Demasiadas peticiones. Inténtalo más tarde.", details?: unknown) {
    return new ApiError(429, "RATE_LIMITED", message, details);
  }
  static validation(message = "Datos no válidos", details?: unknown) {
    return new ApiError(422, "VALIDATION_ERROR", message, details);
  }
  static internal(message = "Ha ocurrido un error inesperado") {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}

/** async route wrapper: forwards rejections to Express error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Default export bind to avoid TS `export =` friction.
export default ApiError;