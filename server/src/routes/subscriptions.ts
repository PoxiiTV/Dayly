import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as schemas from "../validation/schemas.js";
import { localYmd } from "../lib/mascot/time.js";
import {
  addMonthsClamped,
  chargeDate,
  chargeYmdFor,
  forecastYmds,
  monthlyCostCents,
  nextChargeYmd,
  normalizeAlertDays,
  ymdOf,
} from "../lib/subscriptions.js";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

const DEFAULT_ALERT_DAYS = [7, 1, 0];

/** Forecast horizon offered to the client, in months. */
const FORECAST_MONTHS = 12;

// Subscriptions and their wallet have no `deletedAt`: like habits, tags and
// reminders they are hard-deleted, so every ownership check is a plain lookup
// and a miss is a 404 (never a 403, which would leak existence).
async function ownedSubscription(userId: string, id: string) {
  const sub = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!sub) throw ApiError.notFound("La suscripción no existe.");
  return sub;
}

async function ownedMethod(userId: string, id: string) {
  const method = await prisma.paymentMethod.findFirst({ where: { id, userId } });
  if (!method) throw ApiError.notFound("El método de pago no existe.");
  return method;
}

// Only subscription tags are accepted here: passing a task tag id must fail,
// not silently attach a label from the other vocabulary.
async function assertTagsOwned(userId: string, tagIds: string[]) {
  if (!tagIds.length) return;
  const count = await prisma.subscriptionTag.count({ where: { id: { in: tagIds }, userId } });
  if (count !== tagIds.length) throw ApiError.badRequest("Etiqueta no válida.");
}

async function ownedTag(userId: string, id: string) {
  const tag = await prisma.subscriptionTag.findFirst({ where: { id, userId } });
  if (!tag) throw ApiError.notFound("La etiqueta no existe.");
  return tag;
}

async function assertMethodOwned(userId: string, methodId: string | null | undefined) {
  if (!methodId) return;
  const found = await prisma.paymentMethod.findFirst({ where: { id: methodId, userId }, select: { id: true } });
  if (!found) throw ApiError.badRequest("Método de pago no válido.");
}

function methodLabelOf(method: { alias: string; last4: string | null } | null | undefined): string | null {
  if (!method) return null;
  return method.last4 ? `${method.alias} ····${method.last4}` : method.alias;
}

const subscriptionInclude = {
  tags: { select: { id: true, name: true, color: true } },
  paymentMethod: { select: { id: true, alias: true, kind: true, last4: true, color: true, archivedAt: true } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;

/** Shape sent to the client: dates as plain days, alert rules already normalised. */
function serialize(sub: SubscriptionRow) {
  const { alertDaysBefore, nextChargeAt, ...rest } = sub;
  return {
    ...rest,
    nextChargeDate: ymdOf(nextChargeAt),
    alertDaysBefore: normalizeAlertDays(alertDaysBefore),
  };
}

// ---------- Wallet ----------

subscriptionsRouter.get("/methods", asyncHandler(async (req, res) => {
  const methods = await prisma.paymentMethod.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ archivedAt: "asc" }, { alias: "asc" }],
  });
  res.json({ methods });
}));

subscriptionsRouter.post("/methods", validate(schemas.createPaymentMethodSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof schemas.createPaymentMethodSchema>;
  try {
    const method = await prisma.paymentMethod.create({
      data: {
        userId: req.user!.id,
        alias: b.alias.trim(),
        kind: b.kind ?? "OTHER",
        last4: b.last4 ?? null,
        color: b.color ?? null,
      },
    });
    res.status(201).json({ method });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw ApiError.conflict("Ya tienes un método de pago con ese nombre.");
    throw err;
  }
}));

subscriptionsRouter.patch("/methods/:id", validate(schemas.updatePaymentMethodSchema), asyncHandler(async (req, res) => {
  await ownedMethod(req.user!.id, req.params.id);
  const b = req.body as z.infer<typeof schemas.updatePaymentMethodSchema>;
  const data: Prisma.PaymentMethodUpdateInput = {};
  if (b.alias !== undefined) data.alias = b.alias.trim();
  if (b.kind !== undefined) data.kind = b.kind;
  if (b.last4 !== undefined) data.last4 = b.last4 ?? null;
  if (b.color !== undefined) data.color = b.color ?? null;
  if (b.archived !== undefined) data.archivedAt = b.archived ? new Date() : null;
  try {
    const method = await prisma.paymentMethod.update({ where: { id: req.params.id }, data });
    res.json({ method });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw ApiError.conflict("Ya tienes un método de pago con ese nombre.");
    throw err;
  }
}));

