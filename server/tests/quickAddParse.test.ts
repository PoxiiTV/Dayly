import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "../../client/src/lib/quickAddParse.ts";

const NOW = new Date(2026, 7, 29, 12, 0, 0); // Saturday 29 Aug 2026

describe("parseQuickAdd", () => {
  it("parses a meeting tomorrow at 10", () => {
    const p = parseQuickAdd("reunión mañana a las 10", NOW);
    expect(p.kind).toBe("event");
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.hasTime).toBe(true);
    expect(p.start?.getDate()).toBe(30);
    expect(p.start?.getHours()).toBe(10);
    expect(p.hint).toBeTruthy();
  });

  it("parses an urgent task on a weekday", () => {
    const p = parseQuickAdd("tarea urgente el lunes", NOW);
    expect(p.kind).toBe("task");
    expect(p.priority).toBe("URGENT");
    expect(p.title.toLowerCase()).not.toContain("urgente");
    expect(p.start?.getDay()).toBe(1);
  });

  it("parses a daily reminder", () => {
    const p = parseQuickAdd("recordatorio pastillas cada día a las 8", NOW);
    expect(p.kind).toBe("reminder");
    expect(p.freq).toBe("DAILY");
    expect(p.hasTime).toBe(true);
    expect(p.start?.getHours()).toBe(8);
  });

  it("leaves a plain title as a task", () => {
    const p = parseQuickAdd("Comprar cables", NOW);
    expect(p.kind).toBe("task");
    expect(p.title).toBe("Comprar cables");
    expect(p.hint).toBe("");
  });

  it("does not silently roll an impossible date into another month", () => {
    const p = parseQuickAdd("tarea revisión el 31/02/2026", NOW);
    expect(p.invalidDate).toBe(true);
    expect(p.start).toBeNull();
    expect(p.title).toContain("31/02/2026");
  });

  it("flags an impossible time instead of scheduling a default hour", () => {
    const p = parseQuickAdd("tarea llamada mañana a las 25:00", NOW);
    expect(p.invalidTime).toBe(true);
    expect(p.hasTime).toBe(false);
  });
});
