import { describe, expect, it } from "vitest";
import { rateLimitKey, shouldSkipGlobalRateLimit } from "../src/middleware/rateLimit.js";

describe("rate limit bucketing", () => {
  it("gives each session its own bucket, whatever the address", () => {
    const one = rateLimitKey({ cookies: { dayly_session: "token-a" }, ip: "83.45.1.1" });
    const other = rateLimitKey({ cookies: { dayly_session: "token-b" }, ip: "83.45.1.1" });
    expect(one).not.toBe(other);
  });

  it("keeps the same bucket for one session across addresses", () => {
    const wifi = rateLimitKey({ cookies: { dayly_session: "token-a" }, ip: "83.45.1.1" });
    const mobile = rateLimitKey({ cookies: { dayly_session: "token-a" }, ip: "10.0.0.9" });
    expect(wifi).toBe(mobile);
  });

  it("never puts the session token itself in the key", () => {
    expect(rateLimitKey({ cookies: { dayly_session: "super-secret" }, ip: "1.2.3.4" }))
      .not.toContain("super-secret");
  });

  it("falls back to the address when there is no session", () => {
    expect(rateLimitKey({ cookies: {}, ip: "1.2.3.4" })).toBe("i:1.2.3.4");
  });

  it("collapses IPv6 to its /64, so one subscriber is one bucket", () => {
    const first = rateLimitKey({ ip: "2001:db8:1234:5678:aaaa:bbbb:cccc:dddd" });
    const second = rateLimitKey({ ip: "2001:db8:1234:5678:1111:2222:3333:4444" });
    expect(first).toBe(second);
  });

  it("exempts the endpoints the chat keeps open or polls", () => {
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/chat/events" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/chat/sync" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/chat/friends" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/chat/threads/abc/messages" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/auth/me" })).toBe(true);
  });

  it("still counts everything that writes", () => {
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/chat/threads/abc/messages" })).toBe(false);
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/tasks" })).toBe(false);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/tasks" })).toBe(false);
  });
});
