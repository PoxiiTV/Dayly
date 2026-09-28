import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import { spansLocalDay } from "../../client/src/lib/dates";
import { calendarColumns } from "../../client/src/lib/calendarLayout";

const db = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
  event: { findMany: vi.fn(), findFirst: vi.fn() },
  task: { findMany: vi.fn() },
}));
vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));
vi.mock("../src/middleware/auth.js", () => ({ requireAuth: ((req, res, next) => {
  if (!req.headers["x-test-user"]) { res.sendStatus(401); return; }
  req.user = { id: String(req.headers["x-test-user"]) } as typeof req.user;
  next();
}) satisfies RequestHandler }));
vi.mock("../src/middleware/audit.js", () => ({ auditMiddleware: () => ((_req, _res, next) => next()) satisfies RequestHandler }));

import { calendarRouter } from "../src/routes/calendar.js";
import { eventsRouter } from "../src/routes/events.js";

const app = express();
app.use("/calendar", calendarRouter);
app.use("/events", eventsRouter);
app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message })) satisfies ErrorRequestHandler);

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ timezone: "Europe/Madrid" });
  db.event.findMany.mockResolvedValue([]);
  db.task.findMany.mockResolvedValue([]);
});

describe("Calendar visibility", () => {
  it("keeps simultaneous events, reminders and more than four tasks accessible", () => {
    const blocks = Array.from({ length: 6 }, (_, index) => ({ key: `task:${index}`, top: 500, height: 30 }));
    const lanes = calendarColumns([...blocks, { key: "event", top: 500, height: 56 }, { key: "reminder", top: 500, height: 30 }, { key: "later", top: 600, height: 30 }]);
    expect(new Set([...lanes].filter(([key]) => key !== "later").map(([, lane]) => lane.column)).size).toBe(8);
    expect(lanes.get("reminder")?.columns).toBe(8);
    expect(lanes.get("later")).toEqual({ column: 0, columns: 1 });
  });

  it("reuses a free column without obscuring a longer event", () => {
    const lanes = calendarColumns([{ key: "long", top: 0, height: 100 }, { key: "first", top: 0, height: 30 }, { key: "second", top: 30, height: 30 }]);
    expect(lanes.get("first")).toEqual(lanes.get("second"));
    expect(lanes.get("long")?.column).not.toBe(lanes.get("second")?.column);
  });
  it("includes a point reminder or task at midnight in its own day", () => {
    const start = new Date(2026, 8, 12, 0, 0);
    expect(spansLocalDay(start, null, "2026-09-12")).toBe(true);
    expect(spansLocalDay(start, start, "2026-09-12")).toBe(true);
    expect(spansLocalDay(start, null, "2026-09-11")).toBe(false);
    expect(spansLocalDay(start, null, "2026-09-13")).toBe(false);
  });

  it("does not include an interval ending at midnight in the next day", () => {
    expect(spansLocalDay(new Date(2026, 8, 11, 23), new Date(2026, 8, 12), "2026-09-12")).toBe(false);
  });

  it("preserves ISO range boundaries and returns early appointments", async () => {
    const early = { id: "early", title: "Early event", startAt: new Date("2026-09-11T22:15:00Z"), endAt: new Date("2026-09-11T22:45:00Z") };
    db.event.findMany.mockResolvedValue([early]);
    const from = "2026-09-11T22:00:00.000Z", to = "2026-09-12T21:59:59.999Z";
    const response = await request(app).get("/calendar").set("x-test-user", "owner").query({ from, to });
    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(db.event.findMany.mock.calls[0][0].where).toMatchObject({ userId: "owner", OR: [{ recurrenceId: null, endAt: { gte: new Date(from) }, startAt: { lte: new Date(to) } }, { recurrenceId: { not: null } }] });
  });

  it("interprets date-only ranges in the account timezone", async () => {
    await request(app).get("/calendar").set("x-test-user", "owner").query({ from: "2026-09-12", to: "2026-09-12" }).expect(200);
    const range = db.event.findMany.mock.calls[0][0].where.OR[0];
    expect(range.endAt.gte.toISOString()).toBe("2026-09-11T22:00:00.000Z");
    expect(range.startAt.lte.toISOString()).toBe("2026-09-12T21:59:59.999Z");
  });
});

describe("Calendar event details", () => {
  it("loads the canonical event with an ownership and soft-delete filter", async () => {
    db.event.findFirst.mockResolvedValue({ id: "event1", title: "Original series", startAt: "2026-08-01T09:00:00Z", recurrence: { frequency: "WEEKLY" } });
    const response = await request(app).get("/events/event1").set("x-test-user", "owner").expect(200);
    expect(response.body.event.startAt).toBe("2026-08-01T09:00:00Z");
    expect(db.event.findFirst.mock.calls[0][0].where).toEqual({ id: "event1", userId: "owner", deletedAt: null });
  });

  it("does not return a missing or another user's event", async () => {
    db.event.findFirst.mockResolvedValue(null);
    await request(app).get("/events/other-event").set("x-test-user", "owner").expect(404);
    expect(db.event.findFirst.mock.calls[0][0].where.userId).toBe("owner");
  });

  it("requires a session before loading event details", async () => {
    await request(app).get("/events/event1").expect(401);
    expect(db.event.findFirst).not.toHaveBeenCalled();
  });
});
