import { describe, expect, it } from "vitest";
import { compute, percentValue } from "../src/lib/calc";

describe("percentage key", () => {
  it("adds a percentage of the first number, not the fraction", () => {
    // 100 + 21 % = 121, the case every calculator gets right.
    expect(percentValue(100, "+", 21)).toBe(21);
    expect(compute(100, percentValue(100, "+", 21), "+")).toBe(121);
  });

  it("subtracts a percentage of the first number", () => {
    expect(compute(200, percentValue(200, "-", 15), "-")).toBe(170);
  });

  it("multiplies and divides by the plain fraction", () => {
    expect(compute(200, percentValue(200, "*", 10), "*")).toBe(20);
    expect(compute(50, percentValue(50, "/", 50), "/")).toBe(100);
  });

  it("is a division by a hundred on its own", () => {
    expect(percentValue(null, null, 50)).toBe(0.5);
  });

  it("keeps division by zero out of the result", () => {
    expect(Number.isNaN(compute(1, 0, "/"))).toBe(true);
  });
});
