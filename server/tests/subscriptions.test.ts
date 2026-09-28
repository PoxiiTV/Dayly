import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin, type Authed } from "./helpers.js";
import {
  addMonthsClamped,
  alertMoment,
  forecastYmds,
  monthlyCostCents,
  nextChargeYmd,
  normalizeAlertDays,
} from "../src/lib/subscriptions.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

const TZ = "Europe/Madrid";

async function newSubscription(authed: Authed, body: Record<string, unknown> = {}) {
  const r = await authed(app).post("/api/subscriptions").send({
    name: "Netflix",
    amountCents: 1299,
    cycleMonths: 1,
    anchorDay: 15,
    firstChargeDate: "2026-10-15",
    ...body,
  });
  return r;
}

describe("subscriptions — date math", () => {
  it("clamps 29-31 to the last day of a short month", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("recovers the anchor day after a short month instead of dragging it", () => {
    const spec = { anchorDay: 31, cycleMonths: 1 };
    // From the clamped February charge, March must go back to the 31st.
    expect(nextChargeYmd(spec, "2026-02-28", "2026-02-28")).toBe("2026-03-31");
    expect(nextChargeYmd(spec, "2026-03-31", "2026-03-31")).toBe("2026-04-30");
    expect(nextChargeYmd(spec, "2026-04-30", "2026-04-30")).toBe("2026-05-31");
  });

  it("keeps the phase of a multi-month cycle", () => {
    const spec = { anchorDay: 15, cycleMonths: 3 };
    expect(nextChargeYmd(spec, "2026-01-15", "2026-01-15")).toBe("2026-04-15");
    expect(forecastYmds(spec, "2026-01-15", "2026-01-01", "2026-12-31"))
      .toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  });

  it("fires at the configured local hour on both sides of the DST switch", () => {
    // Spain: CEST (UTC+2) in July, CET (UTC+1) in December.
    expect(alertMoment("2026-07-10", 0, 9, TZ).toISOString()).toBe("2026-07-10T07:00:00.000Z");
    expect(alertMoment("2026-12-10", 0, 9, TZ).toISOString()).toBe("2026-12-10T08:00:00.000Z");
    // 7 days before crossing the October switch keeps the local hour.
    expect(alertMoment("2026-11-01", 7, 9, TZ).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("normalises the alert rules to at most three sane values", () => {
    expect(normalizeAlertDays([7, 1, 0])).toEqual([7, 1, 0]);
    expect(normalizeAlertDays([1, 7, 1, 0])).toEqual([7, 1, 0]);
    expect(normalizeAlertDays([90, -3, "2", 5])).toEqual([5, 2]);
    expect(normalizeAlertDays([30, 14, 7, 3, 1])).toEqual([30, 14, 7]);
    expect(normalizeAlertDays("nope")).toEqual([]);
  });

  it("spreads every cycle over a month without losing cents", () => {
    expect(monthlyCostCents([{ amountCents: 1299, cycleMonths: 1 }])).toBe(1299);
    expect(monthlyCostCents([{ amountCents: 12000, cycleMonths: 12 }])).toBe(1000);
    expect(monthlyCostCents([
      { amountCents: 1299, cycleMonths: 1 },
      { amountCents: 3000, cycleMonths: 3 },
      { amountCents: 9900, cycleMonths: 12 },
    ])).toBe(1299 + 1000 + 825);
  });
});

describe("subscriptions — authorisation", () => {
  it("answers 404, never 403, for another user's rows", async () => {
    const mine = await registerAndLogin(app, "subown1");
    const other = await registerAndLogin(app, "subown2");
    const created = await newSubscription(mine.authed);
    expect(created.status).toBe(201);
    const id = created.body.subscription.id as string;

    expect((await other.authed(app).get(`/api/subscriptions/${id}`)).status).toBe(404);
    expect((await other.authed(app).patch(`/api/subscriptions/${id}`).send({ name: "hack" })).status).toBe(404);
    expect((await other.authed(app).delete(`/api/subscriptions/${id}`)).status).toBe(404);
    expect((await other.authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-10-15", status: "PAID" })).status).toBe(404);
    expect((await other.authed(app).get("/api/subscriptions")).body.subscriptions).toHaveLength(0);
  });

  it("refuses a payment method or tag belonging to somebody else", async () => {
    const mine = await registerAndLogin(app, "subrel1");
    const other = await registerAndLogin(app, "subrel2");
    const method = await other.authed(app).post("/api/subscriptions/methods").send({ alias: "Suya", kind: "CARD" });
    expect(method.status).toBe(201);
    const bad = await newSubscription(mine.authed, { paymentMethodId: method.body.method.id });
    expect(bad.status).toBe(400);
  });

  it("refuses a task tag: the two vocabularies are separate", async () => {
    const { authed } = await registerAndLogin(app, "subtagmix");
    const taskTag = await authed(app).post("/api/tags").send({ name: "Trabajo" });
    expect(taskTag.status).toBe(201);
    // Same user, but a tag from the other vocabulary must not attach.
    const bad = await newSubscription(authed, { tagIds: [taskTag.body.tag.id] });
    expect(bad.status).toBe(400);

    const own = await authed(app).post("/api/subscriptions/tags").send({ name: "Ocio", color: "#ec4899" });
    expect(own.status).toBe(201);
    const good = await newSubscription(authed, { tagIds: [own.body.tag.id] });
    expect(good.status).toBe(201);
    expect(good.body.subscription.tags).toHaveLength(1);
    expect(good.body.subscription.tags[0].name).toBe("Ocio");

    // The lists stay apart in both directions.
    const subTags = await authed(app).get("/api/subscriptions/tags");
    expect(subTags.body.tags.map((t: { name: string }) => t.name)).toEqual(["Ocio"]);
    const taskTags = await authed(app).get("/api/tags");
    expect(taskTags.body.tags.map((t: { name: string }) => t.name)).toEqual(["Trabajo"]);
  });

  it("requires a session", async () => {
    const supertest = (await import("supertest")).default;
    expect((await supertest(app).get("/api/subscriptions")).status).toBe(401);
  });
});

describe("subscriptions — validation", () => {
  it("rejects bad amounts, cycles and alert rules", async () => {
    const { authed } = await registerAndLogin(app, "subval");
    expect((await newSubscription(authed, { amountCents: 0 })).status).toBe(422);
    expect((await newSubscription(authed, { amountCents: -500 })).status).toBe(422);
    expect((await newSubscription(authed, { amountCents: 12.5 })).status).toBe(422);
    expect((await newSubscription(authed, { cycleMonths: 0 })).status).toBe(422);
    expect((await newSubscription(authed, { cycleMonths: 48 })).status).toBe(422);
    expect((await newSubscription(authed, { anchorDay: 32 })).status).toBe(422);
    expect((await newSubscription(authed, { alertHour: 24 })).status).toBe(422);
    expect((await newSubscription(authed, { alertDaysBefore: [30, 14, 7, 1] })).status).toBe(422);
  });

  it("keeps card numbers out of the wallet", async () => {
    const { authed } = await registerAndLogin(app, "subcard");
    const pan = await authed(app).post("/api/subscriptions/methods").send({ alias: "4111 1111 1111 1111", kind: "CARD" });
    expect(pan.status).toBe(422);
    const badLast4 = await authed(app).post("/api/subscriptions/methods").send({ alias: "Visa", last4: "12345" });
    expect(badLast4.status).toBe(422);
    const ok = await authed(app).post("/api/subscriptions/methods").send({ alias: "Visa nómina", kind: "CARD", last4: "4242" });
    expect(ok.status).toBe(201);
    expect(ok.body.method.last4).toBe("4242");
    const dup = await authed(app).post("/api/subscriptions/methods").send({ alias: "Visa nómina" });
    expect(dup.status).toBe(409);
  });
});

describe("subscriptions — own tags", () => {
  it("creates, renames and refuses duplicates", async () => {
    const { authed } = await registerAndLogin(app, "subtagcrud");
    const created = await authed(app).post("/api/subscriptions/tags").send({ name: "Seguros", color: "#10b981" });
    expect(created.status).toBe(201);
    const id = created.body.tag.id as string;

    expect((await authed(app).post("/api/subscriptions/tags").send({ name: "Seguros" })).status).toBe(409);
    expect((await authed(app).post("/api/subscriptions/tags").send({ name: "" })).status).toBe(422);

    const renamed = await authed(app).patch(`/api/subscriptions/tags/${id}`).send({ name: "Hogar y seguros" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.tag.name).toBe("Hogar y seguros");
  });

  it("deleting a tag removes the label but keeps the subscription", async () => {
    const { authed } = await registerAndLogin(app, "subtagdel");
    const tag = await authed(app).post("/api/subscriptions/tags").send({ name: "Ocio" });
    const created = await newSubscription(authed, { tagIds: [tag.body.tag.id] });
    const id = created.body.subscription.id as string;

    expect((await authed(app).delete(`/api/subscriptions/tags/${tag.body.tag.id}`)).status).toBe(200);
    const after = await authed(app).get(`/api/subscriptions/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.subscription.tags).toHaveLength(0);
  });

  it("answers 404 for another user's tag", async () => {
    const mine = await registerAndLogin(app, "subtagown1");
    const other = await registerAndLogin(app, "subtagown2");
    const tag = await mine.authed(app).post("/api/subscriptions/tags").send({ name: "Privada" });
    const id = tag.body.tag.id as string;
    expect((await other.authed(app).patch(`/api/subscriptions/tags/${id}`).send({ name: "hack" })).status).toBe(404);
    expect((await other.authed(app).delete(`/api/subscriptions/tags/${id}`)).status).toBe(404);
    expect((await other.authed(app).get("/api/subscriptions/tags")).body.tags).toHaveLength(0);
    // And it cannot be borrowed for a subscription either.
    expect((await newSubscription(other.authed, { tagIds: [id] })).status).toBe(400);
  });
});

describe("subscriptions — charges and history", () => {
  it("settles a charge once, advances the series and survives a repeat", async () => {
    const { authed } = await registerAndLogin(app, "subchg");
    const created = await newSubscription(authed, { anchorDay: 31, firstChargeDate: "2026-01-31" });
    const id = created.body.subscription.id as string;
    expect(created.body.subscription.nextChargeDate).toBe("2026-01-31");

    const first = await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-01-31", status: "PAID" });
    expect(first.status).toBe(201);
    expect(first.body.nextChargeDate).toBe("2026-02-28");

    // Same day again: idempotent, no second row and no second jump.
    const again = await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-01-31", status: "PAID" });
    expect(again.status).toBe(201);
    expect(again.body.nextChargeDate).toBe("2026-02-28");

    const feb = await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-02-28", status: "PAID" });
    expect(feb.body.nextChargeDate).toBe("2026-03-31"); // anchor recovered

    const detail = await authed(app).get(`/api/subscriptions/${id}`);
    expect(detail.body.charges).toHaveLength(2);
  });

  it("stores the adjusted amount and freezes the payment method label", async () => {
    const { authed } = await registerAndLogin(app, "subfreeze");
    const method = await authed(app).post("/api/subscriptions/methods").send({ alias: "Cuenta nómina", kind: "ACCOUNT", last4: "7788" });
    const methodId = method.body.method.id as string;
    const created = await newSubscription(authed, { paymentMethodId: methodId });
    const id = created.body.subscription.id as string;

    const charge = await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-10-15", status: "PAID", amountCents: 1499 });
    expect(charge.body.charge.amountCents).toBe(1499);
    expect(charge.body.charge.methodLabel).toBe("Cuenta nómina ····7788");

    await authed(app).patch(`/api/subscriptions/methods/${methodId}`).send({ alias: "Otra cuenta", last4: "0001" });
    const detail = await authed(app).get(`/api/subscriptions/${id}`);
    expect(detail.body.charges[0].methodLabel).toBe("Cuenta nómina ····7788");
  });

  it("archives a payment method still referenced instead of deleting it", async () => {
    const { authed } = await registerAndLogin(app, "subarch");
    const used = await authed(app).post("/api/subscriptions/methods").send({ alias: "En uso" });
    const unused = await authed(app).post("/api/subscriptions/methods").send({ alias: "Sin usar" });
    await newSubscription(authed, { paymentMethodId: used.body.method.id });

    const archived = await authed(app).delete(`/api/subscriptions/methods/${used.body.method.id}`);
    expect(archived.body.archived).toBe(true);
    const dropped = await authed(app).delete(`/api/subscriptions/methods/${unused.body.method.id}`);
    expect(dropped.body.archived).toBe(false);

    const methods = await authed(app).get("/api/subscriptions/methods");
    expect(methods.body.methods).toHaveLength(1);
    expect(methods.body.methods[0].archivedAt).not.toBeNull();
  });

  it("keeps an overdue charge on the list so it can still be confirmed", async () => {
    const { authed } = await registerAndLogin(app, "subdue");
    const year = new Date().getFullYear() - 1;
    const created = await newSubscription(authed, { anchorDay: 10, firstChargeDate: `${year}-11-10` });
    const id = created.body.subscription.id as string;

    const detail = await authed(app).get(`/api/subscriptions/${id}`);
    // The pending charge is months old; it must be the first thing offered.
    expect(detail.body.forecast[0].dueDate).toBe(`${year}-11-10`);

    const summary = await authed(app).get("/api/subscriptions/summary");
    expect(summary.body.upcoming.some((u: { dueDate: string }) => u.dueDate === `${year}-11-10`)).toBe(true);
  });

  it("undoing a settlement puts the pending charge back", async () => {
    const { authed } = await registerAndLogin(app, "subundo");
    const created = await newSubscription(authed);
    const id = created.body.subscription.id as string;
    const charge = await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: "2026-10-15", status: "PAID" });
    expect(charge.body.nextChargeDate).toBe("2026-11-15");
    await authed(app).delete(`/api/subscriptions/${id}/charges/${charge.body.charge.id}`);
    const detail = await authed(app).get(`/api/subscriptions/${id}`);
    expect(detail.body.subscription.nextChargeDate).toBe("2026-10-15");
    expect(detail.body.charges).toHaveLength(0);
  });
});

describe("subscriptions — summary", () => {
  it("separates real spending from the forecast", async () => {
    const { authed } = await registerAndLogin(app, "subsum");
    const past = new Date();
    const pastYmd = `${past.getFullYear()}-01-10`;
    await newSubscription(authed, { name: "Mensual", amountCents: 1000, cycleMonths: 1, anchorDay: 10, firstChargeDate: pastYmd });
    await newSubscription(authed, { name: "Anual", amountCents: 12000, cycleMonths: 12, anchorDay: 10, firstChargeDate: pastYmd });
    await newSubscription(authed, { name: "Cancelada", amountCents: 9900, cycleMonths: 1, anchorDay: 10, firstChargeDate: pastYmd, status: "CANCELLED" });

    const summary = await authed(app).get("/api/subscriptions/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.counts).toMatchObject({ active: 2, cancelled: 1 });
    // Only the two active ones count: 10,00 € + 120,00 €/12.
    expect(summary.body.monthlyCents).toBe(2000);
    expect(summary.body.yearlyProjectionCents).toBe(24000);
    // Nothing confirmed yet, so real spending is zero while the forecast is not.
    expect(summary.body.paidThisYearCents).toBe(0);
    expect(summary.body.next3MonthsCents).toBeGreaterThan(0);
  });

  it("counts a confirmed charge as real spending", async () => {
    const { authed } = await registerAndLogin(app, "subreal");
    const year = new Date().getFullYear();
    const created = await newSubscription(authed, { amountCents: 2500, anchorDay: 10, firstChargeDate: `${year}-01-10` });
    const id = created.body.subscription.id as string;
    await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: `${year}-01-10`, status: "PAID" });
    await authed(app).post(`/api/subscriptions/${id}/charges`).send({ dueDate: `${year}-02-10`, status: "SKIPPED" });

    const summary = await authed(app).get("/api/subscriptions/summary");
    // The skipped month adds nothing: it was never paid.
    expect(summary.body.paidThisYearCents).toBe(2500);
  });
});

describe("subscriptions — alerts", () => {
  it("fires once per charge and rule, even on concurrent ticks", async () => {
    const { authed } = await registerAndLogin(app, "subalert");
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const created = await newSubscription(authed, {
      name: "Seguro hogar",
      amountCents: 4500,
      anchorDay: today.getDate(),
      firstChargeDate: ymd,
      alertHour: 0,
      alertDaysBefore: [0],
    });
    const id = created.body.subscription.id as string;

    const [a, b] = await Promise.all([
      authed(app).post("/api/alerts/tick"),
      authed(app).post("/api/alerts/tick"),
    ]);
    const fired = [...(a.body.fired ?? []), ...(b.body.fired ?? [])]
      .filter((f: { actionUrl: string }) => f.actionUrl.includes(id));
    expect(fired).toHaveLength(1);
    expect(fired[0].actionUrl).toBe(`/subscriptions?s=${id}&c=${ymd}`);
    expect(fired[0].title).toContain("Seguro hogar");

    // A third tick adds nothing.
    const third = await authed(app).post("/api/alerts/tick");
    expect((third.body.fired ?? []).filter((f: { actionUrl: string }) => f.actionUrl.includes(id))).toHaveLength(0);
  });

  it("stays quiet for a subscription with in-app alerts off and no channel set up", async () => {
    const { authed } = await registerAndLogin(app, "subquiet");
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const created = await newSubscription(authed, {
      anchorDay: today.getDate(),
      firstChargeDate: ymd,
      alertHour: 0,
      alertDaysBefore: [0],
      notifyInApp: false,
      // Neither Telegram nor a mailbox is connected: this must not throw.
      notifyTelegram: true,
      notifyEmail: true,
    });
    const id = created.body.subscription.id as string;
    const tick = await authed(app).post("/api/alerts/tick");
    expect(tick.status).toBe(200);
    expect((tick.body.fired ?? []).filter((f: { actionUrl: string }) => f.actionUrl.includes(id))).toHaveLength(0);
  });

  it("does not warn about a paused subscription", async () => {
    const { authed } = await registerAndLogin(app, "subpause");
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const created = await newSubscription(authed, {
      anchorDay: today.getDate(), firstChargeDate: ymd, alertHour: 0, alertDaysBefore: [0], status: "PAUSED",
    });
    const id = created.body.subscription.id as string;
    const tick = await authed(app).post("/api/alerts/tick");
    expect((tick.body.fired ?? []).filter((f: { actionUrl: string }) => f.actionUrl.includes(id))).toHaveLength(0);
  });
});