// Archives instead of deleting when the history still points at it: wiping the
// row would turn old charges into "paid with nothing".
subscriptionsRouter.delete("/methods/:id", asyncHandler(async (req, res) => {
  await ownedMethod(req.user!.id, req.params.id);
  const inUse = await prisma.subscription.count({ where: { userId: req.user!.id, paymentMethodId: req.params.id } });
  if (inUse > 0) {
    const method = await prisma.paymentMethod.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } });
    res.json({ ok: true, archived: true, method });
    return;
  }
  await prisma.paymentMethod.delete({ where: { id: req.params.id } });
  res.json({ ok: true, archived: false });
}));

// ---------- Tags ----------
// Declared before "/:id" so the literal path is not swallowed by the parameter.

subscriptionsRouter.get("/tags", asyncHandler(async (req, res) => {
  const tags = await prisma.subscriptionTag.findMany({
    where: { userId: req.user!.id },
    orderBy: { name: "asc" },
  });
  res.json({ tags });
}));

subscriptionsRouter.post("/tags", validate(schemas.createSubscriptionTagSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof schemas.createSubscriptionTagSchema>;
  try {
    const tag = await prisma.subscriptionTag.create({
      data: { userId: req.user!.id, name: b.name.trim(), color: b.color ?? null },
    });
    res.status(201).json({ tag });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw ApiError.conflict("Ya tienes una etiqueta de suscripciones con ese nombre.");
    throw err;
  }
}));

subscriptionsRouter.patch("/tags/:id", validate(schemas.updateSubscriptionTagSchema), asyncHandler(async (req, res) => {
  await ownedTag(req.user!.id, req.params.id);
  const b = req.body as z.infer<typeof schemas.updateSubscriptionTagSchema>;
  const data: Prisma.SubscriptionTagUpdateInput = {};
  if (b.name !== undefined) data.name = b.name.trim();
  if (b.color !== undefined) data.color = b.color ?? null;
  try {
    const tag = await prisma.subscriptionTag.update({ where: { id: req.params.id }, data });
    res.json({ tag });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw ApiError.conflict("Ya tienes una etiqueta de suscripciones con ese nombre.");
    throw err;
  }
}));

