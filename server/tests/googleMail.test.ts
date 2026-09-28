import { describe, expect, it, beforeAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import {
  googleCallbackUri,
  googleOAuthConfigured,
  googleRedirectOrigin,
} from "../src/lib/googleMail.js";
import { prisma } from "../src/lib/prisma.js";

describe("Gmail Google OAuth helpers", () => {
  it("accepts only configured redirect origins", () => {
    expect(googleRedirectOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(googleRedirectOrigin("https://evil.example")).not.toBe("https://evil.example");
  });

  it("builds the callback on the same origin", () => {
    expect(googleCallbackUri("http://localhost:5173")).toBe(
      "http://localhost:5173/api/inbox/mailboxes/google/callback",
    );
  });
});

describe("Gmail Google OAuth routes", () => {
  let app: Express;
  beforeAll(async () => {
    app = await makeApp();
    await prisma.googleOAuthSetting.upsert({
      where: { id: 1 },
      create: { id: 1, enabled: false, clientId: "" },
      update: { enabled: false, clientId: "", clientSecretEnc: null },
    });
  });

  it("reports whether Google is configured and requires auth to start", async () => {
    const { authed } = await registerAndLogin(app, "gmail-oauth");
    const cfg = await authed(app).get("/api/inbox/mailboxes/google/config");
    expect(cfg.status).toBe(200);
    expect(cfg.body.enabled).toBe(await googleOAuthConfigured());

    const anon = await supertest(app).get("/api/inbox/mailboxes/google/start");
    expect(anon.status).toBe(401);

    if (!await googleOAuthConfigured()) {
      const start = await authed(app).get("/api/inbox/mailboxes/google/start");
      expect(start.status).toBe(400);
    }
  });
});
