import { describe, expect, it } from "vitest";
import { calendarItemStyle, getCalendarTagColors, hasTagColors } from "@/lib/calendarColors";

describe("calendar item colors", () => {
  it("keeps unique safe tag colors and ignores malformed values", () => {
    const tags = [
      { id: "one", name: "Uno", color: "#3B82F6" },
      { id: "same", name: "Mismo", color: "#3b82f6" },
      { id: "bad", name: "No válido", color: "url(javascript:alert(1))" },
    ];

    expect(getCalendarTagColors(tags)).toEqual(["#3b82f6"]);
    expect(hasTagColors(tags)).toBe(true);
    expect(hasTagColors([{ id: "empty", name: "Sin color", color: null }])).toBe(false);
  });

  it("uses a readable dark foreground on a light tag", () => {
    const style = calendarItemStyle([{ id: "tag", name: "Sol", color: "#f59e0b" }]);
    expect(style.background).toBe("#f59e0b");
    expect(style.color).toBe("#18181b");
  });

  it("creates a multi-tag gradient and preserves readable text", () => {
    const style = calendarItemStyle([
      { id: "one", name: "Uno", color: "#6366f1" },
      { id: "two", name: "Dos", color: "#ec4899" },
    ]);
    expect(style.background).toMatch(/^linear-gradient\(110deg,/);
    expect(style.color === "#ffffff" || style.color === "#18181b").toBe(true);
  });
});
