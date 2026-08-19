import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin, createTask, createEvent } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("Task CRUD", () => {
  it("creates, lists, updates status and completes a task", async () => {
    const { authed } = await registerAndLogin(app, "crud");
    const task = await createTask(authed, app, "Tarea CRUD");
    expect(task.id).toBeTruthy();

    const list = await authed(app).get("/api/tasks");
    expect(list.body.tasks.map((t: { id: string }) => t.id)).toContain(task.id);

    const done = await authed(app).post(`/api/tasks/${task.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.task.status).toBe("COMPLETED");

    const updated = await authed(app).patch(`/api/tasks/${task.id}`).send({ priority: "URGENT" });
    expect(updated.body.task.priority).toBe("URGENT");
    expect(updated.body.task.status).toBe("COMPLETED");
  });

  it("supports subtasks", async () => {
    const { authed } = await registerAndLogin(app, "sub");
    const task = await createTask(authed, app, "Con subtareas");
    const sub = await authed(app).post(`/api/tasks/${task.id}/subtasks`).send({ title: "Sub 1" });
    expect(sub.status).toBe(201);
    const tick = await authed(app).patch(`/api/tasks/subtasks/${sub.body.subtask.id}`).send({ done: true });
    expect(tick.body.subtask.done).toBe(true);
  });

  it("soft-delete moves to trash, restores, then permanent delete", async () => {
    const { authed } = await registerAndLogin(app, "trash");
    const task = await createTask(authed, app, "A la papelera");
    expect((await authed(app).delete(`/api/tasks/${task.id}`)).status).toBe(200);

    const trash = await authed(app).get("/api/trash");
    expect(trash.body.tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    // hidden from normal list
    const list = await authed(app).get("/api/tasks");
    expect(list.body.tasks.map((t: { id: string }) => t.id)).not.toContain(task.id);

    expect((await authed(app).post("/api/trash/restore").send({ type: "task", id: task.id })).status).toBe(200);
    expect((await authed(app).delete(`/api/tasks/${task.id}/permanent`)).status).toBe(200);
  });
});

describe("Event CRUD", () => {
  it("creates, moves (drag&drop) and converts to a task", async () => {
    const { authed } = await registerAndLogin(app, "evcrud");
    const ev = await createEvent(authed, app, "Reunión");
    expect(ev.id).toBeTruthy();

    const newStart = new Date(Date.now() + 5 * 3600_000).toISOString();
    const newEnd = new Date(Date.now() + 5 * 3600_000 + 1800_000).toISOString();
    const moved = await authed(app).patch(`/api/events/${ev.id}/move`).send({ startAt: newStart, endAt: newEnd });
    expect(moved.status).toBe(200);
    expect(new Date(moved.body.event.startAt).getTime()).toBe(new Date(newStart).getTime());

    const conv = await authed(app).post(`/api/events/${ev.id}/to-task`);
    expect(conv.status).toBe(201);
    expect(conv.body.task.title).toBe("Reunión");
  });

  it("rejects end earlier than start", async () => {
    const { authed } = await registerAndLogin(app, "evbad");
    const r = await authed(app).post("/api/events").send({
      title: "X",
      startAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      endAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(r.status).toBe(400);
  });
});

describe("Notes + Projects + Habits + Inbox", () => {
  it("notes create and autosave", async () => {
    const { authed } = await registerAndLogin(app, "note");
    const n = await authed(app).post("/api/notes").send({ title: "Idea", content: "hola" });
    expect(n.status).toBe(201);
    const save = await authed(app).patch(`/api/notes/${n.body.note.id}/autosave`).send({ content: "contenido nuevo" });
    expect(save.body.note.content).toBe("contenido nuevo");
  });

  it("projects derive progress + tasks endpoint", async () => {
    const { authed } = await registerAndLogin(app, "proj");
    const p = await authed(app).post("/api/projects").send({ name: "Lanzamiento" });
    expect(p.status).toBe(201);
    const detail = await authed(app).get(`/api/projects/${p.body.project.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.project.progress).toBeTypeOf("number");
  });

  it("habits log + streaks", async () => {
    const { authed } = await registerAndLogin(app, "habit");
    const h = await authed(app).post("/api/habits").send({ name: "Leer" });
    expect(h.status).toBe(201);
    const now = new Date();
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await authed(app).post(`/api/habits/${h.body.habit.id}/log`).send({ date: d });
    const list = await authed(app).get("/api/habits");
    expect(list.body.habits[0].current).toBeGreaterThanOrEqual(1);
  });

  it("inbox capture and conversion to task", async () => {
    const { authed } = await registerAndLogin(app, "inbox");
    const item = await authed(app).post("/api/inbox").send({ content: "Comprar cables" });
    expect(item.status).toBe(201);
    const conv = await authed(app).post(`/api/inbox/${item.body.item.id}/convert`).send({ type: "TASK" });
    expect(conv.status).toBe(201);
    expect(conv.body.task.title).toBe("Comprar cables");
  });

  it("time tracking start/stop adds duration", async () => {
    const { authed } = await registerAndLogin(app, "time");
    const task = await createTask(authed, app, "Tarea con tiempo");
    const start = await authed(app).post("/api/time/start").send({ taskId: task.id });
    expect(start.status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100));
    const stop = await authed(app).post("/api/time/stop");
    expect(stop.status).toBe(200);
    expect(stop.body.entry.durationSec).toBeGreaterThan(0);
  });
});