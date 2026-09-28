import { describe, it, expect } from "vitest";
import { isTaskOverdue, taskDeadlineMs } from "../../client/src/lib/dates.ts";

describe("isTaskOverdue", () => {
  it("marca atrasada una tarea con hora ya vencida", () => {
    const dueDate = new Date(2026, 8, 10, 9, 0).toISOString();
    expect(isTaskOverdue({ dueDate, hasTime: true, status: "PENDING" }, new Date(2026, 8, 10, 10, 0).getTime())).toBe(true);
  });

  it("no marca atrasada una tarea de todo el día hasta las 23:59", () => {
    const dueDate = new Date(2026, 8, 10, 8, 0).toISOString();
    const midday = new Date(2026, 8, 10, 12, 0).getTime();
    expect(isTaskOverdue({ dueDate, hasTime: false, status: "PENDING" }, midday)).toBe(false);
    expect(taskDeadlineMs({ dueDate, hasTime: false })).toBeGreaterThan(midday);
  });

  it("marca atrasada una tarea de todo el día del día anterior", () => {
    const dueDate = new Date(2026, 8, 9, 8, 0).toISOString();
    expect(isTaskOverdue({ dueDate, hasTime: false, status: "PENDING" }, new Date(2026, 8, 10, 10, 0).getTime())).toBe(true);
  });

  it("ignora completadas, canceladas y sin fecha", () => {
    const dueDate = new Date(2026, 8, 1, 9, 0).toISOString();
    const now = new Date(2026, 8, 11).getTime();
    expect(isTaskOverdue({ dueDate, hasTime: true, status: "COMPLETED" }, now)).toBe(false);
    expect(isTaskOverdue({ dueDate, hasTime: true, status: "CANCELLED" }, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: null, hasTime: false, status: "PENDING" }, now)).toBe(false);
  });
});
