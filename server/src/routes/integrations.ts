import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { getIntegrationStates } from "../lib/integrationVisibility.js";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  // An admin change must show up on the next load, never from a cache.
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ integrations: await getIntegrationStates() });
}));
