import { describe, it, expect } from "vitest";
import { suggestedCreateStart } from "../../client/src/lib/dates.ts";

describe("suggestedCreateStart", () => {
  it("siempre es el día siguiente a las 08:00", () => {
    const morning = suggestedCreateStart(new Date(2026, 8, 6, 7, 30));
    expect(morning.getFullYear()).toBe(2026);
    expect(morning.getMonth()).toBe(8);
    expect(morning.getDate()).toBe(7);
    expect(morning.getHours()).toBe(8);
    expect(morning.getMinutes()).toBe(0);

    const afternoon = suggestedCreateStart(new Date(2026, 8, 6, 15, 0));
    expect(afternoon.getDate()).toBe(7);
    expect(afternoon.getHours()).toBe(8);

    const night = suggestedCreateStart(new Date(2026, 8, 6, 23, 59));
    expect(night.getDate()).toBe(7);
    expect(night.getHours()).toBe(8);
  });

  it("pasa de mes si hace falta", () => {
    const next = suggestedCreateStart(new Date(2026, 8, 30, 12, 0));
    expect(next.getMonth()).toBe(9);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(8);
  });
});
