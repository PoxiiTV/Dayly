import { describe, expect, it } from "vitest";
import { PROJECT_COLORS } from "../src/lib/projects";
import { contrastRatio, isTaskCardFill, resolveTaskCardFill, taskCardInk, type Rgb } from "../src/lib/taskCardFill";

const rgb = (triplet: string) => triplet.split(" ").map(Number) as Rgb;
const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;

describe("task card fill", () => {
  it("follows the appearance setting unless the card overrides it", () => {
    expect(resolveTaskCardFill(null, "#10b981", false)).toBeNull();
    expect(resolveTaskCardFill(null, "#10b981", true)).toBe("#10b981");
    expect(resolveTaskCardFill("none", "#10b981", true)).toBeNull();
    expect(resolveTaskCardFill("project", "#10b981", false)).toBe("#10b981");
    expect(resolveTaskCardFill("#123456", "#10b981", false)).toBe("#123456");
  });

  it("never paints with values it cannot parse", () => {
    expect(resolveTaskCardFill(null, null, true)).toBeNull();
    expect(resolveTaskCardFill("project", "rgb(var(--accent))", false)).toBeNull();
    expect(resolveTaskCardFill("red", "#10b981", false)).toBeNull();
    expect(isTaskCardFill("#12345")).toBe(false);
    expect(isTaskCardFill("url(x)")).toBe(false);
  });

  it("keeps every text token readable on the palette and on extreme colours", () => {
    for (const color of [...PROJECT_COLORS, "#ffffff", "#000000", "#777777", "#ffff00"]) {
      const ink = taskCardInk(color);
      expect(ink).not.toBeNull();
      const background = rgb(ink!.vars["--surface"]!);
      expect(contrastRatio(background, hex(color))).toBeLessThan(1.3);
      for (const token of ["--text", "--muted", "--faint", "--accent", "--danger", "--warn"]) {
        expect(contrastRatio(rgb(ink!.vars[token]!), background), `${token} on ${color}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses dark ink on light fills and light ink on dark fills", () => {
    expect(taskCardInk("#fef3c7")!.vars["--text"]).toBe("17 17 17");
    expect(taskCardInk("#1e1b4b")!.vars["--text"]).toBe("255 255 255");
  });
});
