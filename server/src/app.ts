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
import { APP_VERSION } from "./lib/brand.js";

const VERSIONED_APP_WORKER = /^\/sw-(\d+\.\d+\.\d+)\.js$/;
const STALE_WORKER_RETIREMENT = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.allSettled(cacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await self.registration.unregister();
    await Promise.allSettled(windows.map((client) => client.navigate(client.url)));
  })());
});
`;

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
    contentSecurityPolicy: {
      directives: {
        mediaSrc: [
          "'self'",
          "blob:",
          "mediastream:",
          "https://*.we4stream.com",
          "https://*.we4stream.com:2020",
          "https://streaming.shoutcast.com",
          "https://azura.abcorp.es",
          "https://playerservices.streamtheworld.com",
          "https://*.live.streamtheworld.com",
          "https://eu1.lhdserver.es:9041",
          "https://*.nucast.co.uk",
          "https://*.nucast.co.uk:8044",
          "https://*.scdn.co",
          "https://*.spotifycdn.com",
          "https://*.spotify.com",
          "https://*.akamaized.net",
          "https://*.akamaihd.net",
        ],
        scriptSrc: ["'self'", "https://sdk.scdn.co", "https://connect.facebook.net"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://open.spotify.com", "https://sdk.scdn.co", "https://*.scdn.co", "https://www.facebook.com", "https://web.facebook.com"],
        connectSrc: [
          "'self'",
          "https://api.spotify.com",
          "https://accounts.spotify.com",
          "https://apresolve.spotify.com",
          "https://*.spotify.com",
          "wss://*.spotify.com",
          "wss://*.scdn.co",
          "https://*.scdn.co",
          "https://*.spotifycdn.com",
          "https://*.akamaized.net",
          "https://*.akamaihd.net",
          "https://seektables.scdn.co",
          "https://gae-spclient.spotify.com",
          "https://gae2-spclient.spotify.com",
          "https://gew1-spclient.spotify.com",
          "https://gew4-spclient.spotify.com",
          "https://spclient.wg.spotify.com",
          "https://www.googleapis.com",
          "https://graph.facebook.com",
          "https://*.googleapis.com",
          "https://*.gvt1.com",
          "https://api.pwnedpasswords.com",
          "https://*.nucast.co.uk",
          "https://*.nucast.co.uk:8044",
          // Cloudflare's trace: the only honest way to tell whether this
          // machine is already going out through WARP.
          "https://www.cloudflare.com",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://images.unsplash.com",
          "https://i.scdn.co",
          "https://mosaic.scdn.co",
          "https://*.scdn.co",
          "https://*.spotifycdn.com",
          "https://image-cdn-ak.spotifycdn.com",
          "https://image-cdn-fa.spotifycdn.com",
          // Chat GIFs come from the providers' media hosts, nowhere else.
          "https://*.giphy.com",
          "https://*.klipy.com",
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "sameorigin" },
  }));
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "encrypted-media=*, autoplay=*");
    res.setHeader("Feature-Policy", "encrypted-media *; autoplay *");
    next();
  });

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

  app.use((req, res, next) => {
    const bulkVault = req.method === "POST" && (
      req.path === "/api/vault/items/import"
      || req.path === "/api/vault/import"
      || req.path === "/api/vault/rekey"
    );
    express.json({
      limit: bulkVault ? "16mb" : "1mb",
      verify: (request, _response, buffer) => {
        const appRequest = request as typeof request & { originalUrl?: string; rawBody?: Buffer };
        if (appRequest.originalUrl?.startsWith("/api/messaging/whatsapp/webhook")) {
          appRequest.rawBody = Buffer.from(buffer);
        }
      },
    })(req, res, next);
  });
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Global rate limit (stricter per-route limits already set in auth).
  // Only the API: a page load plus a service-worker precache is ~25 static
  // files, and counting those spent most of the budget before the user did
  // anything at all.
  app.use("/api", limiter);

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

  // The visualizer frame is the one document allowed to evaluate strings:
  // MilkDrop presets are compiled with `new Function`. Keeping it in its own
  // document is what stops that permission from reaching the application —
  // and the vault — while everything else here is denied to it.
  app.get("/visualizer-frame.html", (_req, res, next) => {
    res.setHeader("Content-Security-Policy", [
      "default-src 'none'",
      // The only document allowed to evaluate strings, and it can do nothing
      // else: no network, no frames, no forms. Same origin as the app, so its
      // own bundle loads without CORS, but the permission stops at this file.
      "script-src 'self' 'unsafe-eval' blob:",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "connect-src blob: data:",
      "worker-src blob:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; "));
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    next();
  });

  app.use(express.static(clientDist, {
    maxAge: "1h",
    setHeaders: (res, filePath) => {
      const normalized = filePath.replaceAll("\\", "/");
      if (normalized.endsWith("/index.html")
        || /\/sw(?:-[^/]+)?\.js$/.test(normalized)
        || normalized.endsWith("/dayly-push.js")
        || normalized.endsWith("/registerSW.js")
        || normalized.endsWith("/manifest.webmanifest")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));

  // An installed worker keeps requesting its original versioned URL. Once
  // that file is no longer part of the current build, retire the worker and
  // its precache so even a tab running an old reload button can recover.
  app.get(VERSIONED_APP_WORKER, (req, res, next) => {
    const requestedVersion = VERSIONED_APP_WORKER.exec(req.path)?.[1];
    if (!requestedVersion || requestedVersion === APP_VERSION) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Service-Worker-Allowed", "/");
    res.type("application/javascript").send(STALE_WORKER_RETIREMENT);
  });

  // SPA history fallback: serve index.html for any non-API GET (deep routes).
  app.get(/^\/(?!api\/|.*\.(?:js|css|png|svg|jpg|ico|webmanifest|woff2?)$).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
