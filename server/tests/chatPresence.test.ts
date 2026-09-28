import { describe, expect, it } from "vitest";
import { isQuietStatus, parseChatStatus, presenceOf, PRESENCE_FRESH_MS } from "../src/lib/chat/presence.js";

describe("chat presence", () => {
  it("falls back to online for anything it does not know", () => {
    expect(parseChatStatus("BUSY")).toBe("BUSY");
    expect(parseChatStatus("INVISIBLE")).toBe("ONLINE");
    expect(parseChatStatus(null)).toBe("ONLINE");
  });

  it("reports the picked state only while that client is alive", () => {
    const now = Date.now();
    expect(presenceOf({ chatStatus: "AWAY", chatSeenAt: new Date(now - 1000) }, now)).toBe("AWAY");
    expect(presenceOf({ chatStatus: "AWAY", chatSeenAt: new Date(now - PRESENCE_FRESH_MS - 1) }, now)).toBe("OFFLINE");
    expect(presenceOf({ chatStatus: "ONLINE", chatSeenAt: null }, now)).toBe("OFFLINE");
  });

  it("only 'no disponible' asks for quiet", () => {
    expect(isQuietStatus("BUSY")).toBe(true);
    expect(isQuietStatus("AWAY")).toBe(false);
    expect(isQuietStatus("ONLINE")).toBe(false);
  });
});
