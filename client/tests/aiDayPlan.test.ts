import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDayPlan, saveDayPlan, type AiDayPlan } from "../src/lib/ai";

const plan: AiDayPlan = { summary: "Día tranquilo", order: [{ taskId: "t1", title: "Informe", priority: "HIGH", reason: "Urgente" }] };

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("saved day plan", () => {
  it("comes back for the same user during that day", () => {
    saveDayPlan("u1", "2026-09-23", plan);
    expect(loadDayPlan("u1", "2026-09-23", "2026-09-23")).toEqual(plan);
  });

  it("expires with the day and never leaks to another user", () => {
    saveDayPlan("u1", "2026-09-23", plan);
    expect(loadDayPlan("u1", "2026-09-23", "2026-09-24")).toBeNull();
    expect(loadDayPlan("u2", "2026-09-23", "2026-09-23")).toBeNull();
    expect(loadDayPlan(undefined, "2026-09-23", "2026-09-23")).toBeNull();
  });

  it("ignores damaged storage", () => {
    localStorage.setItem("dayly.aiDayPlan", "{roto");
    expect(loadDayPlan("u1", "2026-09-23", "2026-09-23")).toBeNull();
  });
});
