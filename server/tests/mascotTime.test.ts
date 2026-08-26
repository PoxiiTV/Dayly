import { describe, it, expect } from "vitest";
import { localYmd, parseFlexibleInstant } from "../src/lib/mascot/time.js";
import { instantFromDueAlias, parseToolArgs } from "../src/lib/mascot/tools.js";

const TZ = "Europe/Madrid";

describe("mascot time (timezone del usuario)", () => {
  it("interpreta hoy y mañana en Europe/Madrid", () => {
    const today = parseFlexibleInstant("hoy 18:00", TZ);
    const tomorrow = parseFlexibleInstant("mañana 09:00", TZ);
    expect(today).toBeInstanceOf(Date);
    expect(tomorrow).toBeInstanceOf(Date);
    expect(localYmd(TZ, today!)).toBe(localYmd(TZ));
    const [y, m, d] = localYmd(TZ).split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    expect(localYmd(TZ, tomorrow!)).toBe(nextYmd);
    expect(today!.getTime()).toBeLessThan(tomorrow!.getTime());
  });
});

describe("alias dueDate / dueAt", () => {
  it("parsea JSON string u objeto", () => {
    expect(parseToolArgs('{"dueDate":"mañana"}').dueDate).toBe("mañana");
    expect(parseToolArgs({ dueAt: "hoy 18:00" }).dueAt).toBe("hoy 18:00");
  });

  it("dueDate y dueAt resuelven el mismo instante", () => {
    const a = instantFromDueAlias({ dueDate: "mañana 18:00" }, TZ);
    const b = instantFromDueAlias({ dueAt: "mañana 18:00" }, TZ);
    expect(a?.getTime()).toBe(b?.getTime());
    expect(a).toBeInstanceOf(Date);
  });
});
