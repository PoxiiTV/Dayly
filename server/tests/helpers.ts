import supertest from "supertest";
import type { Express } from "express";

export async function makeApp(): Promise<Express> {
  const { createApp } = await import("../src/app.js");
  return createApp();
}

export type Authed = (app: Express) => ReturnType<typeof supertest.agent>;

/** Register + login a fresh account. Returns auth cookie + scoped authed helper. */
export async function registerAndLogin(app: Express, tag: string) {
  const email = `test-${tag}-${Date.now()}@dayly.test`;
  const password = "Passw0rdTest123";
  const reg = await supertest(app).post("/api/auth/register").send({ name: `Test ${tag}`, email, password });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
  const login = await supertest(app).post("/api/auth/login").send({ email, password });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text}`);
  const cookie = extractCookie(login.headers["set-cookie"] as unknown as string[]);
  const authed: Authed = (a) => {
    const agent = supertest.agent(a);
    agent.set("Cookie", cookie);
    return agent;
  };
  return { email, password, cookie, userId: login.body.user.id, authed };
}

/** Login as the seeded admin. */
export async function adminCookie(app: Express) {
  const login = await supertest(app).post("/api/auth/login").send({ email: "admin@dayly.dev", password: "Admin123456" });
  if (login.status !== 200) throw new Error(`admin login failed: ${login.status} ${login.text}`);
  return extractCookie(login.headers["set-cookie"] as unknown as string[]);
}

export function extractCookie(setCookie: string[] | undefined): string {
  const c = (setCookie ?? []).find((s) => s.startsWith("dayly_session="));
  if (!c) throw new Error("no session cookie set");
  return c.split(";")[0] + ";";
}

export async function createTask(authed: Authed, app: Express, title: string) {
  const r = await authed(app).post("/api/tasks").send({ title });
  if (r.status !== 201) throw new Error(`createTask failed: ${r.status} ${r.text}`);
  return r.body.task;
}

export async function createEvent(authed: Authed, app: Express, title: string) {
  const startAt = new Date(Date.now() + 3600_000).toISOString();
  const endAt = new Date(Date.now() + 7200_000).toISOString();
  const r = await authed(app).post("/api/events").send({ title, startAt, endAt });
  if (r.status !== 201) throw new Error(`createEvent failed: ${r.status} ${r.text}`);
  return r.body.event;
}