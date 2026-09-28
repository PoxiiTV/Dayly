import { describe, it, expect } from "vitest";
import { normalizeOpenCodeSessionId, opencodeRequestHeaders } from "../src/lib/mascot/client.js";
import { APP_NAME, APP_VERSION } from "../src/lib/brand.js";

describe("OpenCode session headers", () => {
  it("envía User-Agent y x-opencode-session estables", () => {
    const headers = opencodeRequestHeaders("kalendiario-chat-abc12345");
    expect(headers["User-Agent"]).toBe(`${APP_NAME}/${APP_VERSION}`);
    expect(headers["x-opencode-session"]).toBe("kalendiario-chat-abc12345");
  });

  it("rechaza ids raros y genera uno válido", () => {
    const a = normalizeOpenCodeSessionId("no");
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(normalizeOpenCodeSessionId("ok-session-01", "ignored")).toBe("ok-session-01");
    expect(normalizeOpenCodeSessionId("bad!", "fallback-session-99")).toBe("fallback-session-99");
  });
});
