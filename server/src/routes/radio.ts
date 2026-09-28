import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { radioProbeLimiter } from "../middleware/rateLimit.js";
import * as schemas from "../validation/schemas.js";
import { isAllowedRadioStreamUrl, probeRadioStream, stripCacheBust } from "../lib/radioStreamInfo.js";

export const radioRouter = Router();
radioRouter.use(requireAuth);

radioRouter.get("/stream-info", radioProbeLimiter, validate(schemas.radioStreamInfoSchema, "query"), asyncHandler(async (req, res) => {
  const url = stripCacheBust(String(req.query.url ?? ""));
  if (!isAllowedRadioStreamUrl(url)) throw ApiError.badRequest("Emisora no válida.");
  const info = await probeRadioStream(url);
  res.json(info);
}));
