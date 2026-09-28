import { describe, expect, it } from "vitest";
import { parseNotifySound } from "../src/lib/notifySound.js";

describe("notify sound", () => {
  it("acepta los ocho avisos y cae en campana", () => {
    expect(parseNotifySound("ring")).toBe("ring");
    expect(parseNotifySound("marimba")).toBe("marimba");
    expect(parseNotifySound("nope")).toBe("bell");
    expect(parseNotifySound(null)).toBe("bell");
  });
});
