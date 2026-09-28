import { prisma } from "./prisma.js";
import { tickAlerts } from "./alerts.js";
import { logger } from "./logger.js";

let running = false;

export function startAlertWorker() {
  if (process.env.NODE_ENV === "test") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      for (const user of users) {
        try {
          await tickAlerts(user.id);
        } catch (err) {
          logger.warn({ err, userId: user.id }, "Alert worker failed for user");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Alert worker tick failed");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
}
