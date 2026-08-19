import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { audit } from "../middleware/audit.js";
import * as schemas from "../validation/schemas.js";
import { parseTransfer, serializeTransfer, type TransferFormat } from "../lib/transfer.js";
import { loadBundle, parseTypes, persistBundle } from "../services/transfer.service.js";

export const transferRouter = Router();
transferRouter.use(requireAuth);

const FILENAME: Record<TransferFormat, string> = {
  json: "dayly-export.json",
  csv: "dayly-export.csv",
  ics: "dayly-export.ics",
};

const MIME: Record<TransferFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  ics: "text/calendar; charset=utf-8",
};

transferRouter.get(
  "/export",
  validate(schemas.exportQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as { format?: string; types?: string };
    const format = (q.format || "json") as TransferFormat;
    const types = parseTypes(q.types);
    const bundle = await loadBundle(req.user!.id, types);
    await audit(req, "transfer.export", { metadata: { format, types } });

    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="${FILENAME.json}"`);
      return res.json(bundle);
    }
    const body = serializeTransfer(bundle, format);
    res.setHeader("Content-Type", MIME[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${FILENAME[format]}"`);
    res.send(body);
  }),
);

transferRouter.post(
  "/import",
  validate(schemas.importBodySchema),
  asyncHandler(async (req, res) => {
    const { format, text } = req.body as { format?: "json" | "csv" | "ics" | "auto"; text: string };
    let bundle;
    try {
      bundle = parseTransfer(text, format ?? "auto");
    } catch (err) {
      throw ApiError.badRequest(err instanceof Error ? err.message : "Archivo no válido.");
    }
    const created = await persistBundle(req.user!.id, bundle);
    await audit(req, "transfer.import", { metadata: { created } });
    res.json({ created });
  }),
);
