import { createHash } from "node:crypto";
import webpush from "web-push";
import { config } from "../config/env.js";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { isAllowedPushEndpoint } from "./pushAllowlist.js";
import { ApiError } from "./errors.js";

function configured() {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

function setup() {
  if (!configured()) return false;
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  return true;
}

export function vapidPublicKey(): string | null {
  return configured() ? config.vapid.publicKey : null;
}

export function endpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function saveSubscription(userId: string, endpoint: string, p256dh: string, auth: string) {
  if (!isAllowedPushEndpoint(endpoint)) {
    throw ApiError.badRequest("Endpoint de push no permitido");
  }
  const hash = endpointHash(endpoint);
  await prisma.pushSubscription.upsert({
    where: { endpointHash: hash },
    create: { userId, endpoint, endpointHash: hash, p256dh, auth },
    update: { userId, endpoint, p256dh, auth },
  });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpointHash: endpointHash(endpoint) } });
}

export async function sendWebPush(userId: string, payload: { title: string; body: string; url?: string }) {
  if (config.nodeEnv === "test") return;
  if (!setup()) return;
  const rows = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => undefined);
      } else {
        logger.warn({ err, userId }, "web-push failed");
      }
    }
  }));
}
