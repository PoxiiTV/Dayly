import { describe, it, expect } from "vitest";
import { collectOccupiedTimes, occupiedHint, occupiedSlotsOnDay, quarterSlotOf } from "../../client/src/lib/occupiedTimes.ts";
import type { EventItem, Reminder, Task } from "../../client/src/lib/types.ts";

function task(partial: Partial<Task> & Pick<Task, "id" | "title" | "dueDate" | "hasTime">): Task {
  return {
    priority: "NORMAL",
    status: "PENDING",
    timeSpentMinutes: 0,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...partial,
  };
}

function event(partial: Partial<EventItem> & Pick<EventItem, "id" | "title" | "startAt" | "endAt">): EventItem {
  return {
    allDay: false,
    priority: "NORMAL",
    status: "PENDING",
    ...partial,
  };
}

describe("occupiedSlotsOnDay", () => {
  it("marca solo el cuarto de hora de una tarea puntual", () => {
    const start = new Date(2026, 8, 9, 10, 7);
    expect(occupiedSlotsOnDay(start, null, "2026-09-09")).toEqual(["10:00"]);
    expect(quarterSlotOf(start)).toBe("10:00");
  });

  it("marca el intervalo de un evento, sin incluir la hora de fin", () => {
    const start = new Date(2026, 8, 9, 9, 0);
    const end = new Date(2026, 8, 9, 10, 0);
    expect(occupiedSlotsOnDay(start, end, "2026-09-09")).toEqual(["09:00", "09:15", "09:30", "09:45"]);
  });

  it("no marca otro día", () => {
    const start = new Date(2026, 8, 9, 10, 0);
    expect(occupiedSlotsOnDay(start, null, "2026-09-10")).toEqual([]);
  });
});

describe("collectOccupiedTimes", () => {
  it("incluye tareas con hora, eventos y recordatorios, y excluye el ítem actual", () => {
    const day = "2026-09-09";
    const tasks = [
      task({ id: "t1", title: "Llamar", dueDate: new Date(2026, 8, 9, 8, 0).toISOString(), hasTime: true }),
      task({ id: "t2", title: "Sin hora", dueDate: new Date(2026, 8, 9, 8, 0).toISOString(), hasTime: false }),
      task({ id: "t3", title: "Otra", dueDate: new Date(2026, 8, 9, 11, 0).toISOString(), hasTime: true }),
    ];
    const events = [
      event({ id: "e1", title: "Reunión", startAt: new Date(2026, 8, 9, 9, 0).toISOString(), endAt: new Date(2026, 8, 9, 9, 30).toISOString() }),
    ];
    const reminders: Reminder[] = [{
      id: "r1",
      title: "Pagar",
      remindAt: new Date(2026, 8, 9, 18, 0).toISOString(),
      scheduleDaily: false,
      targetType: "NONE",
    }];
    const occupied = collectOccupiedTimes({ dayKey: day, tasks, events, reminders, excludeIds: ["t1"] });
    expect(occupied.times.has("08:00")).toBe(false);
    expect(occupied.times.has("09:00")).toBe(true);
    expect(occupied.times.has("09:15")).toBe(true);
    expect(occupied.times.has("09:30")).toBe(false);
    expect(occupied.times.has("11:00")).toBe(true);
    expect(occupied.times.has("18:00")).toBe(true);
    expect(occupied.titles.get("09:00")).toEqual(["Reunión"]);
    expect(occupied.titles.get("11:00")).toEqual(["Otra"]);
  });
});

describe("occupiedHint", () => {
  it("nombra el conflicto", () => {
    expect(occupiedHint(["Reunión"], "09:00")).toBe("Ya hay: Reunión");
    expect(occupiedHint(["A", "B"], "09:00")).toBe("Ya hay 2 elementos (p. ej. A)");
    expect(occupiedHint([], "09:00")).toBe("Ya hay algo a las 09:00");
  });
});
