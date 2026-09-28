import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { addDaysYmd, localYmd, wallToUtc, zonedDayRange } from "../src/lib/mascot/time.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("Calendar day boundaries", () => {
  it("uses the user's timezone when selecting a day", async () => {
    const { authed } = await registerAndLogin(app, "calendar-tz");
    await authed(app).patch("/api/users/me/preferences").send({ timezone: "America/New_York" });
    const today = localYmd("America/New_York");
    const yesterday = addDaysYmd(today, -1);

    await authed(app).post("/api/tasks").send({
      title: "Última tarea del día anterior",
      dueDate: wallToUtc(yesterday, "23:30:00", "America/New_York").toISOString(),
      hasTime: true,
    });
    await authed(app).post("/api/tasks").send({
      title: "Primera tarea del día siguiente",
      dueDate: wallToUtc(today, "00:30:00", "America/New_York").toISOString(),
      hasTime: true,
    });

    const day = await authed(app).get(`/api/calendar/my-day?date=${yesterday}`);
    expect(day.status).toBe(200);
    expect(day.body.overdue.map((task: { title: string }) => task.title)).toEqual(["Última tarea del día anterior"]);
    expect(day.body.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Última tarea del día anterior", kind: "task", hasTime: true }),
    ]));

    const dashboard = await authed(app).get("/api/calendar/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.startOfDay).toBe(zonedDayRange("America/New_York", 0).start.toISOString());
  });

  it("keeps multi-day events, tasks and reminders visible on days they span", async () => {
    const { authed } = await registerAndLogin(app, "multiday");
    await authed(app).patch("/api/users/me/preferences").send({ timezone: "Europe/Madrid" });
    const start = localYmd("Europe/Madrid");
    const mid = addDaysYmd(start, 1);
    const last = addDaysYmd(start, 2);

    const ev = await authed(app).post("/api/events").send({
      title: "Viaje",
      startAt: wallToUtc(start, "10:00:00", "Europe/Madrid").toISOString(),
      endAt: wallToUtc(last, "18:00:00", "Europe/Madrid").toISOString(),
    });
    expect(ev.status).toBe(201);

    const task = await authed(app).post("/api/tasks").send({
      title: "Feria",
      dueDate: wallToUtc(start, "09:00:00", "Europe/Madrid").toISOString(),
      dueEndDate: wallToUtc(last, "20:00:00", "Europe/Madrid").toISOString(),
      hasTime: true,
    });
    expect(task.status).toBe(201);
    expect(task.body.task.dueEndDate).toBeTruthy();

    const rem = await authed(app).post("/api/reminders").send({
      title: "Congreso",
      remindAt: wallToUtc(start, "08:00:00", "Europe/Madrid").toISOString(),
      endAt: wallToUtc(last, "22:00:00", "Europe/Madrid").toISOString(),
    });
    expect(rem.status).toBe(201);

    const cal = await authed(app).get("/api/calendar").query({ from: mid, to: addDaysYmd(mid, 1) });
    expect(cal.status).toBe(200);
    expect(cal.body.events.map((item: { title: string }) => item.title)).toContain("Viaje");
    expect(cal.body.tasks.map((item: { title: string }) => item.title)).toContain("Feria");

    const reminders = await authed(app).get("/api/reminders").query({ from: mid, to: addDaysYmd(mid, 1) });
    expect(reminders.status).toBe(200);
    expect(reminders.body.reminders.map((item: { title: string }) => item.title)).toContain("Congreso");
  });

  it("deletes a reminder that has no deletedAt column", async () => {
    const { authed } = await registerAndLogin(app, "rem-del");
    const created = await authed(app).post("/api/reminders").send({
      title: "Borrar",
      remindAt: new Date().toISOString(),
    });
    expect(created.status).toBe(201);
    const id = created.body.reminder.id as string;
    const del = await authed(app).delete(`/api/reminders/${id}`);
    expect(del.status).toBe(200);
    const list = await authed(app).get("/api/reminders");
    expect(list.status).toBe(200);
    expect(list.body.reminders.map((item: { id: string }) => item.id)).not.toContain(id);
  });

  it("updates a reminder and stores the Telegram flag", async () => {
    const { authed } = await registerAndLogin(app, "rem-edit");
    const created = await authed(app).post("/api/reminders").send({
      title: "Llamar",
      remindAt: new Date(Date.now() + 3600_000).toISOString(),
      notifyTelegram: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.reminder.notifyTelegram).toBe(false);
    const id = created.body.reminder.id as string;
    const later = new Date(Date.now() + 7200_000).toISOString();
    const patched = await authed(app).patch(`/api/reminders/${id}`).send({
      title: "Llamar a la sala",
      remindAt: later,
      notifyTelegram: true,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.reminder.title).toBe("Llamar a la sala");
    expect(patched.body.reminder.notifyTelegram).toBe(true);
    expect(new Date(patched.body.reminder.remindAt).getTime()).toBe(new Date(later).getTime());

    const toggled = await authed(app).patch(`/api/reminders/${id}`).send({ notifyTelegram: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.reminder.notifyTelegram).toBe(false);
    expect(toggled.body.reminder.title).toBe("Llamar a la sala");
  });

  it("moves timed tasks and reminders while preserving their duration", async () => {
    const { authed } = await registerAndLogin(app, "calendar-move");
    const timezone = "Europe/Madrid";
    await authed(app).patch("/api/users/me/preferences").send({ timezone });
    const startDay = localYmd(timezone);
    const targetDay = addDaysYmd(startDay, 2);
    const taskStart = wallToUtc(startDay, "10:30:00", timezone);
    const taskEnd = wallToUtc(startDay, "12:00:00", timezone);
    const createdTask = await authed(app).post("/api/tasks").send({
      title: "Mover tarea",
      dueDate: taskStart.toISOString(),
      dueEndDate: taskEnd.toISOString(),
      hasTime: true,
    });
    expect(createdTask.status).toBe(201);

    const movedTask = await authed(app).patch(`/api/tasks/${createdTask.body.task.id}/move`).send({
      dueDate: wallToUtc(targetDay, "10:30:00", timezone).toISOString(),
    });
    expect(movedTask.status).toBe(200);
    expect(movedTask.body.task.hasTime).toBe(true);
    expect(new Date(movedTask.body.task.dueEndDate).getTime() - new Date(movedTask.body.task.dueDate).getTime()).toBe(90 * 60_000);

    const reminderStart = wallToUtc(startDay, "15:00:00", timezone);
    const reminderEnd = wallToUtc(startDay, "16:00:00", timezone);
    const createdReminder = await authed(app).post("/api/reminders").send({
      title: "Mover recordatorio",
      remindAt: reminderStart.toISOString(),
      endAt: reminderEnd.toISOString(),
    });
    expect(createdReminder.status).toBe(201);
    const movedReminderStart = wallToUtc(targetDay, "15:00:00", timezone);
    const movedReminder = await authed(app).patch(`/api/reminders/${createdReminder.body.reminder.id}`).send({
      remindAt: movedReminderStart.toISOString(),
      endAt: new Date(movedReminderStart.getTime() + 60 * 60_000).toISOString(),
    });
    expect(movedReminder.status).toBe(200);
    expect(new Date(movedReminder.body.reminder.endAt).getTime() - new Date(movedReminder.body.reminder.remindAt).getTime()).toBe(60 * 60_000);
  });

  it("keeps all-day events all-day when their move does not set a time", async () => {
    const { authed } = await registerAndLogin(app, "calendar-all-day");
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 3600_000);
    const created = await authed(app).post("/api/events").send({
      title: "Día completo",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      allDay: true,
    });
    expect(created.status).toBe(201);
    const moved = await authed(app).patch(`/api/events/${created.body.event.id}/move`).send({
      startAt: new Date(start.getTime() + 2 * 24 * 3600_000).toISOString(),
      endAt: new Date(end.getTime() + 2 * 24 * 3600_000).toISOString(),
    });
    expect(moved.status).toBe(200);
    expect(moved.body.event.allDay).toBe(true);
  });
});
