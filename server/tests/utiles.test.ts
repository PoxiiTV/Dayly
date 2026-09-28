import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { occurrenceStarts } from "../src/lib/recurrence.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("ICS feed and recurrence skip", () => {
  it("issues a subscribe URL and serves a public ICS without a session", async () => {
    const { authed } = await registerAndLogin(app, "ics-feed");
    const got = await authed(app).get("/api/calendar/feed-url");
    expect(got.status).toBe(200);
    expect(got.body.url).toMatch(/\/api\/calendar\/feed\/.+\.ics$/);
    const token = String(got.body.url).split("/feed/")[1];

    await authed(app).post("/api/events").send({
      title: "Público",
      startAt: new Date(Date.now() + 3600_000).toISOString(),
      endAt: new Date(Date.now() + 7200_000).toISOString(),
    });

    const ics = await authed(app).get(`/api/calendar/feed/${token}`);
    // even with cookie it should work; also without:
    const { default: request } = await import("supertest");
    const anon = await request(app).get(`/api/calendar/feed/${token}`);
    expect(anon.status).toBe(200);
    expect(String(anon.headers["content-type"])).toMatch(/text\/calendar/);
    expect(anon.text).toContain("BEGIN:VCALENDAR");
    expect(anon.text).toContain("Público");
    expect(ics.status).toBe(200);
  });

  it("hides a skipped occurrence from the calendar range", async () => {
    const { authed } = await registerAndLogin(app, "skip-occ");
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const created = await authed(app).post("/api/events").send({
      title: "Daily stand-up",
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      recurrence: { frequency: "DAILY", interval: 1 },
    });
    expect(created.status).toBe(201);
    const eventId = created.body.event.id;

    const from = new Date(start); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 3 * 86400000);
    const before = await authed(app).get("/api/calendar").query({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    expect(before.status).toBe(200);
    const instances = (before.body.events as { title: string; startAt: string }[]).filter((e) => e.title === "Daily stand-up");
    expect(instances.length).toBeGreaterThan(1);

    const skipAt = instances[1].startAt;
    const skip = await authed(app).post(`/api/events/${eventId}/skip-occurrence`).send({ at: skipAt });
    expect(skip.status).toBe(200);

    const after = await authed(app).get("/api/calendar").query({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    const left = (after.body.events as { title: string; startAt: string }[]).filter((e) => e.title === "Daily stand-up");
    expect(left.some((e) => e.startAt === skipAt)).toBe(false);
    expect(left.length).toBe(instances.length - 1);
  });

  it("filters skip dates in occurrenceStarts", () => {
    const anchor = new Date("2026-08-29T10:00:00.000Z");
    const from = new Date("2026-08-29T00:00:00.000Z");
    const to = new Date("2026-09-02T00:00:00.000Z");
    const all = occurrenceStarts(anchor, { frequency: "DAILY", interval: 1 }, from, to);
    expect(all.length).toBeGreaterThan(1);
    const skipped = occurrenceStarts(anchor, { frequency: "DAILY", interval: 1 }, from, to, [all[1]]);
    expect(skipped.map((d) => d.toISOString())).not.toContain(all[1].toISOString());
    expect(skipped.length).toBe(all.length - 1);
  });
});

describe("Passkeys API", () => {
  it("lists none and issues registration options when logged in", async () => {
    const { authed } = await registerAndLogin(app, "passkeys");
    const list = await authed(app).get("/api/auth/passkeys");
    expect(list.status).toBe(200);
    expect(list.body.passkeys).toEqual([]);
    const opts = await authed(app).post("/api/auth/passkeys/register/options");
    expect(opts.status).toBe(200);
    expect(opts.body.challengeId).toBeTruthy();
    expect(opts.body.options.challenge).toBeTruthy();
    expect(opts.body.options.rp.name).toBeTruthy();
  });

  it("issues discoverable login options without a session", async () => {
    const { default: request } = await import("supertest");
    const r = await request(app).post("/api/auth/passkeys/login/options");
    expect(r.status).toBe(200);
    expect(r.body.challengeId).toBeTruthy();
    expect(r.body.options.challenge).toBeTruthy();
  });
});
