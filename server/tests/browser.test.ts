import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

type Account = Awaited<ReturnType<typeof registerAndLogin>>;

function save(account: Account, url: string, title?: string) {
  return account.authed(app).post("/api/browser/bookmarks").send({ url, ...(title ? { title } : {}) });
}

function visit(account: Account, url: string, title?: string) {
  return account.authed(app).post("/api/browser/history").send({ url, ...(title ? { title } : {}) });
}

describe("Browser bookmarks", () => {
  it("saves a page, lists it and drops it", async () => {
    const user = await registerAndLogin(app, "bm1");
    const created = await save(user, "https://news.ycombinator.com", "HN");
    expect(created.status).toBe(201);
    expect(created.body.bookmark.url).toBe("https://news.ycombinator.com");
    expect(created.body.bookmark.title).toBe("HN");

    const list = await user.authed(app).get("/api/browser/bookmarks");
    expect(list.body.bookmarks).toHaveLength(1);

    expect((await user.authed(app).delete(`/api/browser/bookmarks/${created.body.bookmark.id}`)).status).toBe(200);
    expect((await user.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(0);
  });

  it("starring the same page twice keeps one row", async () => {
    const user = await registerAndLogin(app, "bm2");
    const first = await save(user, "https://example.com/a");
    // The trailing slash and the fragment are the same page.
    const again = await save(user, "https://example.com/a#top");
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.bookmark.id).toBe(first.body.bookmark.id);
    expect((await user.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(1);
  });

  it("refuses anything that is not public HTTPS", async () => {
    const user = await registerAndLogin(app, "bm3");
    for (const url of ["http://example.com", "https://localhost/x", "https://192.168.1.10", "file:///c:/x"]) {
      expect((await save(user, url)).status).toBe(422);
    }
    expect((await user.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(0);
  });

  it("stops at 200 and says so instead of dropping one", async () => {
    const user = await registerAndLogin(app, "bm4");
    for (let n = 0; n < 200; n += 1) {
      expect((await save(user, `https://example.com/p${n}`)).status).toBe(201);
    }
    const full = await save(user, "https://example.com/one-more");
    expect(full.status).toBe(409);
    expect((await user.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(200);
  });

  it("keeps one account out of another's bookmarks", async () => {
    const mine = await registerAndLogin(app, "bm5");
    const other = await registerAndLogin(app, "bm6");
    const created = await save(mine, "https://example.com/private");

    expect((await other.authed(app).delete(`/api/browser/bookmarks/${created.body.bookmark.id}`)).status).toBe(404);
    expect((await other.authed(app).patch(`/api/browser/bookmarks/${created.body.bookmark.id}`).send({ title: "mío" })).status).toBe(404);
    expect((await other.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(0);
    expect((await mine.authed(app).get("/api/browser/bookmarks")).body.bookmarks).toHaveLength(1);
  });

  it("never writes the address in the clear", async () => {
    const user = await registerAndLogin(app, "bm7");
    await save(user, "https://un-sitio-muy-concreto.example/ruta", "Un título");
    const row = await prisma.browserBookmark.findFirstOrThrow({ where: { userId: user.userId } });
    expect(row.urlEnc).not.toContain("un-sitio-muy-concreto");
    expect(row.titleEnc ?? "").not.toContain("título");
    // The index is a hash, not the address.
    expect(row.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Browser history", () => {
  it("counts repeated visits on one row", async () => {
    const user = await registerAndLogin(app, "bh1");
    expect((await visit(user, "https://example.com/x", "X")).body.recorded).toBe(true);
    await visit(user, "https://example.com/x");

    const list = await user.authed(app).get("/api/browser/history");
    expect(list.body.visits).toHaveLength(1);
    expect(list.body.visits[0].visits).toBe(2);
    // A later visit with no title does not wipe the one it had.
    expect(list.body.visits[0].title).toBe("X");
  });

  it("writes nothing while the switch is off", async () => {
    const user = await registerAndLogin(app, "bh2");
    expect((await user.authed(app).patch("/api/browser/settings").send({ historyEnabled: false })).status).toBe(200);
    expect((await visit(user, "https://example.com/secreto")).body.recorded).toBe(false);
    expect((await user.authed(app).get("/api/browser/history")).body.visits).toHaveLength(0);
    expect(await prisma.browserVisit.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("keeps the newest 500 and forgets the rest", async () => {
    const user = await registerAndLogin(app, "bh3");
    for (let n = 0; n < 505; n += 1) {
      await visit(user, `https://example.com/h${n}`);
    }
    expect(await prisma.browserVisit.count({ where: { userId: user.userId } })).toBe(500);
    const list = await user.authed(app).get("/api/browser/history?limit=1");
    expect(list.body.visits[0].url).toBe("https://example.com/h504");
  });

  it("clears the lot, and one entry at a time", async () => {
    const user = await registerAndLogin(app, "bh4");
    await visit(user, "https://example.com/uno");
    await visit(user, "https://example.com/dos");
    const list = await user.authed(app).get("/api/browser/history");
    expect((await user.authed(app).delete(`/api/browser/history/${list.body.visits[0].id}`)).status).toBe(200);
    expect((await user.authed(app).get("/api/browser/history")).body.visits).toHaveLength(1);

    expect((await user.authed(app).delete("/api/browser/history")).body.removed).toBe(1);
    expect((await user.authed(app).get("/api/browser/history")).body.visits).toHaveLength(0);
  });
});

describe("Browser settings", () => {
  it("remembers the home page with the account", async () => {
    const user = await registerAndLogin(app, "bs1");
    expect((await user.authed(app).get("/api/browser/settings")).body.settings).toEqual({ historyEnabled: true, homeUrl: null });

    const saved = await user.authed(app).patch("/api/browser/settings").send({ homeUrl: "https://tu-dominio.example" });
    expect(saved.status).toBe(200);
    expect((await user.authed(app).get("/api/browser/settings")).body.settings.homeUrl).toBe("https://tu-dominio.example");

    // Null puts the default search page back.
    await user.authed(app).patch("/api/browser/settings").send({ homeUrl: null });
    expect((await user.authed(app).get("/api/browser/settings")).body.settings.homeUrl).toBeNull();
  });

  it("refuses a home page that is not public HTTPS", async () => {
    const user = await registerAndLogin(app, "bs2");
    expect((await user.authed(app).patch("/api/browser/settings").send({ homeUrl: "http://192.168.1.5" })).status).toBe(422);
  });

  it("asks for a session like everything else", async () => {
    const app2 = app;
    const { default: request } = await import("supertest");
    expect((await request(app2).get("/api/browser/bookmarks")).status).toBe(401);
    expect((await request(app2).get("/api/browser/history")).status).toBe(401);
  });
});
