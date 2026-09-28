import { describe, expect, it } from "vitest";
import { pickBool } from "../src/lib/mascot/tools.js";

describe("mascot bool args", () => {
  it("reads notifyTelegram aliases", () => {
    expect(pickBool({ notifyTelegram: true }, ["notifyTelegram", "telegram"])).toBe(true);
    expect(pickBool({ telegram: false }, ["notifyTelegram", "telegram"])).toBe(false);
    expect(pickBool({ telegramAlert: "sí" }, ["telegramAlert"])).toBe(true);
    expect(pickBool({ notifyTelegram: "off" }, ["notifyTelegram"])).toBe(false);
    expect(pickBool({}, ["notifyTelegram"])).toBeUndefined();
  });
});
