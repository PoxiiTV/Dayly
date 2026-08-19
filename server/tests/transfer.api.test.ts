import { describe, it, expect, beforeAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin, createTask, createEvent } from "./helpers.js";

let app: Express;

beforeAll(async () => {
  app = await makeApp();
});

describe("Transfer API", () => {
  it("requires auth to export and import", async () => {
    expect((await supertest(app).get("/api/transfer/export")).status).toBe(401);
    expect((await supertest(app).post("/api/transfer/import").send({ text: "{}" })).status).toBe(401);
  });

  it("export json only includes the current user's data", async () => {
    const a = await registerAndLogin(app, "txa");
    const b = await registerAndLogin(app, "txb");
    await createTask(a.authed, app, "Secreto de A");
    await createEvent(a.authed, app, "Evento privado A");
    await a.authed(app).post("/api/notes").send({ title: "Nota de A", content: "privada" });
    await createTask(b.authed, app, "Tarea de B");

    const exp = await b.authed(app).get("/api/transfer/export").query({ format: "json" });
    expect(exp.status).toBe(200);
    expect(exp.body.tasks.map((t: { title: string }) => t.title)).toContain("Tarea de B");
    expect(exp.body.tasks.map((t: { title: string }) => t.title)).not.toContain("Secreto de A");
    expect(JSON.stringify(exp.body)).not.toContain("Evento privado A");
    expect(JSON.stringify(exp.body)).not.toContain("userId");
  });

  it("imports json as new rows owned by the importer", async () => {
    const a = await registerAndLogin(app, "txia");
    const b = await registerAndLogin(app, "txib");
    const payload = {
      format: "json",
      text: JSON.stringify({
        version: 1,
        tasks: [{ title: "Importada", userId: a.userId, id: "cuid_falso" }],
        events: [
          {
            title: "Cita importada",
            startAt: "2026-09-01T10:00:00.000Z",
            endAt: "2026-09-01T11:00:00.000Z",
          },
        ],
        notes: [{ title: "Nota importada", content: "hola" }],
      }),
    };
    const r = await b.authed(app).post("/api/transfer/import").send(payload);
    expect(r.status).toBe(200);
    expect(r.body.created.tasks).toBe(1);
    expect(r.body.created.events).toBe(1);
    expect(r.body.created.notes).toBe(1);

    const tasksA = await a.authed(app).get("/api/tasks").query({ includeCompleted: "true" });
    expect(tasksA.body.tasks.map((t: { title: string }) => t.title)).not.toContain("Importada");
    const tasksB = await b.authed(app).get("/api/tasks").query({ includeCompleted: "true" });
    expect(tasksB.body.tasks.map((t: { title: string }) => t.title)).toContain("Importada");
    expect(JSON.stringify(tasksB.body)).not.toContain("cuid_falso");
  });

  it("imports an ICS calendar as events and tasks", async () => {
    const u = await registerAndLogin(app, "txics");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "SUMMARY:Desde Google",
      "DTSTART:20260902T120000Z",
      "DTEND:20260902T130000Z",
      "END:VEVENT",
      "BEGIN:VTODO",
      "SUMMARY:Tarea ICS",
      "DUE:20260903T180000Z",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = await u.authed(app).post("/api/transfer/import").send({ format: "ics", text: ics });
    expect(r.status).toBe(200);
    expect(r.body.created.events).toBe(1);
    expect(r.body.created.tasks).toBe(1);
    const ev = await u.authed(app).get("/api/events").query({ from: "2026-01-01", to: "2027-01-01" });
    expect(ev.body.events.map((e: { title: string }) => e.title)).toContain("Desde Google");
  });

  it("rejects invalid import payloads", async () => {
    const u = await registerAndLogin(app, "txbad");
    expect((await u.authed(app).post("/api/transfer/import").send({ format: "json", text: "no-es-json" })).status).toBe(400);
    expect((await u.authed(app).post("/api/transfer/import").send({ format: "json", text: "" })).status).toBe(422);
  });

  it("exports ics and csv as downloadable text", async () => {
    const u = await registerAndLogin(app, "txdl");
    await createEvent(u.authed, app, "Exportable");
    const ics = await u.authed(app).get("/api/transfer/export").query({ format: "ics" });
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.text).toContain("BEGIN:VCALENDAR");
    expect(ics.text).toContain("Exportable");
    const csv = await u.authed(app).get("/api/transfer/export").query({ format: "csv" });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("event");
  });
});
