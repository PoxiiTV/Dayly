import { randomUUID } from "node:crypto";
import type { Express } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveTelegramPlatformSettings } from "../src/lib/integrationSettings.js";
import { prisma } from "../src/lib/prisma.js";
import { adminCookie, makeApp, registerAndLogin } from "./helpers.js";

let app: Express;
let admin: string;
let telegramWasEnabled = false;

beforeAll(async () => {
  app = await makeApp();
  admin = await adminCookie(app);
  telegramWasEnabled = Boolean((await prisma.telegramSetting.findUnique({ where: { id: 1 } }))?.enabled);
  await saveTelegramPlatformSettings({ enabled: false });
  await prisma.googleOAuthSetting.upsert({ where: { id: 1 }, create: { id: 1, enabled: false, clientId: "" }, update: { enabled: false } });
  await prisma.integrationVisibility.deleteMany({});
});

afterAll(async () => {
  await prisma.integrationVisibility.deleteMany({});
  await saveTelegramPlatformSettings({ enabled: telegramWasEnabled });
});

describe("integration visibility", () => {
  it("announces unavailable integrations as coming soon by default and lets the admin hide them", async () => {
    const user = await registerAndLogin(app, `vis-${randomUUID()}`);
    const initial = await user.authed(app).get("/api/integrations");
    expect(initial.status).toBe(200);
    expect(initial.headers["cache-control"]).toContain("no-store");
    expect(initial.body.integrations).toMatchObject({ telegram: "COMING_SOON", gmailGoogle: "COMING_SOON" });

    const hidden = await supertest(app).patch("/api/admin/integration-visibility").set("Cookie", admin).send({ telegram: "HIDDEN", gmailGoogle: "HIDDEN" });
    expect(hidden.status).toBe(200);
    expect(hidden.body.visibility).toMatchObject({ telegram: "HIDDEN", gmailGoogle: "HIDDEN", whatsapp: "COMING_SOON" });
    expect((await user.authed(app).get("/api/integrations")).body.integrations).toMatchObject({ telegram: "HIDDEN", gmailGoogle: "HIDDEN" });

    // Enabling the integration makes it visible whatever the placeholder choice.
    await saveTelegramPlatformSettings({ enabled: true });
    expect((await user.authed(app).get("/api/integrations")).body.integrations.telegram).toBe("AVAILABLE");
    await saveTelegramPlatformSettings({ enabled: false });
    expect((await user.authed(app).get("/api/integrations")).body.integrations.telegram).toBe("HIDDEN");
  });

  it("denies the visibility settings to anonymous and regular users and rejects bad values", async () => {
    const user = await registerAndLogin(app, `vis-deny-${randomUUID()}`);
    expect((await supertest(app).get("/api/integrations")).status).toBe(401);
    expect((await user.authed(app).get("/api/admin/integration-visibility")).status).toBe(403);
    expect((await user.authed(app).patch("/api/admin/integration-visibility").send({ telegram: "HIDDEN" })).status).toBe(403);
    const bad = await supertest(app).patch("/api/admin/integration-visibility").set("Cookie", admin).send({ telegram: "VISIBLE" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const unknown = await supertest(app).patch("/api/admin/integration-visibility").set("Cookie", admin).send({ spotify: "HIDDEN" });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(unknown.status).toBeLessThan(500);
  });

  it("blocks new Telegram setup while the admin keeps it off", async () => {
    const user = await registerAndLogin(app, `vis-tg-${randomUUID()}`);
    const bot = await user.authed(app).put("/api/telegram/bot").send({ token: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" });
    expect(bot.status).toBe(409);
    expect((await user.authed(app).post("/api/telegram/link")).status).toBe(409);
    expect((await user.authed(app).post("/api/telegram/bot/webhook").send({})).status).toBe(409);
    expect((await user.authed(app).get("/api/telegram/status")).status).toBe(200);
  });
});
