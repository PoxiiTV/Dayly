import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { weatherSnapshot } from "../lib/mascot/weather.js";

export const weatherRouter = Router();
weatherRouter.use(requireAuth);

weatherRouter.get("/", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { timezone: true, weatherCity: true } });
  const weather = await weatherSnapshot(user.weatherCity ?? "", user.timezone);
  if (!weather) {
    res.status(502).json({ error: { code: "WEATHER_UNAVAILABLE", message: "No se pudo consultar Open-Meteo ahora." } });
    return;
  }
  res.json({ weather });
}));
