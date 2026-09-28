import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { makeApp } from "./helpers.js";
import { APP_VERSION } from "../src/lib/brand.js";

let app: Express;

beforeAll(async () => {
  app = await makeApp();
});

describe("PWA release recovery", () => {
  it("retires a stale versioned app worker and clears its precache", async () => {
    const response = await supertest(app).get("/sw-0.0.0.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["service-worker-allowed"]).toBe("/");
    expect(response.text).toContain("caches.delete");
    expect(response.text).toContain("registration.unregister");
    expect(response.text).toContain("client.navigate");
  });

  it("does not turn unrelated missing scripts into retirement workers", async () => {
    const response = await supertest(app).get("/assets/missing-release-script.js");
    expect(response.status).toBe(404);
  });

  it("never retires the worker URL for the current release", async () => {
    const response = await supertest(app).get(`/sw-${APP_VERSION}.js`);

    expect([200, 404]).toContain(response.status);
    expect(response.headers["service-worker-allowed"]).toBeUndefined();
    expect(response.text).not.toContain("self.registration.unregister()");
  });
});