// Deleting a tag only removes the label: the subscriptions stay, the join rows
// go with it through the cascade.
subscriptionsRouter.delete("/tags/:id", asyncHandler(async (req, res) => {
  await ownedTag(req.user!.id, req.params.id);
  await prisma.subscriptionTag.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- Summary ----------
// Declared before "/:id" so the literal path is not swallowed by the parameter.

subscriptionsRouter.get("/summary", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const tz = (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone ?? "Europe/Madrid";
  const todayYmd = localYmd(tz);
  const year = Number(todayYmd.slice(0, 4));

  const [subs, paidThisYear] = await Promise.all([
    prisma.subscription.findMany({ where: { userId }, include: subscriptionInclude }),
    prisma.subscriptionCharge.aggregate({
      where: { userId, status: "PAID", dueAt: { gte: chargeDate(`${year}-01-01`), lt: chargeDate(`${year + 1}-01-01`) } },
      _sum: { amountCents: true },
    }),
  ]);

  const active = subs.filter((s) => s.status === "ACTIVE");
  const monthlyCents = monthlyCostCents(active);

  // Forecast window: the next three months, exclusive of charges the user
  // already settled (those are real spending, counted above). It reaches back
  // to the oldest pending charge, because an overdue one is still owed.
  const windowStartYmd = active.reduce((min, sub) => {
    const ymd = ymdOf(sub.nextChargeAt);
    return ymd < min ? ymd : min;
  }, todayYmd);
  const settled = await prisma.subscriptionCharge.findMany({
    where: { userId, dueAt: { gte: chargeDate(windowStartYmd) } },
    select: { subscriptionId: true, dueAt: true },
  });
  const settledKeys = new Set(settled.map((c) => `${c.subscriptionId}:${ymdOf(c.dueAt)}`));

  const horizonYmd = addMonthsClamped(todayYmd, 3);
  let next3MonthsCents = 0;
  const upcoming: { subscriptionId: string; name: string; dueDate: string; amountCents: number }[] = [];
  for (const sub of active) {
    // An overdue charge is still owed, so the window starts at whichever comes
    // first: today or the pending charge the user has not confirmed yet.
    const startYmd = ymdOf(sub.nextChargeAt);
    for (const ymd of forecastYmds(sub, startYmd, startYmd < todayYmd ? startYmd : todayYmd, horizonYmd)) {
      if (settledKeys.has(`${sub.id}:${ymd}`)) continue;
      next3MonthsCents += sub.amountCents;
      upcoming.push({ subscriptionId: sub.id, name: sub.name, dueDate: ymd, amountCents: sub.amountCents });
    }
  }
  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Breakdowns use the normalised monthly cost so a yearly and a monthly
  // subscription can sit in the same bar chart without lying.
  const byTag = new Map<string, { tagId: string | null; name: string; color: string | null; monthlyCents: number }>();
  const byMethod = new Map<string, { methodId: string | null; name: string; monthlyCents: number }>();
  for (const sub of active) {
    const share = Math.round(sub.amountCents / Math.max(1, sub.cycleMonths));
    if (sub.tags.length === 0) {
      const row = byTag.get("") ?? { tagId: null, name: "Sin etiqueta", color: null, monthlyCents: 0 };
      row.monthlyCents += share;
      byTag.set("", row);
    } else {
      // A subscription with two tags would otherwise be counted twice, so the
      // share is split between them and the totals still add up.
      const per = Math.round(share / sub.tags.length);
      for (const tag of sub.tags) {
        const row = byTag.get(tag.id) ?? { tagId: tag.id, name: tag.name, color: tag.color, monthlyCents: 0 };
        row.monthlyCents += per;
        byTag.set(tag.id, row);
      }
    }
    const key = sub.paymentMethodId ?? "";
    const row = byMethod.get(key) ?? { methodId: sub.paymentMethodId, name: methodLabelOf(sub.paymentMethod) ?? "Sin método", monthlyCents: 0 };
    row.monthlyCents += share;
    byMethod.set(key, row);
  }

  res.json({
    counts: {
      active: active.length,
      paused: subs.filter((s) => s.status === "PAUSED").length,
      cancelled: subs.filter((s) => s.status === "CANCELLED").length,
    },
    monthlyCents,
    yearlyProjectionCents: monthlyCents * 12,
    paidThisYearCents: paidThisYear._sum.amountCents ?? 0,
    next3MonthsCents,
    upcoming: upcoming.slice(0, 40),
    byTag: [...byTag.values()].sort((a, b) => b.monthlyCents - a.monthlyCents),
    byMethod: [...byMethod.values()].sort((a, b) => b.monthlyCents - a.monthlyCents),
    year,
  });
}));

// ---------- Subscriptions ----------

subscriptionsRouter.get("/", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const q = req.query as Record<string, string | undefined>;
  const where: Prisma.SubscriptionWhereInput = { userId };
  if (q.status && ["ACTIVE", "PAUSED", "CANCELLED"].includes(q.status)) {
    where.status = q.status as Prisma.SubscriptionWhereInput["status"];
  }
  if (q.tagId) where.tags = { some: { id: q.tagId } };
  if (q.methodId) where.paymentMethodId = q.methodId;
  if (q.dueBefore && /^\d{4}-\d{2}-\d{2}$/.test(q.dueBefore)) where.nextChargeAt = { lte: chargeDate(q.dueBefore) };
  const term = q.q?.trim();
  if (term) {
    where.OR = [{ name: { contains: term } }, { vendor: { contains: term } }];
  }

  const subs = await prisma.subscription.findMany({
    where,
    include: subscriptionInclude,
    orderBy: [{ status: "asc" }, { nextChargeAt: "asc" }],
    take: 300,
  });
  res.json({ subscriptions: subs.map(serialize) });
}));

