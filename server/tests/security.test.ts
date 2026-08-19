import { describe, it, expect, beforeAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin, adminCookie, createTask, createEvent, Authed } from "./helpers.js";

let app: Express;
let adminPtr = "";
beforeAll(async () => {
  app = await makeApp();
  adminPtr = await adminCookie(app);
});

describe("Multi-user isolation (IDOR / BOLA)", () => {
  it("User B cannot read/update/delete User A's task (404, not data leak)", async () => {
    const a = await registerAndLogin(app, "isa");
    const b = await registerAndLogin(app, "isb");
    const task = await createTask(a.authed, app, "El secreto de A");
    const scope: Authed = b.authed;

    expect((await scope(app).get(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await scope(app).patch(`/api/tasks/${task.id}`).send({ title: "hack" })).status).toBe(404);
    expect((await scope(app).delete(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await scope(app).post(`/api/tasks/${task.id}/complete`)).status).toBe(404);
    // A's task is untouched by B's attempts
    const owned = await a.authed(app).get(`/api/tasks/${task.id}`);
    expect(owned.status).toBe(200);
    expect(owned.body.task.title).toBe("El secreto de A");
  });

  it("User B cannot access User A's event", async () => {
    const a = await registerAndLogin(app, "evta");
    const b = await registerAndLogin(app, "evtb");
    const ev = await createEvent(a.authed, app, "Reunión privada de A");
    const r = await b.authed(app).get(`/api/events`).query({ from: "2000-01-01", to: "2100-01-01" });
    const titles = r.body.events.map((e: { id: string; title: string }) => e.title);
    expect(titles).not.toContain("Reunión privada de A");
    expect((await b.authed(app).patch(`/api/events/${ev.id}`).send({ title: "x" })).status).toBe(404);
  });

  it("listing never returns another user's tasks", async () => {
    const a = await registerAndLogin(app, "lsta");
    const b = await registerAndLogin(app, "lstb");
    await createTask(a.authed, app, "Tarea invisible para B");
    const listB = await b.authed(app).get("/api/tasks");
    const titles = listB.body.tasks.map((t: { title: string }) => t.title);
    expect(titles).not.toContain("Tarea invisible para B");
  });

  it("cannot attach another user's project/tag to a task", async () => {
    const a = await registerAndLogin(app, "proja");
    const b = await registerAndLogin(app, "projb");
    const proj = await a.authed(app).post("/api/projects").send({ name: "Proyecto de A" });
    const projId = proj.body.project.id;
    const r = await b.authed(app).post("/api/tasks").send({ title: "usando proyecto ajeno", projectId: projId });
    expect(r.status).toBe(400); // project ownership rejected
  });
});

describe("RBAC / Admin", () => {
  it("normal user gets 403 on /api/admin/*", async () => {
    const u = await registerAndLogin(app, "rbac");
    expect((await u.authed(app).get("/api/admin/stats")).status).toBe(403);
    expect((await u.authed(app).get("/api/admin/users")).status).toBe(403);
  });

  it("admin can access admin endpoints", async () => {
    const r = await supertest(app).get("/api/admin/stats").set("Cookie", adminPtr);
    expect(r.status).toBe(200);
    expect(r.body.stats).toBeDefined();
  });

  it("admin listing never exposes password hashes", async () => {
    const r = await supertest(app).get("/api/admin/users").set("Cookie", adminPtr);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("passwordHash");
  });

  it("admin create user returns 201 and never echoes the password", async () => {
    const email = `admin-create-${Date.now()}@dayly.test`;
    const password = "TempPassw0rd99";
    const r = await supertest(app).post("/api/admin/users").set("Cookie", adminPtr).send({
      name: "Invitado",
      email,
      password,
      role: "USER",
    });
    expect(r.status).toBe(201);
    expect(r.body.user.email).toBe(email);
    expect(JSON.stringify(r.body)).not.toContain(password);
    expect(JSON.stringify(r.body)).not.toContain("passwordHash");
  });
});

describe("Security: unauthenticated & malicious input", () => {
  it("all protected read routes require auth", async () => {
    for (const p of ["/api/tasks", "/api/events", "/api/notes", "/api/projects", "/api/habits", "/api/goals", "/api/reminders", "/api/time/stats", "/api/notifications", "/api/inbox", "/api/stats", "/api/calendar/dashboard", "/api/trash", "/api/transfer/export"]) {
      const r = await supertest(app).get(p);
      expect(r.status, `GET ${p}`).toBe(401);
    }
  });

  it("rejects oversized/invalid payloads gracefully", async () => {
    const u = await registerAndLogin(app, "oversize");
    const r = await u.authed(app).post("/api/notes").send({ content: "X".repeat(400_000) });
    expect([413, 422, 400]).toContain(r.status);
  });

  it("queries are parameterized (no SQLi signal, normal response)", async () => {
    const u = await registerAndLogin(app, "sqli");
    const r = await u.authed(app).get("/api/tasks").query({ q: "' OR 1=1 --" });
    expect(r.status).toBe(200);
  });
});