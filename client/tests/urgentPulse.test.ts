import { describe, expect, it } from "vitest";
import { isUrgentSoon } from "../src/lib/urgentPulse";

const now = Date.parse("2026-09-23T10:00:00Z");
const urgent = { priority: "URGENT", status: "PENDING", completedAt: null };

describe("urgent pulse", () => {
  it("lights up urgent tasks due within two hours", () => {
    expect(isUrgentSoon(urgent, now + 30 * 60_000, now)).toBe(true);
    expect(isUrgentSoon(urgent, now + 2 * 3_600_000, now)).toBe(true);
  });

  it("stays off for later, late, done or non-urgent tasks", () => {
    expect(isUrgentSoon(urgent, now + 2 * 3_600_000 + 60_000, now)).toBe(false);
    expect(isUrgentSoon(urgent, now - 60_000, now)).toBe(false);
    expect(isUrgentSoon(urgent, null, now)).toBe(false);
    expect(isUrgentSoon({ ...urgent, status: "COMPLETED" }, now + 60_000, now)).toBe(false);
    expect(isUrgentSoon({ ...urgent, priority: "HIGH" }, now + 60_000, now)).toBe(false);
  });
});