subscriptionsRouter.post("/", validate(schemas.createSubscriptionSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const b = req.body as z.infer<typeof schemas.createSubscriptionSchema>;
  await Promise.all([assertTagsOwned(userId, b.tagIds ?? []), assertMethodOwned(userId, b.paymentMethodId)]);

  const firstYmd = b.firstChargeDate.slice(0, 10);
  const sub = await prisma.subscription.create({
    data: {
      userId,
      name: b.name.trim(),
      vendor: b.vendor?.trim() || null,
      notes: b.notes ?? null,
      amountCents: b.amountCents,
      cycleMonths: b.cycleMonths,
      anchorDay: b.anchorDay,
      status: b.status ?? "ACTIVE",
      nextChargeAt: chargeDate(chargeYmdFor(Number(firstYmd.slice(0, 4)), Number(firstYmd.slice(5, 7)), b.anchorDay)),
      startedAt: chargeDate(firstYmd),
      alertHour: b.alertHour ?? 9,
      notifyInApp: b.notifyInApp ?? true,
      notifyTelegram: b.notifyTelegram ?? false,
      notifyEmail: b.notifyEmail ?? false,
      alertDaysBefore: normalizeAlertDays(b.alertDaysBefore ?? DEFAULT_ALERT_DAYS),
      paymentMethodId: b.paymentMethodId ?? null,
      ...(b.tagIds?.length ? { tags: { connect: b.tagIds.map((id) => ({ id })) } } : {}),
    },
    include: subscriptionInclude,
  });
  res.status(201).json({ subscription: serialize(sub) });
}));

subscriptionsRouter.get("/:id", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await ownedSubscription(userId, req.params.id);
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: req.params.id }, include: subscriptionInclude });
  const tz = (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone ?? "Europe/Madrid";
  const todayYmd = localYmd(tz);

  const charges = await prisma.subscriptionCharge.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { dueAt: "desc" },
    take: 120,
  });
  const settledKeys = new Set(charges.map((c) => ymdOf(c.dueAt)));

  // Cancelled subscriptions keep their history but stop projecting.
  // Same rule as the summary: a pending charge from last month must stay on the
  // list, otherwise it is the one charge the user cannot confirm.
  const startYmd = ymdOf(sub.nextChargeAt);
  const forecast = sub.status === "CANCELLED"
    ? []
    : forecastYmds(sub, startYmd, startYmd < todayYmd ? startYmd : todayYmd, addMonthsClamped(todayYmd, FORECAST_MONTHS))
      .filter((ymd) => !settledKeys.has(ymd))
      .map((ymd) => ({ dueDate: ymd, amountCents: sub.amountCents }));

  res.json({
    subscription: serialize(sub),
    charges: charges.map((c) => ({ ...c, dueDate: ymdOf(c.dueAt) })),
    forecast,
  });
}));

subscriptionsRouter.patch("/:id", validate(schemas.updateSubscriptionSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const current = await ownedSubscription(userId, req.params.id);
  const b = req.body as z.infer<typeof schemas.updateSubscriptionSchema>;
  await Promise.all([assertTagsOwned(userId, b.tagIds ?? []), assertMethodOwned(userId, b.paymentMethodId)]);

  const data: Prisma.SubscriptionUpdateInput = {};
  if (b.name !== undefined) data.name = b.name.trim();
  if (b.vendor !== undefined) data.vendor = b.vendor?.trim() || null;
  if (b.notes !== undefined) data.notes = b.notes ?? null;
  if (b.amountCents !== undefined) data.amountCents = b.amountCents;
  if (b.cycleMonths !== undefined) data.cycleMonths = b.cycleMonths;
  if (b.alertHour !== undefined) data.alertHour = b.alertHour;
  if (b.notifyInApp !== undefined) data.notifyInApp = b.notifyInApp;
  if (b.notifyTelegram !== undefined) data.notifyTelegram = b.notifyTelegram;
  if (b.notifyEmail !== undefined) data.notifyEmail = b.notifyEmail;
  if (b.alertDaysBefore !== undefined) data.alertDaysBefore = normalizeAlertDays(b.alertDaysBefore);
  if (b.paymentMethodId !== undefined) {
    data.paymentMethod = b.paymentMethodId ? { connect: { id: b.paymentMethodId } } : { disconnect: true };
  }
  if (b.tagIds !== undefined) data.tags = { set: b.tagIds.map((id) => ({ id })) };
  if (b.status !== undefined) {
    data.status = b.status;
    data.cancelledAt = b.status === "CANCELLED" ? (current.cancelledAt ?? new Date()) : null;
  }

  // Moving the anchor or the first charge re-bases the series, so the stored
  // next charge has to be recomputed rather than left on the old day.
  const anchorDay = b.anchorDay ?? current.anchorDay;
  if (b.anchorDay !== undefined) data.anchorDay = b.anchorDay;
  if (b.firstChargeDate !== undefined || b.anchorDay !== undefined) {
    const baseYmd = (b.firstChargeDate ?? ymdOf(current.nextChargeAt)).slice(0, 10);
    data.nextChargeAt = chargeDate(chargeYmdFor(Number(baseYmd.slice(0, 4)), Number(baseYmd.slice(5, 7)), anchorDay));
    if (b.firstChargeDate !== undefined) data.startedAt = chargeDate(baseYmd);
  }

  const sub = await prisma.subscription.update({ where: { id: req.params.id }, data, include: subscriptionInclude });
  res.json({ subscription: serialize(sub) });
}));

