import { describe, it, expect } from "vitest";
import { nextTagColor, PROJECT_COLORS } from "../../client/src/lib/projects.ts";

describe("nextTagColor", () => {
  it("elige el primer color libre de la paleta", () => {
    expect(nextTagColor([])).toBe(PROJECT_COLORS[0]);
    expect(nextTagColor([{ color: PROJECT_COLORS[0] }])).toBe(PROJECT_COLORS[1]);
  });

  it("cicla si ya están todos usados", () => {
    const all = PROJECT_COLORS.map((color) => ({ color }));
    expect(nextTagColor(all)).toBe(PROJECT_COLORS[0]);
  });
});
