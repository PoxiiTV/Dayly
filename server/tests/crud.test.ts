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

  it("toggles notifyTelegram and postpones an overdue task by one day", async () => {
    const { authed } = await registerAndLogin(app, "tg-post");
    const due = new Date(Date.now() - 36 * 3600_000).toISOString();
    const created = await authed(app).post("/api/tasks").send({ title: "Atrasada", dueDate: due, hasTime: true, notifyTelegram: true });
    expect(created.status).toBe(201);
    expect(created.body.task.notifyTelegram).toBe(true);

    const off = await authed(app).patch(`/api/tasks/${created.body.task.id}`).send({ notifyTelegram: false });
    expect(off.status).toBe(200);
    expect(off.body.task.notifyTelegram).toBe(false);

    const listed = await authed(app).get("/api/tasks");
    const row = (listed.body.tasks as { id: string; notifyTelegram: boolean }[]).find((t) => t.id === created.body.task.id);
    expect(row?.notifyTelegram).toBe(false);

    const on = await authed(app).patch(`/api/tasks/${created.body.task.id}`).send({ notifyTelegram: true });
    expect(on.body.task.notifyTelegram).toBe(true);

    const postponed = await authed(app).post(`/api/tasks/${created.body.task.id}/postpone`).send({ days: 1 });
    expect(postponed.status).toBe(200);
    expect(postponed.body.task.status).toBe("POSTPONED");
    const shifted = new Date(postponed.body.task.dueDate).getTime() - new Date(due).getTime();
    expect(shifted).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(shifted).toBeLessThanOrEqual(25 * 3600_000);
  });

  it("stores the board card fill, rejects invalid values and other users", async () => {
    const { authed } = await registerAndLogin(app, "card-fill");
    const task = await createTask(authed, app, "Tarjeta pintada");
    expect(task.cardFill ?? null).toBeNull();

    for (const cardFill of ["project", "none", "#1E293B"]) {
      const res = await authed(app).patch(`/api/tasks/${task.id}`).send({ cardFill });
      expect(res.status).toBe(200);
      expect(res.body.task.cardFill).toBe(cardFill);
    }
    for (const cardFill of ["red", "#12345", "url(javascript:alert(1))", 7]) {
      expect((await authed(app).patch(`/api/tasks/${task.id}`).send({ cardFill })).status).toBe(422);
    }
    const cleared = await authed(app).patch(`/api/tasks/${task.id}`).send({ cardFill: null });
    expect(cleared.body.task.cardFill).toBeNull();

    const other = await registerAndLogin(app, "card-fill-other");
    const denied = await other.authed(app).patch(`/api/tasks/${task.id}`).send({ cardFill: "none" });
    expect(denied.status).toBe(404);
  });

  it("moves the overflow of a very long quick title into the description", async () => {
    const { authed } = await registerAndLogin(app, "long-title");
    const long = Array.from({ length: 40 }, (_, i) => `idea${i}`).join(" ");
    const res = await authed(app).post("/api/tasks").send({ title: long });
    expect(res.status).toBe(201);
    expect(res.body.task.title.length).toBeLessThanOrEqual(151);
    expect(res.body.task.title.endsWith("…")).toBe(true);
    expect(res.body.task.description.startsWith("…idea")).toBe(true);
  });

  it("supports subtasks", async () => {
    const { authed } = await registerAndLogin(app, "sub");
    const task = await createTask(authed, app, "Con subtareas");
    const sub = await authed(app).post(`/api/tasks/${task.id}/subtasks`).send({ title: "Sub 1" });
    expect(sub.status).toBe(201);
    const tick = await authed(app).patch(`/api/tasks/subtasks/${sub.body.subtask.id}`).send({ done: true });
    expect(tick.body.subtask.done).toBe(true);
  });

  it("creates, renames, recolors and deletes task tags safely", async () => {
    const { authed } = await registerAndLogin(app, "tags");
    const created = await authed(app).post("/api/tags").send({ name: "Trabajo", color: "#6366f1" });
    expect(created.status).toBe(201);
    const tagId = created.body.tag.id as string;

    const task = await authed(app).post("/api/tasks").send({ title: "Con etiqueta", tagIds: [tagId] });
    expect(task.status).toBe(201);
    expect(task.body.task.tags).toEqual(expect.arrayContaining([expect.objectContaining({ id: tagId })]));

    const updated = await authed(app).patch(`/api/tags/${tagId}`).send({ name: "Clientes", color: "#10b981" });
    expect(updated.status).toBe(200);
    expect(updated.body.tag).toMatchObject({ name: "Clientes", color: "#10b981" });

    const invalid = await authed(app).patch(`/api/tags/${tagId}`).send({ color: "red" });
    expect(invalid.status).toBe(422);

    expect((await authed(app).delete(`/api/tags/${tagId}`)).status).toBe(200);
    const tasks = await authed(app).get("/api/tasks").query({ includeCompleted: "true" });
    const after = (tasks.body.tasks as { id: string; tags: { id: string }[] }[]).find((item) => item.id === task.body.task.id);
    expect(after?.tags).toEqual([]);
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
    const archived = await authed(app).patch(`/api/notes/${n.body.note.id}`).send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body.note.archived).toBe(true);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const att = await authed(app).post(`/api/notes/${n.body.note.id}/attachments`).attach("files", png, "pixel.png");
    expect(att.status).toBe(201);
    expect(att.body.attachments[0].mimeType).toBe("image/png");
    const pdf = await authed(app).post(`/api/notes/${n.body.note.id}/attachments`).attach("files", Buffer.from("%PDF-1.4"), "doc.pdf");
    expect(pdf.status).toBe(400);
    const del = await authed(app).delete(`/api/notes/${n.body.note.id}`);
    expect(del.status).toBe(200);
  });

  it("projects derive progress + tasks endpoint", async () => {
    const { authed } = await registerAndLogin(app, "proj");
    const p = await authed(app).post("/api/projects").send({ name: "Lanzamiento" });
    expect(p.status).toBe(201);
    const projectId = p.body.project.id as string;
    const detail = await authed(app).get(`/api/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.project.progress).toBeTypeOf("number");

    const a = await authed(app).post("/api/tasks").send({ title: "Primera", projectId });
    const b = await authed(app).post("/api/tasks").send({ title: "Segunda", projectId });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const reorder = await authed(app).patch(`/api/projects/${projectId}/tasks/reorder`).send({
      ids: [b.body.task.id, a.body.task.id],
    });
    expect(reorder.status).toBe(200);
    const after = await authed(app).get(`/api/projects/${projectId}`);
    const pending = (after.body.project.tasks as { id: string; title: string }[])
      .filter((t) => t.title === "Primera" || t.title === "Segunda");
    expect(pending.map((t) => t.id)).toEqual([b.body.task.id, a.body.task.id]);
    expect(after.body.project.progress).toBe(0);

    const list = await authed(app).get("/api/projects");
    const card = (list.body.projects as { id: string; progress: number; pendingTasks: { title: string }[] }).find((x) => x.id === projectId);
    expect(card?.progress).toBe(after.body.project.progress);
    expect(card?.pendingTasks.map((t) => t.title).sort()).toEqual(["Primera", "Segunda"]);

    const archived = await authed(app).patch(`/api/projects/${projectId}`).send({ status: "ARCHIVED" });
    expect(archived.status).toBe(200);
    const activeList = await authed(app).get("/api/projects");
    expect((activeList.body.projects as { id: string }[]).map((item) => item.id)).not.toContain(projectId);
    const archivedList = await authed(app).get("/api/projects").query({ status: "ARCHIVED" });
    expect((archivedList.body.projects as { id: string }[]).map((item) => item.id)).toContain(projectId);
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

  it("stores mailbox config without leaking the password", async () => {
    const { authed } = await registerAndLogin(app, "mailbox");
    const empty = await authed(app).get("/api/inbox/mailboxes");
    expect(empty.status).toBe(200);
    expect(empty.body.mailboxes).toEqual([]);

    const created = await authed(app).post("/api/inbox/mailboxes").send({
      label: "Personal",
      email: "user@gmail.com",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpSecure: false,
      username: "user@gmail.com",
      password: "app-password-secret",
    });
    expect(created.status).toBe(201);
    expect(created.body.mailbox.email).toBe("user@gmail.com");
    expect(created.body.mailbox.passwordConfigured).toBe(true);
    expect(created.body.mailbox.authType).toBe("password");
    expect(JSON.stringify(created.body)).not.toContain("app-password-secret");
    expect(created.body.mailbox.passwordEnc).toBeUndefined();
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

  it("stores a notify sound preference", async () => {
    const { authed } = await registerAndLogin(app, "notify-sound");
    const saved = await authed(app).patch("/api/users/me/preferences").send({ notifySound: "ring" });
    expect(saved.status).toBe(200);
    expect(saved.body.user.notifySound).toBe("ring");
    const muted = await authed(app).patch("/api/users/me/preferences").send({ notifySoundEnabled: false });
    expect(muted.status).toBe(200);
    expect(muted.body.user.notifySoundEnabled).toBe(false);
    expect(muted.body.user.notifySound).toBe("ring");
  });

  it("stores a wallpaper preference", async () => {
    const { authed } = await registerAndLogin(app, "wallpaper");
    const saved = await authed(app).patch("/api/users/me/preferences").send({ wallpaper: "alps" });
    expect(saved.status).toBe(200);
    expect(saved.body.user.wallpaper).toBe("alps");
  });

  it("stores a day/night theme schedule", async () => {
    const { authed } = await registerAndLogin(app, "theme-sched");
    const saved = await authed(app).patch("/api/users/me/preferences").send({
      themeScheduleEnabled: true,
      themeDarkStartMin: 1200,
      themeDarkEndMin: 360,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.themeScheduleEnabled).toBe(true);
    expect(saved.body.user.themeDarkStartMin).toBe(1200);
    expect(saved.body.user.themeDarkEndMin).toBe(360);
  });
});
