import { describe, expect, it } from "vitest";
import { BACKGROUND_VISIBILITY_DEFAULT, backgroundVisibilityVars, parseBackgroundVisibility } from "../src/lib/backgroundVisibility";

describe("background visibility", () => {
  it("keeps the original look at the default", () => {
    expect(backgroundVisibilityVars(BACKGROUND_VISIBILITY_DEFAULT)).toEqual({ fade: 1, veil: 1 });
  });

  it("fades the background below the default and thins the veil above it", () => {
    expect(backgroundVisibilityVars(0)).toEqual({ fade: 0, veil: 1 });
    expect(backgroundVisibilityVars(35)).toEqual({ fade: 0.5, veil: 1 });
    expect(backgroundVisibilityVars(100)).toEqual({ fade: 1, veil: 0.4 });
  });

  it("clamps and repairs stored values", () => {
    expect(parseBackgroundVisibility(null)).toBe(BACKGROUND_VISIBILITY_DEFAULT);
    expect(parseBackgroundVisibility("abc")).toBe(BACKGROUND_VISIBILITY_DEFAULT);
    expect(parseBackgroundVisibility("-20")).toBe(0);
    expect(parseBackgroundVisibility("250")).toBe(100);
    expect(parseBackgroundVisibility("42.6")).toBe(43);
    expect(backgroundVisibilityVars(-5)).toEqual({ fade: 0, veil: 1 });
  });
});
