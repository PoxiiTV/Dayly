import { describe, it, expect } from "vitest";
import { isAllowedPushEndpoint } from "../src/lib/pushAllowlist.js";

describe("push endpoint allowlist", () => {
  it("accepts known browser push hosts over https", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/x")).toBe(true);
  });

  it("rejects private, http, and arbitrary URLs (SSRF)", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/push")).toBe(false);
    expect(isAllowedPushEndpoint("not-a-url")).toBe(false);
  });
});
