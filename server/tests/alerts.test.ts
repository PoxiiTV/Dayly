import { describe, it, expect, beforeAll } from "vitest";
import { authenticator } from "otplib";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("2FA recovery + alerts + recurrence", () => {
  it("accepts a recovery code at login and consumes it", async () => {
    const { authed, email, password } = await registerAndLogin(app, "tfa");
    const setup = await authed(app).post("/api/auth/2fa/setup").send({ currentPassword: password });
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect(setup.body.url).toMatch(/^otpauth:\/\//);
    expect(setup.body.qr).toBeUndefined();
    const totp = authenticator.generate(secret);
    const en = await authed(app).post("/api/auth/2fa/enable").send({ code: totp });
    expect(en.status).toBe(200);
    const codes = en.body.recoveryCodes as string[];
    expect(codes.length).toBeGreaterThan(3);

    await authed(app).post("/api/auth/logout");
    const bad = await (await import("supertest")).default(app).post("/api/auth/login").send({ email, password });
    expect(bad.status).toBe(401);

    const supertest = (await import("supertest")).default;
    const withCode = await supertest(app).post("/api/auth/login").send({ email, password, twoFactorCode: codes[0] });
    expect(withCode.status).toBe(200);

    await supertest(app).post("/api/auth/logout").set("Cookie", (withCode.headers["set-cookie"] as string[])[0]);
    const reuse = await supertest(app).post("/api/auth/login").send({ email, password, twoFactorCode: codes[0] });
    expect(reuse.status).toBe(401);
  });

  it("ticks a due reminder into notifications once", async () => {
    const { authed } = await registerAndLogin(app, "alrt");
    const at = new Date(Date.now() - 60_000).toISOString();
    const cr = await authed(app).post("/api/reminders").send({ title: "Beber agua", remindAt: at });
    expect(cr.status).toBe(201);
    const t1 = await authed(app).post("/api/alerts/tick");
    expect(t1.status).toBe(200);
    expect(t1.body.fired.some((f: { title: string }) => f.title === "Beber agua")).toBe(true);
    const t2 = await authed(app).post("/api/alerts/tick");
    expect(t2.body.fired.some((f: { title: string }) => f.title === "Beber agua")).toBe(false);
    const n = await authed(app).get("/api/notifications");
    expect(n.body.notifications.some((x: { title: string }) => x.title === "Beber agua")).toBe(true);
  });

  it("alerts timed tasks at their start and ignores untimed or future tasks", async () => {
    const { authed } = await registerAndLogin(app, "task-timing");
    const now = Date.now();
    const past = new Date(now - 60_000).toISOString();
    const future = new Date(now + 60 * 60_000).toISOString();
    const timed = await authed(app).post("/api/tasks").send({ title: "Empieza ya", dueDate: past, hasTime: true });
    const untimed = await authed(app).post("/api/tasks").send({ title: "Sin hora", dueDate: past, hasTime: false });
    const upcoming = await authed(app).post("/api/tasks").send({ title: "Más tarde", dueDate: future, hasTime: true });
    expect(timed.status).toBe(201);
    expect(untimed.status).toBe(201);
    expect(upcoming.status).toBe(201);

    const tick = await authed(app).post("/api/alerts/tick");
    expect(tick.status).toBe(200);
    expect(tick.body.fired).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Empieza ya", body: "Empieza ahora.", taskId: timed.body.task.id }),
    ]));
    expect(tick.body.fired.some((f: { title: string }) => f.title === "Sin hora")).toBe(false);
    expect(tick.body.fired.some((f: { title: string }) => f.title === "Más tarde")).toBe(false);
  });

  it("deduplicates a task occurrence and snoozes it by ten minutes", async () => {
    const { authed } = await registerAndLogin(app, "task-snooze");
    const due = new Date(Date.now() - 60_000).toISOString();
    const created = await authed(app).post("/api/tasks").send({ title: "Posponerme", dueDate: due, hasTime: true });
    expect(created.status).toBe(201);

    const first = await authed(app).post("/api/alerts/tick");
    const alert = first.body.fired.find((f: { title: string }) => f.title === "Posponerme");
    expect(alert).toEqual(expect.objectContaining({ taskId: created.body.task.id }));
    const second = await authed(app).post("/api/alerts/tick");
    expect(second.body.fired.some((f: { title: string }) => f.title === "Posponerme")).toBe(false);

    const snoozed = await authed(app).post(`/api/tasks/${created.body.task.id}/snooze`).send({ minutes: 10, occurrenceAt: alert.occurrenceAt });
    expect(snoozed.status).toBe(200);
    expect(new Date(snoozed.body.task.dueDate).getTime() - new Date(due).getTime()).toBe(10 * 60_000);
    expect((await authed(app).post(`/api/tasks/${created.body.task.id}/snooze`).send({ minutes: 5 })).status).toBe(422);
    const other = await registerAndLogin(app, "task-snooze-other");
    expect((await other.authed(app).post(`/api/tasks/${created.body.task.id}/snooze`).send({ minutes: 10 })).status).toBe(404);
  });

  it("snoozes only the current occurrence of a recurring task", async () => {
    const { authed } = await registerAndLogin(app, "task-recurring-snooze");
    const due = new Date(Date.now() - 60_000).toISOString();
    const created = await authed(app).post("/api/tasks").send({
      title: "Serie posponible",
      dueDate: due,
      hasTime: true,
      recurrence: { frequency: "DAILY", interval: 1 },
    });
    expect(created.status).toBe(201);
    const tick = await authed(app).post("/api/alerts/tick");
    const alert = tick.body.fired.find((f: { title: string }) => f.title === "Serie posponible");
    expect(alert).toEqual(expect.objectContaining({ taskId: created.body.task.id }));

    const snoozed = await authed(app).post(`/api/tasks/${created.body.task.id}/snooze`).send({ minutes: 10, occurrenceAt: alert.occurrenceAt });
    expect(snoozed.status).toBe(200);
    expect(new Date(snoozed.body.task.dueDate).getTime()).toBe(new Date(due).getTime());
  });

  it("expands a weekly event on the calendar", async () => {
    const { authed } = await registerAndLogin(app, "rec");
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    const cr = await authed(app).post("/api/events").send({
      title: "Standup",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      recurrence: { frequency: "WEEKLY", interval: 1 },
    });
    expect(cr.status).toBe(201);
    const from = new Date(start); from.setDate(from.getDate() - 1);
    const to = new Date(start); to.setDate(to.getDate() + 21);
    const cal = await authed(app).get("/api/calendar").query({ from: from.toISOString(), to: to.toISOString() });
    expect(cal.status).toBe(200);
    const standups = cal.body.events.filter((e: { title: string }) => e.title === "Standup");
    expect(standups.length).toBeGreaterThanOrEqual(3);
  });
});
