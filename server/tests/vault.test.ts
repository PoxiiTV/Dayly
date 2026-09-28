import { describe, it, expect, beforeAll } from "vitest";
import { authenticator } from "otplib";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { assertNoPlaintextSecrets, isVaultBlob } from "../src/lib/vault.js";
import { ApiError } from "../src/lib/errors.js";
import { shouldSkipGlobalRateLimit } from "../src/middleware/rateLimit.js";
import { prisma } from "../src/lib/prisma.js";

function blob(fill = 7) {
  return {
    nonce: Buffer.alloc(12, fill).toString("base64url"),
    ciphertext: Buffer.alloc(48, fill + 1).toString("base64url"),
  };
}

async function enableTotp(agent: ReturnType<typeof supertest.agent>, password: string) {
  const setup = await agent.post("/api/auth/2fa/setup").send({ currentPassword: password });
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  const totp = authenticator.generate(secret);
  const en = await agent.post("/api/auth/2fa/enable").send({ code: totp });
  expect(en.status).toBe(200);
  return secret;
}

describe("vault lib (plaintext denylist)", () => {
  it("rejects password/username/title in the body", () => {
    expect(() => assertNoPlaintextSecrets({ password: "hunter2" })).toThrow(ApiError);
    expect(() => assertNoPlaintextSecrets({ username: "ada" })).toThrow(ApiError);
    expect(() => assertNoPlaintextSecrets({ title: "Banco" })).toThrow(ApiError);
    expect(() => assertNoPlaintextSecrets({ notes: "pin 1234" })).toThrow(ApiError);
    expect(() => assertNoPlaintextSecrets({ otpSecret: "JBSWY3DPEHPK3PXP" })).toThrow(ApiError);
    expect(() => assertNoPlaintextSecrets({ folder: "Trabajo" })).toThrow(ApiError);
    try {
      assertNoPlaintextSecrets({ password: "x" });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(400);
    }
  });

  it("allows encrypted blobs", () => {
    const b = blob();
    expect(() => assertNoPlaintextSecrets({ nonce: b.nonce, ciphertext: b.ciphertext, version: 1 })).not.toThrow();
    expect(isVaultBlob(b.nonce, b.ciphertext)).toBe(true);
    expect(isVaultBlob("short", b.ciphertext)).toBe(false);
  });

  it("does not count vault batch import or session checks against the global limiter", () => {
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/vault/items/delete" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/vault/items/import" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/vault/import" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/vault/rekey" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/auth/me" })).toBe(true);
    expect(shouldSkipGlobalRateLimit({ method: "POST", path: "/api/vault/items" })).toBe(false);
    expect(shouldSkipGlobalRateLimit({ method: "GET", path: "/api/vault/items" })).toBe(false);
  });
});

