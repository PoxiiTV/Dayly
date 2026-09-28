import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("Quick PIN", () => {
  it("configures, verifies, toggles, changes and deletes the app PIN", async () => {
    const { authed } = await registerAndLogin(app, "quick-pin");

    const initial = await authed(app).get("/api/auth/me");
    expect(initial.status).toBe(200);
    expect(initial.body.user.quickPinEnabled).toBe(false);
    expect(initial.body.user.quickPinConfigured).toBe(false);
    expect(JSON.stringify(initial.body)).not.toContain("quickPinHash");

    const setup = await authed(app).post("/api/auth/quick-pin").send({ pin: "2468" });
    expect(setup.status).toBe(200);

    const enabled = await authed(app).get("/api/auth/me");
    expect(enabled.body.user.quickPinEnabled).toBe(true);
    expect(enabled.body.user.quickPinConfigured).toBe(true);

    expect((await authed(app).post("/api/auth/quick-pin/verify").send({ pin: "0000" })).status).toBe(403);
    expect((await authed(app).post("/api/auth/quick-pin/verify").send({ pin: "2468" })).status).toBe(200);

    expect((await authed(app).patch("/api/auth/quick-pin").send({ enabled: false, currentPin: "0000" })).status).toBe(403);
    expect((await authed(app).patch("/api/auth/quick-pin").send({ enabled: false, currentPin: "2468" })).status).toBe(200);
    expect((await authed(app).patch("/api/auth/quick-pin").send({ enabled: true })).status).toBe(200);

    expect((await authed(app).post("/api/auth/quick-pin").send({ pin: "1357", currentPin: "0000" })).status).toBe(403);
    expect((await authed(app).post("/api/auth/quick-pin").send({ pin: "1357", currentPin: "2468" })).status).toBe(200);
    expect((await authed(app).post("/api/auth/quick-pin/verify").send({ pin: "2468" })).status).toBe(403);
    expect((await authed(app).post("/api/auth/quick-pin/verify").send({ pin: "1357" })).status).toBe(200);

    expect((await authed(app).delete("/api/auth/quick-pin").send({ currentPin: "0000" })).status).toBe(403);
    expect((await authed(app).delete("/api/auth/quick-pin").send({ currentPin: "1357" })).status).toBe(200);

    const deleted = await authed(app).get("/api/auth/me");
    expect(deleted.body.user.quickPinEnabled).toBe(false);
    expect(deleted.body.user.quickPinConfigured).toBe(false);
  });

  it("rejects malformed PINs", async () => {
    const { authed } = await registerAndLogin(app, "quick-pin-validation");
    expect((await authed(app).post("/api/auth/quick-pin").send({ pin: "12ab" })).status).toBe(422);
    expect((await authed(app).post("/api/auth/quick-pin/verify").send({ pin: "123" })).status).toBe(422);
  });
});
