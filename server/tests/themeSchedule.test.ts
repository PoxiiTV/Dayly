import { describe, expect, it } from "vitest";
import { isDarkDuringSchedule } from "../src/lib/themeSchedule.js";

describe("theme schedule", () => {
  it("treats a wrapping night window as dark", () => {
    expect(isDarkDuringSchedule(20 * 60, 20 * 60, 6 * 60)).toBe(true);
    expect(isDarkDuringSchedule(23 * 60 + 59, 20 * 60, 6 * 60)).toBe(true);
    expect(isDarkDuringSchedule(0, 20 * 60, 6 * 60)).toBe(true);
    expect(isDarkDuringSchedule(5 * 60 + 59, 20 * 60, 6 * 60)).toBe(true);
    expect(isDarkDuringSchedule(6 * 60, 20 * 60, 6 * 60)).toBe(false);
    expect(isDarkDuringSchedule(12 * 60, 20 * 60, 6 * 60)).toBe(false);
    expect(isDarkDuringSchedule(19 * 60 + 59, 20 * 60, 6 * 60)).toBe(false);
  });

  it("treats a same-day window as dark only inside it", () => {
    expect(isDarkDuringSchedule(22 * 60, 22 * 60, 23 * 60)).toBe(true);
    expect(isDarkDuringSchedule(22 * 60 + 30, 22 * 60, 23 * 60)).toBe(true);
    expect(isDarkDuringSchedule(23 * 60, 22 * 60, 23 * 60)).toBe(false);
    expect(isDarkDuringSchedule(8 * 60, 22 * 60, 23 * 60)).toBe(false);
  });

  it("stays light when start and end are the same", () => {
    expect(isDarkDuringSchedule(20 * 60, 20 * 60, 20 * 60)).toBe(false);
  });
});
