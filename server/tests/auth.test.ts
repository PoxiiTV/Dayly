import { describe, it, expect, beforeAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("Auth", () => {
  it("registers and logs in returning a session cookie", async () => {
    const { authed, email } = await registerAndLogin(app, "auth");
    const me = await authed(app).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it("rejects wrong password with 401", async () => {
    const { email } = await registerAndLogin(app, "auth2");
    const r = await supertest(app).post("/api/auth/login").send({ email, password: "wrongpass" });
    expect(r.status).toBe(401);
  });

  it("rejects short password on register (policy)", async () => {
    const r = await supertest(app).post("/api/auth/register").send({ name: "X", email: `weak-${Date.now()}@d.test`, password: "a" });
    expect(r.status).toBe(422);
  });

  it("prevents duplicate registration (same email)", async () => {
    const { email } = await registerAndLogin(app, "dup");
    const r = await supertest(app).post("/api/auth/register").send({ name: "Y", email, password: "Passw0rdTest123" });
    expect(r.status).toBe(409);
  });

  it("does NOT leak password hash in /me response", async () => {
    const { authed } = await registerAndLogin(app, "leak");
    const r = await authed(app).get("/api/auth/me");
    const body = JSON.stringify(r.body);
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("$argon2");
    expect(body).not.toContain("twoFactorSecret");
  });

  it("requires auth for protected routes (401 when no cookie)", async () => {
    const r = await supertest(app).get("/api/tasks");
    expect(r.status).toBe(401);
  });

  it("logs out and invalidates the session", async () => {
    const { authed } = await registerAndLogin(app, "logout");
    const out = await authed(app).post("/api/auth/logout");
    expect(out.status).toBe(200);
    const after = await authed(app).get("/api/auth/me");
    expect(after.status).toBe(401);
  });

  it("rejects invalid IDs/schema on create (422)", async () => {
    const { authed } = await registerAndLogin(app, "val");
    const r = await authed(app).post("/api/tasks").send({ title: "" });
    expect(r.status).toBe(422);
    // malicious title shape
    const r2 = await authed(app).post("/api/tasks").send({ title: { $gt: "" } });
    expect(r2.status).toBe(422);
  });
});