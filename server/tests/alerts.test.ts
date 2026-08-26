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
