import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { SHELL_VERSION } from "../src/lib/brand.js";
import { WINDOWS_UPDATER_SIGNATURE_FILE } from "../src/lib/installers.js";
import { ensureRolesAndAdmin } from "../src/bootstrap/ensureAdmin.js";

let app: Express;
const createdDirs: string[] = [];

beforeAll(async () => {
  await ensureRolesAndAdmin();
  app = await makeApp();
});

afterEach(() => {
  delete process.env.DOWNLOADS_DIR;
  while (createdDirs.length) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDownloads(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dayly-downloads-"));
  createdDirs.push(dir);
  process.env.DOWNLOADS_DIR = dir;
  return dir;
}

function downloadBytes(res: { body: unknown; text?: string }): Buffer {
  if (Buffer.isBuffer(res.body)) return res.body;
  if (typeof res.body === "string") return Buffer.from(res.body);
  if (typeof res.text === "string") return Buffer.from(res.text);
  throw new Error("la descarga no devolvió bytes");
}

describe("GET /api/app/installers", () => {
  it("rejects anonymous callers with 401", async () => {
    const r = await supertest(app).get("/api/app/installers");
    expect(r.status).toBe(401);
  });

  it("returns shell version and null platforms when no binaries exist", async () => {
    tempDownloads();
    const { authed } = await registerAndLogin(app, "inst-empty");
    const r = await authed(app).get("/api/app/installers");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      shellVersion: SHELL_VERSION,
      windows: null,
      android: null,
    });
  });

  it("exposes windows metadata and serves the file under session", async () => {
    const dir = tempDownloads();
    const bytes = Buffer.from("dayly-windows-installer-fixture");
    writeFileSync(path.join(dir, "dayly-windows.exe"), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { authed } = await registerAndLogin(app, "inst-win");

    const meta = await authed(app).get("/api/app/installers");
    expect(meta.status).toBe(200);
    expect(meta.body.windows).toEqual({
      url: "/api/app/installers/windows",
      size: bytes.length,
      sha256,
    });
    expect(meta.body.android).toBeNull();

    const file = await authed(app).get("/api/app/installers/windows").buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toMatch(/Dayly-Setup\.exe/);
    expect(downloadBytes(file)).toEqual(bytes);
  });

  it("exposes android metadata and download when the apk is present", async () => {
    const dir = tempDownloads();
    const bytes = Buffer.from("dayly-android-apk-fixture");
    writeFileSync(path.join(dir, "dayly.apk"), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { authed } = await registerAndLogin(app, "inst-apk");

    const meta = await authed(app).get("/api/app/installers");
    expect(meta.status).toBe(200);
    expect(meta.body.android).toEqual({
      url: "/api/app/installers/android",
      size: bytes.length,
      sha256,
    });

    const file = await authed(app).get("/api/app/installers/android").buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toMatch(/Dayly\.apk/);
    expect(downloadBytes(file)).toEqual(bytes);
  });

  it("returns 404 for a missing binary and an unknown platform", async () => {
    tempDownloads();
    const { authed } = await registerAndLogin(app, "inst-404");
    expect((await authed(app).get("/api/app/installers/windows")).status).toBe(404);
    expect((await authed(app).get("/api/app/installers/linux")).status).toBe(404);
  });

  it("does not let an unauthenticated client download a present installer", async () => {
    const dir = tempDownloads();
    writeFileSync(path.join(dir, "dayly-windows.exe"), Buffer.from("secret-exe"));
    const r = await supertest(app).get("/api/app/installers/windows");
    expect(r.status).toBe(401);
  });
});

describe("GET /api/app/updater", () => {
  it("returns no update for the current version or unsupported targets", async () => {
    tempDownloads();
    expect((await supertest(app).get(`/api/app/updater/windows/x86_64/${SHELL_VERSION}`)).status).toBe(204);
    expect((await supertest(app).get("/api/app/updater/linux/x86_64/0.0.1")).status).toBe(204);
    expect((await supertest(app).get("/api/app/updater/windows/x86_64/not-a-version")).status).toBe(204);
  });

  it("publishes signed Windows update metadata and bytes without a web session", async () => {
    const dir = tempDownloads();
    const bytes = Buffer.from("signed-dayly-updater-fixture");
    const signature = "trusted-minisign-fixture";
    writeFileSync(path.join(dir, "dayly-windows.exe"), bytes);
    writeFileSync(path.join(dir, WINDOWS_UPDATER_SIGNATURE_FILE), signature);

    const meta = await supertest(app).get("/api/app/updater/windows/x86_64/0.0.1");
    expect(meta.status).toBe(200);
    expect(meta.headers["cache-control"]).toContain("no-store");
    expect(meta.body).toMatchObject({
      version: SHELL_VERSION,
      signature,
      notes: expect.any(String),
    });
    expect(meta.body.url).toMatch(new RegExp(`/api/app/updater/download/windows/${SHELL_VERSION}$`));

    const file = await supertest(app).get(`/api/app/updater/download/windows/${SHELL_VERSION}`).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain(`Dayly-Setup-${SHELL_VERSION}.exe`);
    expect(downloadBytes(file)).toEqual(bytes);
  });

  it("does not advertise or serve an unsigned updater artifact", async () => {
    const dir = tempDownloads();
    writeFileSync(path.join(dir, "dayly-windows.exe"), Buffer.from("unsigned"));
    expect((await supertest(app).get("/api/app/updater/windows/x86_64/0.0.1")).status).toBe(204);
    expect((await supertest(app).get(`/api/app/updater/download/windows/${SHELL_VERSION}`)).status).toBe(404);
  });
});
