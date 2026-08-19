import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { tickAlerts } from "../lib/alerts.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.post("/tick", asyncHandler(async (req, res) => {
  res.json(await tickAlerts(req.user!.id));
}));
