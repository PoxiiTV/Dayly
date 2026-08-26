import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { authenticator } from "otplib";
import type { Express } from "express";
import { makeApp, registerAndLogin, createTask } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { absUploadPath } from "../src/lib/uploads.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

afterEach(() => {
  delete process.env.UPLOAD_QUOTA_BYTES;
});

function pngOfSize(n: number): Buffer {
  if (n <= PNG.length) return PNG;
  return Buffer.concat([PNG, Buffer.alloc(n - PNG.length)]);
}

describe("attachment uploads", () => {
  it("rejects MIME spoofing (zip bytes named as png on notes)", async () => {
    const { authed } = await registerAndLogin(app, "mime");
    const n = await authed(app).post("/api/notes").send({ title: "Adjuntos" });
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const spoof = await authed(app)
      .post(`/api/notes/${n.body.note.id}/attachments`)
      .attach("files", zip, { filename: "foto.png", contentType: "image/png" });
    expect(spoof.status).toBe(400);
  });

  it("blocks IDOR: another user cannot read an attachment", async () => {
    const a = await registerAndLogin(app, "idor-a");
    const b = await registerAndLogin(app, "idor-b");
    const n = await a.authed(app).post("/api/notes").send({ title: "Privada" });
    const up = await a.authed(app).post(`/api/notes/${n.body.note.id}/attachments`).attach("files", PNG, "pixel.png");
    expect(up.status).toBe(201);
    const attId = up.body.attachments[0].id as string;
    const stolen = await b.authed(app).get(`/api/notes/${n.body.note.id}/attachments/${attId}`);
    expect(stolen.status).toBe(404);
    const own = await a.authed(app).get(`/api/notes/${n.body.note.id}/attachments/${attId}`);
    expect(own.status).toBe(200);
    expect(own.headers["content-type"]).toMatch(/image\/png/);
  });

  it("enforces user quota across parallel uploads", async () => {
    process.env.UPLOAD_QUOTA_BYTES = String(1.8 * 1024 * 1024);
    const { authed } = await registerAndLogin(app, "quota");
    const task = await createTask(authed, app, "Cupo");
    const fat = pngOfSize(1.2 * 1024 * 1024);
    const [one, two] = await Promise.all([
      authed(app).post(`/api/tasks/${task.id}/attachments`).attach("files", fat, "a.png"),
      authed(app).post(`/api/tasks/${task.id}/attachments`).attach("files", fat, "b.png"),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([201, 400]);
  });
});

describe("JSON payload limit", () => {
  it("rejects login JSON larger than 1 MB with 413", async () => {
    const supertest = (await import("supertest")).default;
    const huge = "x".repeat(1_200_000);
    const r = await supertest(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(`{"email":"a@b.c","password":"${huge}"}`);
    expect(r.status).toBe(413);
  });
});

describe("trash types and disk purge", () => {
  it("rejects plural trash type on restore", async () => {
    const { authed } = await registerAndLogin(app, "trash-type");
    const task = await createTask(authed, app, "Papelera tipo");
    await authed(app).delete(`/api/tasks/${task.id}`);
    const bad = await authed(app).post("/api/trash/restore").send({ type: "tasks", id: task.id });
    expect(bad.status).toBe(400);
  });

  it("emptying trash deletes files from disk", async () => {
    const { authed, userId } = await registerAndLogin(app, "trash-disk");
    const n = await authed(app).post("/api/notes").send({ title: "Con foto" });
    const up = await authed(app).post(`/api/notes/${n.body.note.id}/attachments`).attach("files", PNG, "pixel.png");
    expect(up.status).toBe(201);
    const attId = up.body.attachments[0].id as string;
    const row = await prisma.noteAttachment.findUniqueOrThrow({ where: { id: attId } });
    const full = absUploadPath(row.storageKey);
    expect(existsSync(full)).toBe(true);
    expect((await authed(app).delete(`/api/notes/${n.body.note.id}`)).status).toBe(200);
    expect((await authed(app).delete("/api/trash")).status).toBe(200);
    expect(existsSync(full)).toBe(false);
    expect(await prisma.note.findFirst({ where: { id: n.body.note.id } })).toBeNull();
    expect(path.basename(row.storageKey)).toBe(attId);
    expect(row.storageKey.startsWith(`${userId}/note/`)).toBe(true);
  });
});

describe("2FA step-up", () => {
  it("does not overwrite the active secret and requires password to start setup", async () => {
    const { authed, password } = await registerAndLogin(app, "2fa-step");
    const noPw = await authed(app).post("/api/auth/2fa/setup").send({});
    expect(noPw.status).toBe(401);

    const setup = await authed(app).post("/api/auth/2fa/setup").send({ currentPassword: password });
    expect(setup.status).toBe(200);
    const totp = authenticator.generate(setup.body.secret);
    const en = await authed(app).post("/api/auth/2fa/enable").send({ code: totp });
    expect(en.status).toBe(200);

    const skip = await authed(app).post("/api/auth/2fa/setup").send({ currentPassword: password });
    expect(skip.status).toBe(401);

    const again = await authed(app).post("/api/auth/2fa/setup").send({ code: authenticator.generate(setup.body.secret) });
    expect(again.status).toBe(200);
    expect(again.body.secret).not.toBe(setup.body.secret);

    const stillActive = await authed(app).post("/api/auth/2fa/disable").send({
      code: authenticator.generate(setup.body.secret),
    });
    expect(stillActive.status).toBe(200);
  });
});
