import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("Web Push", () => {
  it("exposes the VAPID public key without storing the response", async () => {
    const { authed } = await registerAndLogin(app, "push-vapid");
    const res = await authed(app).get("/api/push/vapid");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(Object.keys(res.body)).toEqual(["publicKey"]);
    expect(res.body.publicKey === null || typeof res.body.publicKey === "string").toBe(true);
  });

  it("sends a test push for the signed-in user", async () => {
    const { authed } = await registerAndLogin(app, "push-test");
    const res = await authed(app).post("/api/push/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects anonymous push test and vapid reads", async () => {
    expect((await request(app).get("/api/push/vapid")).status).toBe(401);
    expect((await request(app).post("/api/push/test")).status).toBe(401);
  });
});