describe("Vault API", () => {
  let app: Express;
  beforeAll(async () => {
    app = await makeApp();
  });

  it("requires auth and never returns salt on GET /api/vault", async () => {
    const anon = await supertest(app).get("/api/vault");
    expect(anon.status).toBe(401);

    const { authed } = await registerAndLogin(app, "vlt-get");
    const r = await authed(app).get("/api/vault");
    expect(r.status).toBe(200);
    expect(r.body.exists).toBe(false);
    expect(r.body.unlocked).toBe(false);
    expect(r.body.twoFactorEnabled).toBe(false);
    expect(typeof r.body.emailOtpRequired).toBe("boolean");
    expect(r.body.salt).toBeUndefined();
    expect(r.body.checkCipher).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/password|ciphertext/i);
  });

  it("refuses setup without 2FA", async () => {
    const { authed } = await registerAndLogin(app, "vlt-no2fa");
    const check = blob(3);
    const r = await authed(app).post("/api/vault/setup").send({
      twoFactorCode: "123456",
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt: Buffer.alloc(16, 9).toString("base64url"),
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
    });
    expect(r.status).toBe(403);
  });

  it("rejects plaintext secrets on setup and items (strict + denylist)", async () => {
    const { email, password } = await registerAndLogin(app, "vlt-plain");
    const agent = supertest.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const secret = await enableTotp(agent, password);
    const totp = authenticator.generate(secret);

    const extra = await agent.post("/api/vault/setup").send({
      twoFactorCode: totp,
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt: Buffer.alloc(16, 1).toString("base64url"),
      checkNonce: blob(1).nonce,
      checkCipher: blob(1).ciphertext,
      password: "SuperSecret1",
    });
    expect(extra.status).toBe(422);

    const onlyPlain = await agent.post("/api/vault/items").send({
      title: "Gmail",
      username: "ada@example.com",
      password: "hunter2hunter2",
    });
    expect([400, 403, 422]).toContain(onlyPlain.status);
    expect(JSON.stringify(onlyPlain.body)).not.toMatch(/hunter2/);
  });

  it("stores only blobs after TOTP unlock and search/export never see them", async () => {
    const { email, password } = await registerAndLogin(app, "vlt-flow");
    const agent = supertest.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const secret = await enableTotp(agent, password);

    const check = blob(4);
    const salt = Buffer.alloc(16, 4).toString("base64url");
    const setup = await agent.post("/api/vault/setup").send({
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt,
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
    });
    expect(setup.status).toBe(201);
    expect(setup.body.salt).toBe(salt);
    expect(setup.headers["set-cookie"]?.some((c: string) => c.startsWith("dayly_vault="))).toBe(true);

    const status = await agent.get("/api/vault");
    expect(status.body.exists).toBe(true);
    expect(status.body.unlocked).toBe(true);
    expect(status.body.salt).toBe(salt);
    expect(status.body.checkCipher).toBe(check.ciphertext);
    expect(status.body.password).toBeUndefined();

    const itemBlob = blob(8);
    const created = await agent.post("/api/vault/items").send({ ...itemBlob, version: 1 });
    expect(created.status).toBe(201);
    expect(created.body.item.nonce).toBe(itemBlob.nonce);
    expect(created.body.item.ciphertext).toBe(itemBlob.ciphertext);
    expect(created.body.item.password).toBeUndefined();
    expect(created.body.item.title).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toMatch(/hunter2|Gmail|plaintext/i);

    const listed = await agent.get("/api/vault/items");
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].ciphertext).toBe(itemBlob.ciphertext);

    const patched = blob(9);
    const upd = await agent.patch(`/api/vault/items/${listed.body.items[0].id}`).send({ ...patched, password: "nope" });
    expect(upd.status).toBe(422);

    const updOk = await agent.patch(`/api/vault/items/${listed.body.items[0].id}`).send(patched);
    expect(updOk.status).toBe(200);
    expect(updOk.body.item.ciphertext).toBe(patched.ciphertext);

    const search = await agent.get("/api/search").query({ q: "Gmail" });
    expect(search.status).toBe(200);
    expect(search.body.vault).toBeUndefined();
    expect(search.body.vaultItems).toBeUndefined();
    expect(JSON.stringify(search.body)).not.toContain(patched.ciphertext);

    const exported = await agent.get("/api/transfer/export").query({ format: "json", types: "tasks,events,notes" });
    expect(exported.status).toBe(200);
    const exportText = typeof exported.text === "string" ? exported.text : JSON.stringify(exported.body);
    expect(exportText).not.toContain(patched.ciphertext);
    expect(exportText.toLowerCase()).not.toContain("vaultitem");

    await agent.post("/api/vault/lock");
    const locked = await agent.get("/api/vault/items");
    expect(locked.status).toBe(403);
    const lockedStatus = await agent.get("/api/vault");
    expect(lockedStatus.body.unlocked).toBe(false);
    expect(lockedStatus.body.salt).toBeUndefined();

    const badTotp = await agent.post("/api/vault/unlock").send({ twoFactorCode: "000000" });
    expect(badTotp.status).toBe(403);
    const stillIn = await agent.get("/api/auth/me");
    expect(stillIn.status).toBe(200);

    const unlock = await agent.post("/api/vault/unlock").send({ twoFactorCode: authenticator.generate(secret) });
    expect(unlock.status).toBe(200);
    expect(unlock.body.needsEmailOtp).toBe(false);
    expect(unlock.body.salt).toBe(salt);
    expect(unlock.body.password).toBeUndefined();
    expect(unlock.body.emailCode).toBeUndefined();

    const backup = await agent.get("/api/vault/backup");
    expect(backup.status).toBe(200);
    expect(backup.body.kind).toBe("kalendiario-cofre");
    expect(backup.body.salt).toBe(salt);
    expect(backup.body.items[0].ciphertext).toBe(patched.ciphertext);
    expect(JSON.stringify(backup.body)).not.toMatch(/hunter2|"title"|"password":"x"/i);

    const del = await agent.delete(`/api/vault/items/${listed.body.items[0].id}`);
    expect(del.status).toBe(200);
    const empty = await agent.get("/api/vault/items");
    expect(empty.body.items).toHaveLength(0);

    await agent.post("/api/auth/logout");
    const afterLogout = await agent.get("/api/vault");
    expect(afterLogout.status).toBe(401);
  });

  it("imports many ciphertext blobs in one request and rejects plaintext", async () => {
    const { email, password } = await registerAndLogin(app, "vlt-bulk");
    const agent = supertest.agent(app);
    expect((await agent.post("/api/auth/login").send({ email, password })).status).toBe(200);
    const secret = await enableTotp(agent, password);
    const check = blob(20);
    expect((await agent.post("/api/vault/setup").send({
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt: Buffer.alloc(16, 20).toString("base64url"),
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
    })).status).toBe(201);

    const locked = await agent.post("/api/vault/lock");
    expect(locked.status).toBe(200);
    const denied = await agent.post("/api/vault/items/import").send({ items: [{ ...blob(21), version: 1 }] });
    expect(denied.status).toBe(403);

    expect((await agent.post("/api/vault/unlock").send({ twoFactorCode: authenticator.generate(secret) })).status).toBe(200);

    const stillPlain = await agent.post("/api/vault/items/import").send({
      items: [{ title: "Gmail", username: "ada", password: "hunter2hunter2" }],
    });
    expect([400, 422]).toContain(stillPlain.status);
    expect(JSON.stringify(stillPlain.body)).not.toMatch(/hunter2/);

    const batch = Array.from({ length: 40 }, (_, i) => blob(30 + i));
    const imported = await agent.post("/api/vault/items/import").send({
      items: batch.map((item) => ({ ...item, version: 1 })),
    });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(40);
    expect(imported.body.skipped).toBe(0);
    expect(imported.body.items).toBeUndefined();
    const listed = await agent.get("/api/vault/items");
    expect(listed.body.items).toHaveLength(40);
    expect(listed.body.items.map((row: { ciphertext: string }) => row.ciphertext)).toEqual(
      expect.arrayContaining(batch.map((item) => item.ciphertext)),
    );
    expect(JSON.stringify(listed.body)).not.toMatch(/hunter2|Gmail/i);

    const toDelete = listed.body.items.slice(0, 5).map((row: { id: string }) => row.id);
    const removed = await agent.post("/api/vault/items/delete").send({ ids: toDelete });
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(5);
    expect((await agent.get("/api/vault/items")).body.items).toHaveLength(35);

    await agent.post("/api/vault/lock");
    const deniedDelete = await agent.post("/api/vault/items/delete").send({ ids: toDelete });
    expect(deniedDelete.status).toBe(403);
  });

  it("requires email OTP after TOTP when SMTP is configured, without logging out", async () => {
    const previous = await prisma.smtpSetting.findUnique({ where: { id: 1 } });
    await prisma.smtpSetting.upsert({
      where: { id: 1 },
      create: { id: 1, host: "", port: 587, username: "", passwordEnc: null, fromAddress: "test@dayly.test" },
      update: { host: "", port: 587, username: "", passwordEnc: null, fromAddress: "test@dayly.test" },
    });
    try {
      const { email, password, userId } = await registerAndLogin(app, "vlt-mail");
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await prisma.smtpSetting.update({ where: { id: 1 }, data: { host: "smtp.test.local" } });
      const agent = supertest.agent(app);
      expect((await agent.post("/api/auth/login").send({ email, password })).status).toBe(200);
      const secret = await enableTotp(agent, password);
      const check = blob(5);
      const setup = await agent.post("/api/vault/setup").send({
        twoFactorCode: authenticator.generate(secret),
        kdf: "pbkdf2-sha256",
        kdfIterations: 600_000,
        salt: Buffer.alloc(16, 5).toString("base64url"),
        checkNonce: check.nonce,
        checkCipher: check.ciphertext,
      });
      expect(setup.status).toBe(201);
      await agent.post("/api/vault/lock");

      const first = await agent.post("/api/vault/unlock").send({ twoFactorCode: authenticator.generate(secret) });
      expect(first.status).toBe(200);
      expect(first.body.needsEmailOtp).toBe(true);
      expect(first.body.salt).toBeUndefined();
      expect(typeof first.body.emailCode).toBe("string");
      expect(first.body.emailCode).toMatch(/^\d{6}$/);

      const locked = await agent.get("/api/vault/items");
      expect(locked.status).toBe(403);

      const badMail = await agent.post("/api/vault/unlock/email").send({ emailCode: "000000" });
      expect(badMail.status).toBe(403);
      expect((await agent.get("/api/auth/me")).status).toBe(200);

      const confirm = await agent.post("/api/vault/unlock/email").send({ emailCode: first.body.emailCode });
      expect(confirm.status).toBe(200);
      expect(confirm.body.needsEmailOtp).toBe(false);
      expect(confirm.body.salt).toBeDefined();
      expect((await agent.get("/api/vault/items")).status).toBe(200);
    } finally {
      if (previous) {
        await prisma.smtpSetting.update({ where: { id: 1 }, data: { host: previous.host, port: previous.port, username: previous.username, passwordEnc: previous.passwordEnc, fromAddress: previous.fromAddress } });
      } else {
        await prisma.smtpSetting.deleteMany({ where: { id: 1 } });
      }
    }
  });

  it("imports a ciphertext backup without plaintext and rejects a second vault", async () => {
    const { email, password } = await registerAndLogin(app, "vlt-imp");
    const agent = supertest.agent(app);
    expect((await agent.post("/api/auth/login").send({ email, password })).status).toBe(200);
    const secret = await enableTotp(agent, password);
    const check = blob(6);
    const item = blob(11);
    const payload = {
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256" as const,
      kdfIterations: 600_000,
      salt: Buffer.alloc(16, 6).toString("base64url"),
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
      items: [{ ...item, version: 1 }],
    };
    const extra = await agent.post("/api/vault/import").send({ ...payload, password: "SuperSecret1" });
    expect(extra.status).toBe(422);

    const imported = await agent.post("/api/vault/import").send(payload);
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(1);
    const listed = await agent.get("/api/vault/items");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].ciphertext).toBe(item.ciphertext);

    const again = await agent.post("/api/vault/import").send({
      ...payload,
      twoFactorCode: authenticator.generate(secret),
    });
    expect(again.status).toBe(409);
  });

  it("rekeys all blobs after TOTP and keeps the session", async () => {
    const { email, password } = await registerAndLogin(app, "vlt-rekey");
    const agent = supertest.agent(app);
    expect((await agent.post("/api/auth/login").send({ email, password })).status).toBe(200);
    const secret = await enableTotp(agent, password);
    const check = blob(7);
    const salt = Buffer.alloc(16, 7).toString("base64url");
    expect((await agent.post("/api/vault/setup").send({
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt,
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
    })).status).toBe(201);
    const item = blob(8);
    const created = await agent.post("/api/vault/items").send({ ...item, version: 1 });
    expect(created.status).toBe(201);

    const plain = await agent.post("/api/vault/rekey").send({
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt: Buffer.alloc(16, 8).toString("base64url"),
      checkNonce: blob(9).nonce,
      checkCipher: blob(9).ciphertext,
      items: [{ id: created.body.item.id, ...blob(10), version: 1 }],
      password: "NuevaClave12",
    });
    expect(plain.status).toBe(422);

    const nextCheck = blob(11);
    const nextItem = blob(12);
    const nextSalt = Buffer.alloc(16, 11).toString("base64url");
    const rekey = await agent.post("/api/vault/rekey").send({
      twoFactorCode: authenticator.generate(secret),
      kdf: "pbkdf2-sha256",
      kdfIterations: 600_000,
      salt: nextSalt,
      checkNonce: nextCheck.nonce,
      checkCipher: nextCheck.ciphertext,
      items: [{ id: created.body.item.id, ...nextItem, version: 1 }],
    });
    expect(rekey.status).toBe(200);
    expect(rekey.body.salt).toBe(nextSalt);
    expect(rekey.body.password).toBeUndefined();

    const status = await agent.get("/api/vault");
    expect(status.body.salt).toBe(nextSalt);
    const listed = await agent.get("/api/vault/items");
    expect(listed.status).toBe(200);
    expect(listed.body.items[0].ciphertext).toBe(nextItem.ciphertext);
    expect(JSON.stringify(listed.body)).not.toMatch(/NuevaClave|Trabajo/i);
  });
});
