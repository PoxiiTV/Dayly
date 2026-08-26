// Load env first (before any module reads process.env).
import "./bootstrap/dotenv.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { limiter } from "./middleware/rateLimit.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Trust the reverse proxy on Plesk (nginx). "1" = first hop.
  if (config.trustProxy === 1 || config.trustProxy === true) {
    app.set("trust proxy", 1);
  } else if (Array.isArray(config.trustProxy) && config.trustProxy.length > 0) {
    app.set("trust proxy", config.trustProxy);
  }

  // Security headers.
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "same-origin" },
    frameguard: { action: "sameorigin" },
  }));

  // CORS: only the configured client origin may call the API with credentials.
  app.use(
    cors({
      origin: config.clientOrigin.split(",").map((s) => s.trim()),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Global rate limit (stricter per-route limits already set in auth).
  app.use(limiter);

  if (config.nodeEnv === "development") {
    app.use((req, _res, next) => {
      logger.info({ method: req.method, path: req.path, ip: req.ip }, "req");
      next();
    });
  }

  app.use("/api", apiRouter);

  // SPA static (when built) for the standalone API server.
  // All npm scripts run with cwd = server/, so repo client/dist is ../client/dist.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", "client", "dist"),
    path.resolve(process.cwd(), "client", "dist"),
    path.resolve(process.cwd(), "..", "client", "dist"),
  ];
  const clientDist = candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[0];
  app.use(express.static(clientDist, { maxAge: "1h" }));

  // SPA history fallback: serve index.html for any non-API GET (deep routes).
  app.get(/^\/(?!api\/|.*\.(?:js|css|png|svg|jpg|ico|webmanifest|woff2?)$).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}