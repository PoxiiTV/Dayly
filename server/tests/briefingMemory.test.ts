import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { runBriefingTick } from "../src/lib/briefing.js";
import { runMascotTool } from "../src/lib/mascot/tools.js";
import { buildDayContext } from "../src/lib/mascot/context.js";

let app: Express;

beforeAll(async () => {
  // No weather or Telegram traffic from tests.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  app = await makeApp();
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("morning briefing", () => {
  it("saves settings, rejects odd hours and sends a test to the bell", async () => {
    const { authed, userId } = await registerAndLogin(app, "brief");
    const initial = await authed(app).get("/api/briefing/settings");
    expect(initial.body.settings).toEqual({ enabled: false, hour: 8, telegramReady: false });

    const saved = await authed(app).patch("/api/briefing/settings").send({ enabled: true, hour: 7 });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ enabled: true, hour: 7 });
    expect((await authed(app).patch("/api/briefing/settings").send({ hour: 3 })).status).toBe(422);

    await prisma.task.create({ data: { userId, title: "Pagar el alquiler", dueDate: new Date(Date.now() - 3 * 86400000) } });
    const test = await authed(app).post("/api/briefing/test");
    expect(test.body).toMatchObject({ ok: true, telegram: false });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId, type: "BRIEFING" } });
    expect(n.body).toContain("Pagar el alquiler");
  });

  it("the tick sends once per local day at the chosen hour", async () => {
    const { userId } = await registerAndLogin(app, "tick");
    const now = new Date("2026-09-28T06:30:00Z"); // 08:30 in Madrid
    await prisma.user.update({ where: { id: userId }, data: { timezone: "Europe/Madrid", briefingEnabled: true, briefingHour: 8 } });
    await runBriefingTick(now);
    await runBriefingTick(new Date(now.getTime() + 60_000));
    expect(await prisma.notification.count({ where: { userId, type: "BRIEFING" } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).briefingLastKey).toBe("2026-09-28");
  });
});

describe("Calen memory and day context", () => {
  it("remembers facts, updates them and finds agenda items", async () => {
    const { userId } = await registerAndLogin(app, "memory");
    expect(await runMascotTool(userId, "Europe/Madrid", "memory_set", { key: "café", value: "solo, sin azúcar" })).toMatch(/^OK id=café/);
    await runMascotTool(userId, "Europe/Madrid", "memory_set", { key: "café", value: "con leche de avena" });
    expect(await runMascotTool(userId, "Europe/Madrid", "memory_get", {})).toBe("café: con leche de avena");
    expect(await runMascotTool(userId, "Europe/Madrid", "memory_set", { key: "", value: "x" })).toMatch(/^NO_OK/);

    const task = await prisma.task.create({ data: { userId, title: "Llamar al dentista", dueDate: new Date() } });
    expect(await runMascotTool(userId, "Europe/Madrid", "search_agenda", { query: "dentista" })).toContain(`id=${task.id}`);
    expect(await buildDayContext(userId, "Europe/Madrid")).toContain("Llamar al dentista");
  });
});
