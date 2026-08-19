import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ApiError } from "../lib/errors.js";

/**
 * Validate a request part against a zod schema. On failure returns a 422 with
 * a human-readable, RFC-predictable list of errors — no internal detail leaked.
 */
export function validate(schema: ZodType, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return next(
        ApiError.validation("Algunos campos no son correctos.", details),
      );
    }
    (req as Request & Record<string, unknown>)[`validated${source[0].toUpperCase() + source.slice(1)}`] =
      result.data;
    return next();
  };
}