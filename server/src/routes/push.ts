import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import * as schemas from "../validation/schemas.js";
import { removeSubscription, saveSubscription, vapidPublicKey } from "../lib/push.js";

export const pushRouter = Router();
pushRouter.use(requireAuth);

pushRouter.get("/vapid", asyncHandler(async (_req, res) => {
  res.json({ publicKey: vapidPublicKey() });
}));

pushRouter.post("/subscribe", validate(schemas.pushSubscribeSchema), asyncHandler(async (req, res) => {
  const b = req.body as { endpoint: string; keys: { p256dh: string; auth: string } };
  await saveSubscription(req.user!.id, b.endpoint, b.keys.p256dh, b.keys.auth);
  const { prisma } = await import("../lib/prisma.js");
  await prisma.user.update({ where: { id: req.user!.id }, data: { notifyPush: true } });
  res.json({ ok: true });
}));

pushRouter.post("/unsubscribe", validate(schemas.pushUnsubscribeSchema), asyncHandler(async (req, res) => {
  await removeSubscription(req.user!.id, (req.body as { endpoint: string }).endpoint);
  res.json({ ok: true });
}));
