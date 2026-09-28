import "./bootstrap/dotenv.js";
import { APP_NAME, APP_VERSION } from "./lib/brand.js";
import { config } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { ensureRolesAndAdmin } from "./bootstrap/ensureAdmin.js";
import { startTransferSweeper } from "./lib/chat/transfers.js";
import { startAlertWorker } from "./lib/alertWorker.js";
import { startMessagingWorker } from "./lib/messaging/worker.js";
import { bootstrapIntegrationSettings } from "./lib/integrationSettings.js";

async function start() {
  // Fail fast if DB is unreachable at boot (not left to fail lazily).
  await prisma.$connect();
  logger.info("Database connection OK");
  await ensureRolesAndAdmin();
  await bootstrapIntegrationSettings();

  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info(`${APP_NAME} API v${APP_VERSION} listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
    startAlertWorker();
    startTransferSweeper();
    startMessagingWorker();
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    // Safety net if close hangs.
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.error({ err }, "Fatal: failed to start server");
  process.exit(1);
});
