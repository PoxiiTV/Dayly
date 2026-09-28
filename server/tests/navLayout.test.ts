import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import supertest from "supertest";
import { adminCookie, makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("sidebar layout", () => {
  let app: Express;
  beforeAll(async () => { app = await makeApp(); });

  it("travels with the account and rejects anything but ids", async () => {
    const user = await registerAndLogin(app, "layout1");
    const saved = await user.authed(app).patch("/api/users/me/preferences").send({
      navLayout: { order: ["/tasks", "/"], hidden: ["/trash"], apps: ["vault", "chat"], mascotSidebar: false, chatSidebar: true },
    });
    expect(saved.status).toBe(200);

    // A second device reads it straight from /me, no local storage involved.
    const me = await user.authed(app).get("/api/users/me");
    expect(me.body.user.navLayout).toEqual({ order: ["/tasks", "/"], hidden: ["/trash"], apps: ["vault", "chat"], mascotSidebar: false, chatSidebar: true });

    const bogus = await user.authed(app).patch("/api/users/me/preferences")
      .send({ navLayout: { order: [{ evil: true }] } });
    expect(bogus.status).toBe(422);
  });
});

describe("gif provider settings", () => {
  let app: Express;
  beforeAll(async () => { app = await makeApp(); });

  it("stores the keys without ever handing them back", async () => {
    const cookie = await adminCookie(app);
    const as = (method: "get" | "patch", path: string) => supertest(app)[method](path).set("Cookie", cookie);

    // Nothing configured yet: the switch cannot be turned on.
    await prisma.gifSetting.deleteMany({ where: { id: 1 } });
    const empty = await as("patch", "/api/admin/gif").send({ enabled: true });
    expect(empty.status).toBe(400);

    const saved = await as("patch", "/api/admin/gif").send({ enabled: true, giphyKey: "giphy-secret-key" });
    expect(saved.status).toBe(200);
    expect(saved.body.gif).toMatchObject({ enabled: true, hasGiphyKey: true, hasKlipyKey: false });
    expect(JSON.stringify(saved.body)).not.toContain("giphy-secret-key");

    // An omitted key keeps the stored one; the other provider can be added later.
    const both = await as("patch", "/api/admin/gif").send({ enabled: true, klipyKey: "klipy-secret-key" });
    expect(both.body.gif).toMatchObject({ hasGiphyKey: true, hasKlipyKey: true });

    const read = await as("get", "/api/admin/gif");
    expect(JSON.stringify(read.body)).not.toContain("secret-key");
  });
});
