import "./bootstrap/dotenv.js";
import { config } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { ensureRolesAndAdmin } from "./bootstrap/ensureAdmin.js";
import { startBriefingScheduler } from "./lib/briefing.js";
import { startTelegramBotScheduler } from "./lib/telegramBot.js";

async function start() {
  // Fail fast if DB is unreachable at boot (not left to fail lazily).
  await prisma.$connect();
  logger.info("Database connection OK");
  await ensureRolesAndAdmin();

  startBriefingScheduler();
  logger.info("Morning briefing scheduler started");
  startTelegramBotScheduler();
  logger.info("Telegram bot scheduler started");

  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info(`Dayly API listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
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