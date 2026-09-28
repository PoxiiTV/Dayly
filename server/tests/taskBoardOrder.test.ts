import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin, createTask } from "./helpers.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

describe("manual board order", () => {
  it("saves the dragged order, resets it and never touches another user's tasks", async () => {
    const { authed } = await registerAndLogin(app, "board-order");
    const a = await createTask(authed, app, "A");
    const b = await createTask(authed, app, "B");
    const c = await createTask(authed, app, "C");

    expect((await authed(app).put("/api/tasks/board-order").send({ ids: [c.id, a.id, b.id] })).status).toBe(200);
    const order = async () => {
      const res = await authed(app).get("/api/tasks").query({ includeCompleted: "true" });
      return Object.fromEntries((res.body.tasks as { id: string; boardOrder: number | null }[]).map((t) => [t.id, t.boardOrder]));
    };
    expect(await order()).toMatchObject({ [c.id]: 0, [a.id]: 1, [b.id]: 2 });

    const other = await registerAndLogin(app, "board-order-other");
    expect((await other.authed(app).put("/api/tasks/board-order").send({ ids: [a.id] })).status).toBe(404);
    expect((await other.authed(app).delete("/api/tasks/board-order")).status).toBe(200);
    expect((await order())[a.id]).toBe(1);

    expect((await authed(app).put("/api/tasks/board-order").send({ ids: [] })).status).toBe(422);
    expect((await authed(app).put("/api/tasks/board-order").send({ ids: [a.id, a.id] })).status).toBe(422);
    expect((await authed(app).put("/api/tasks/board-order").send({ ids: [a.id, b.id], positions: [5] })).status).toBe(422);

    // A filtered view swaps the positions its tasks already had; C stays first.
    expect((await authed(app).put("/api/tasks/board-order").send({ ids: [b.id, a.id], positions: [1, 2] })).status).toBe(200);
    expect(await order()).toMatchObject({ [c.id]: 0, [b.id]: 1, [a.id]: 2 });

    expect((await authed(app).delete("/api/tasks/board-order")).status).toBe(200);
    expect(await order()).toMatchObject({ [a.id]: null, [b.id]: null, [c.id]: null });
  });
});