subscriptionsRouter.delete("/:id", asyncHandler(async (req, res) => {
  await ownedSubscription(req.user!.id, req.params.id);
  // Hard delete, like habits: the trash is for tasks, events and notes. The way
  // to stop paying without losing the history is to cancel.
  await prisma.subscription.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- Charges ----------

subscriptionsRouter.post("/:id/charges", validate(schemas.settleChargeSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const sub = await ownedSubscription(userId, req.params.id);
  const b = req.body as z.infer<typeof schemas.settleChargeSchema>;
  const dueYmd = b.dueDate.slice(0, 10);
  const dueAt = chargeDate(dueYmd);

  const method = sub.paymentMethodId
    ? await prisma.paymentMethod.findFirst({ where: { id: sub.paymentMethodId, userId }, select: { alias: true, last4: true } })
    : null;
  // The label is frozen here on purpose: editing the wallet later must not
  // rewrite what a past charge says it was paid with.
  const methodLabel = methodLabelOf(method);
  const amountCents = b.status === "SKIPPED" ? 0 : (b.amountCents ?? sub.amountCents);
  const paidAt = b.status === "PAID" ? (b.paidAt ? new Date(b.paidAt) : new Date()) : null;

  const charge = await prisma.subscriptionCharge.upsert({
    where: { subscriptionId_dueAt: { subscriptionId: sub.id, dueAt } },
    create: { userId, subscriptionId: sub.id, dueAt, paidAt, amountCents, status: b.status, methodLabel },
    update: { paidAt, amountCents, status: b.status },
  });

  // Only move the series forward when the settled charge is the pending one;
  // backfilling an older month must not skip the upcoming charge.
  let subscription = sub;
  if (sub.status === "ACTIVE" && dueYmd >= ymdOf(sub.nextChargeAt)) {
    subscription = await prisma.subscription.update({
      where: { id: sub.id },
      data: { nextChargeAt: chargeDate(nextChargeYmd(sub, ymdOf(sub.nextChargeAt), dueYmd)) },
    });
  }

  res.status(201).json({ charge: { ...charge, dueDate: ymdOf(charge.dueAt) }, nextChargeDate: ymdOf(subscription.nextChargeAt) });
}));

subscriptionsRouter.delete("/:id/charges/:chargeId", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const sub = await ownedSubscription(userId, req.params.id);
  const charge = await prisma.subscriptionCharge.findFirst({ where: { id: req.params.chargeId, userId, subscriptionId: sub.id } });
  if (!charge) throw ApiError.notFound("El cargo no existe.");
  await prisma.subscriptionCharge.delete({ where: { id: charge.id } });

  // Undoing the most recent settlement puts the pending charge back where it was.
  const dueYmd = ymdOf(charge.dueAt);
  if (sub.status === "ACTIVE" && dueYmd < ymdOf(sub.nextChargeAt)) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { nextChargeAt: chargeDate(dueYmd) } });
  }
  res.json({ ok: true });
}));
