import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { readFile } from "node:fs/promises";
import { absUploadPath } from "../src/lib/uploads.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

type Account = Awaited<ReturnType<typeof registerAndLogin>>;

async function friendCodeOf(account: Account): Promise<string> {
  const res = await account.authed(app).get("/api/chat/me");
  expect(res.status).toBe(200);
  return res.body.friendCode as string;
}

/** Two accounts that already accepted each other, plus their thread id. */
async function befriend(tagA: string, tagB: string) {
  const a = await registerAndLogin(app, tagA);
  const b = await registerAndLogin(app, tagB);
  const code = await friendCodeOf(b);
  const request = await a.authed(app).post("/api/chat/requests").send({ code });
  expect(request.status).toBe(201);
  const linkId = request.body.link.id as string;
  const accept = await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);
  expect(accept.status).toBe(200);
  return { a, b, linkId };
}

function send(account: Account, linkId: string, body: string) {
  return account.authed(app).post(`/api/chat/threads/${linkId}/messages`).send({ body, clientId: randomUUID() });
}

describe("Chat: friend codes and requests", () => {
  it("issues a friend code on first use and keeps it stable", async () => {
    const user = await registerAndLogin(app, "code1");
    const first = await friendCodeOf(user);
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(await friendCodeOf(user)).toBe(first);
  });

  it("rotating the code invalidates the old one and keeps friendships", async () => {
    const { a, b, linkId } = await befriend("rot1", "rot2");
    const before = await friendCodeOf(b);
    await prisma.user.update({ where: { id: b.userId }, data: { friendCodeUpdatedAt: new Date(Date.now() - 600_000) } });
    const rotated = await b.authed(app).post("/api/chat/friend-code/rotate");
    expect(rotated.status).toBe(200);
    expect(rotated.body.friendCode).not.toBe(before);

    const stranger = await registerAndLogin(app, "rot3");
    expect((await stranger.authed(app).post("/api/chat/requests").send({ code: before })).status).toBe(404);
    const friends = await a.authed(app).get("/api/chat/friends");
    expect(friends.body.friends.map((f: { linkId: string }) => f.linkId)).toContain(linkId);
  });

  it("turns two crossed requests into a single accepted link", async () => {
    const a = await registerAndLogin(app, "cross1");
    const b = await registerAndLogin(app, "cross2");
    const [codeA, codeB] = await Promise.all([friendCodeOf(a), friendCodeOf(b)]);

    const first = await a.authed(app).post("/api/chat/requests").send({ code: codeB });
    const second = await b.authed(app).post("/api/chat/requests").send({ code: codeA });
    expect(second.body.autoAccepted).toBe(true);
    expect(second.body.link.id).toBe(first.body.link.id);

    const rows = await prisma.friendLink.count({
      where: { OR: [{ userAId: a.userId, userBId: b.userId }, { userAId: b.userId, userBId: a.userId }] },
    });
    expect(rows).toBe(1);
    expect(second.body.link.status).toBe("ACCEPTED");
  });

  it("refuses to let the sender accept their own request", async () => {
    const a = await registerAndLogin(app, "self1");
    const b = await registerAndLogin(app, "self2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    expect((await a.authed(app).post(`/api/chat/requests/${request.body.link.id}/accept`)).status).toBe(404);
  });

  it("answers an unknown email exactly like a real one", async () => {
    const sender = await registerAndLogin(app, "enum1");
    const target = await registerAndLogin(app, "enum2");
    const real = await sender.authed(app).post("/api/chat/requests").send({ email: target.email });
    const fake = await sender.authed(app).post("/api/chat/requests").send({ email: `nobody-${Date.now()}@dayly.test` });
    expect(real.status).toBe(202);
    expect(fake.status).toBe(202);
    expect(real.body).toEqual(fake.body);
  });

  it("does not deliver email requests to a user who opted out", async () => {
    const sender = await registerAndLogin(app, "optout1");
    const target = await registerAndLogin(app, "optout2");
    await target.authed(app).patch("/api/chat/settings").send({ discoverableByEmail: false });
    expect((await sender.authed(app).post("/api/chat/requests").send({ email: target.email })).status).toBe(202);
    const incoming = await target.authed(app).get("/api/chat/friends");
    expect(incoming.body.requests.incoming).toHaveLength(0);
  });

  it("stores only known message tones and never a caller-supplied path", async () => {
    const user = await registerAndLogin(app, "tone1");
    expect((await user.authed(app).get("/api/chat/me")).body.sound).toBe("soundchat");

    const off = await user.authed(app).patch("/api/chat/settings").send({ sound: "off" });
    expect(off.status).toBe(200);
    expect(off.body.settings.sound).toBe("off");

    const bogus = await user.authed(app).patch("/api/chat/settings").send({ sound: "../../etc/passwd" });
    expect(bogus.status).toBe(422);
    expect((await user.authed(app).get("/api/chat/me")).body.sound).toBe("off");
  });

  it("shows the last line in the list, encrypted at rest and attributed", async () => {
    const a = await registerAndLogin(app, "prev1");
    const b = await registerAndLogin(app, "prev2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);
    await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ body: "nos vemos el jueves", clientId: randomUUID() });

    const mine = await a.authed(app).get("/api/chat/friends");
    expect(mine.body.friends[0].lastMessage).toBe("nos vemos el jueves");
    expect(mine.body.friends[0].lastMessageMine).toBe(true);
    const theirs = await b.authed(app).get("/api/chat/friends");
    expect(theirs.body.friends[0].lastMessageMine).toBe(false);

    const row = await prisma.friendLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(row.lastMessageEnc).not.toContain("jueves");
  });

  it("clears the history for one side only, and silences just for me", async () => {
    const a = await registerAndLogin(app, "clear1");
    const b = await registerAndLogin(app, "clear2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);
    await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ body: "queda esto escrito", clientId: randomUUID() });

    expect((await a.authed(app).post(`/api/chat/friends/${linkId}/clear`)).status).toBe(200);
    const mine = await a.authed(app).get(`/api/chat/threads/${linkId}/messages`);
    expect(mine.body.messages).toHaveLength(0);
    const theirs = await b.authed(app).get(`/api/chat/threads/${linkId}/messages`);
    expect(theirs.body.messages).toHaveLength(1);

    await a.authed(app).patch(`/api/chat/friends/${linkId}/prefs`).send({ muted: true });
    expect((await a.authed(app).get("/api/chat/friends")).body.friends[0].muted).toBe(true);
    expect((await b.authed(app).get("/api/chat/friends")).body.friends[0].muted).toBe(false);

    const stranger = await registerAndLogin(app, "clear3");
    expect((await stranger.authed(app).post(`/api/chat/friends/${linkId}/clear`)).status).toBe(404);
  });

  it("marks a message as read once the other side opens the thread", async () => {
    const a = await registerAndLogin(app, "tick1");
    const b = await registerAndLogin(app, "tick2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);
    await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ body: "¿lo has visto?", clientId: randomUUID() });

    const before = await a.authed(app).get("/api/chat/friends");
    const sentAt = new Date(before.body.friends[0].lastMessageAt as string);
    const readBefore = before.body.friends[0].otherReadAt as string | null;
    expect(readBefore === null || new Date(readBefore) < sentAt).toBe(true);

    await b.authed(app).post(`/api/chat/threads/${linkId}/read`).send({});
    const after = await a.authed(app).get("/api/chat/friends");
    expect(new Date(after.body.friends[0].otherReadAt as string) >= sentAt).toBe(true);
  });

  it("keeps 50 favourite GIFs per user and nothing else", async () => {
    const user = await registerAndLogin(app, "fav1");
    const other = await registerAndLogin(app, "fav2");
    const gif = (n: number) => ({
      url: `https://media1.giphy.com/media/${n}/g.gif`,
      preview: `https://media1.giphy.com/media/${n}/s.gif`,
      width: 200,
      height: 200,
      description: `gif ${n}`,
    });

    const first = await user.authed(app).post("/api/chat/gifs/favorites").send(gif(1));
    expect(first.status).toBe(201);
    expect(first.body.favorite.provider).toBe("giphy");

    // Starring the same one again is not a duplicate and not an error.
    const again = await user.authed(app).post("/api/chat/gifs/favorites").send(gif(1));
    expect(again.status).toBe(200);
    expect((await user.authed(app).get("/api/chat/gifs/favorites")).body.favorites).toHaveLength(1);

    // A host that is not a provider never reaches the list.
    const bogus = await user.authed(app).post("/api/chat/gifs/favorites")
      .send({ ...gif(2), url: "https://evil.example/x.gif" });
    expect(bogus.status).toBe(422);

    for (let n = 2; n <= 50; n += 1) {
      expect((await user.authed(app).post("/api/chat/gifs/favorites").send(gif(n))).status).toBe(201);
    }
    const full = await user.authed(app).post("/api/chat/gifs/favorites").send(gif(51));
    expect(full.status).toBe(409);
    expect((await user.authed(app).get("/api/chat/gifs/favorites")).body.favorites).toHaveLength(50);

    // Someone else's favourite is simply not there.
    const mine = (await user.authed(app).get("/api/chat/gifs/favorites")).body.favorites[0].id as string;
    expect((await other.authed(app).delete(`/api/chat/gifs/favorites/${mine}`)).status).toBe(404);
    expect((await other.authed(app).get("/api/chat/gifs/favorites")).body.favorites).toHaveLength(0);

    expect((await user.authed(app).delete(`/api/chat/gifs/favorites/${mine}`)).status).toBe(200);
    expect((await user.authed(app).get("/api/chat/gifs/favorites")).body.favorites).toHaveLength(49);
  });

  it("relays a file to the other side and to nobody else", async () => {
    const a = await registerAndLogin(app, "file1");
    const b = await registerAndLogin(app, "file2");
    const stranger = await registerAndLogin(app, "file3");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);

    // A one pixel PNG, sniffed by content and not by its name.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const sent = await a.authed(app).post(`/api/chat/threads/${linkId}/files`)
      .attach("file", png, { filename: "captura.png", contentType: "image/png" });
    expect(sent.status).toBe(201);
    expect(sent.body.message.kind).toBe("FILE");
    expect(sent.body.message.file).toMatchObject({ name: "captura.png", mime: "image/png", image: true });

    const transferId = sent.body.message.file.transferId as string;
    const download = await b.authed(app).get(`/api/chat/files/${transferId}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(download.body).equals(png)).toBe(true);

    // Not a participant: the file does not exist as far as they are concerned.
    expect((await stranger.authed(app).get(`/api/chat/files/${transferId}`)).status).toBe(404);

    // The bytes on disk are not the bytes that were sent.
    const row = await prisma.chatTransfer.findUniqueOrThrow({ where: { id: transferId } });
    const stored = await readFile(absUploadPath(row.storageKey));
    expect(stored.equals(png)).toBe(false);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // An executable is not something this chat carries.
    const evil = await a.authed(app).post(`/api/chat/threads/${linkId}/files`)
      .attach("file", Buffer.from("MZ  binary"), { filename: "virus.exe", contentType: "application/octet-stream" });
    expect(evil.status).toBe(400);
  });

  it("only accepts GIFs from a provider's own hosts", async () => {
    const a = await registerAndLogin(app, "gif1");
    const b = await registerAndLogin(app, "gif2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);

    const good = {
      url: "https://media1.giphy.com/media/abc/gato.gif",
      preview: "https://media1.giphy.com/media/abc/gato-tiny.gif",
      width: 300,
      height: 200,
      description: "gato",
    };
    const sent = await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ gif: good, clientId: randomUUID() });
    expect(sent.status).toBe(201);
    expect(sent.body.message.kind).toBe("GIF");
    expect(sent.body.message.gif.url).toBe(good.url);

    const thread = await b.authed(app).get(`/api/chat/threads/${linkId}/messages`);
    expect(thread.body.messages[0].gif.preview).toBe(good.preview);

    // Someone else's host is refused outright.
    const evil = await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ gif: { ...good, url: "https://evil.example/x.gif" }, clientId: randomUUID() });
    expect(evil.status).toBe(422);
    expect((await b.authed(app).get(`/api/chat/threads/${linkId}/messages`)).body.messages).toHaveLength(1);

    // Text and GIF together is not a message shape we accept.
    const both = await a.authed(app).post(`/api/chat/threads/${linkId}/messages`)
      .send({ body: "hola", gif: good, clientId: randomUUID() });
    expect(both.status).toBe(422);
  });

  it("keeps each side's wallpaper private and refuses unknown ones", async () => {
    const a = await registerAndLogin(app, "paper1");
    const b = await registerAndLogin(app, "paper2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    await b.authed(app).post(`/api/chat/requests/${linkId}/accept`);

    expect((await a.authed(app).patch(`/api/chat/friends/${linkId}/wallpaper`).send({ wallpaper: "ocean" })).status).toBe(200);
    const mine = await a.authed(app).get("/api/chat/friends");
    expect(mine.body.friends[0].wallpaper).toBe("ocean");
    const theirs = await b.authed(app).get("/api/chat/friends");
    expect(theirs.body.friends[0].wallpaper).toBeNull();

    expect((await a.authed(app).patch(`/api/chat/friends/${linkId}/wallpaper`).send({ wallpaper: "url(evil)" })).status).toBe(422);

    const stranger = await registerAndLogin(app, "paper3");
    expect((await stranger.authed(app).patch(`/api/chat/friends/${linkId}/wallpaper`).send({ wallpaper: "mint" })).status).toBe(404);
  });

  it("keeps a declined request from reaching the recipient again", async () => {
    const a = await registerAndLogin(app, "dec1");
    const b = await registerAndLogin(app, "dec2");
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    await b.authed(app).post(`/api/chat/requests/${request.body.link.id}/decline`);
    await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const incoming = await b.authed(app).get("/api/chat/friends");
    expect(incoming.body.requests.incoming).toHaveLength(0);
  });
});

describe("Chat: isolation and denied access", () => {
  it("a third party gets 404 on someone else's thread", async () => {
    const { a, linkId } = await befriend("iso1", "iso2");
    await send(a, linkId, "privado");
    const outsider = await registerAndLogin(app, "iso3");

    expect((await outsider.authed(app).get(`/api/chat/threads/${linkId}/messages`)).status).toBe(404);
    expect((await send(outsider, linkId, "intruso")).status).toBe(404);
    expect((await outsider.authed(app).post(`/api/chat/threads/${linkId}/buzz`)).status).toBe(404);
    expect((await outsider.authed(app).post(`/api/chat/threads/${linkId}/read`).send({})).status).toBe(404);
    expect((await outsider.authed(app).delete(`/api/chat/friends/${linkId}`)).status).toBe(404);
  });

  it("never lists links that belong to other people", async () => {
    const { linkId } = await befriend("iso4", "iso5");
    const outsider = await registerAndLogin(app, "iso6");
    const friends = await outsider.authed(app).get("/api/chat/friends");
    expect(friends.body.friends).toHaveLength(0);
    const sync = await outsider.authed(app).get("/api/chat/sync");
    expect(sync.body.threads.map((t: { linkId: string }) => t.linkId)).not.toContain(linkId);
  });

  it("hides the thread from whoever was blocked, and keeps it for the blocker", async () => {
    const { a, b, linkId } = await befriend("blk1", "blk2");
    expect((await a.authed(app).post(`/api/chat/friends/${linkId}/block`)).status).toBe(200);

    expect((await b.authed(app).get(`/api/chat/threads/${linkId}/messages`)).status).toBe(404);
    expect((await send(b, linkId, "hola?")).status).toBe(404);
    expect((await b.authed(app).get("/api/chat/friends")).body.friends).toHaveLength(0);

    const blockerView = await a.authed(app).get("/api/chat/friends");
    expect(blockerView.body.friends[0].blockedByMe).toBe(true);
    expect((await b.authed(app).post(`/api/chat/friends/${linkId}/unblock`)).status).toBe(404);
    expect((await a.authed(app).post(`/api/chat/friends/${linkId}/unblock`)).status).toBe(200);
  });
});

describe("Chat: messages", () => {
  it("raises the unread count for the recipient only, and clears it on read", async () => {
    const { a, b, linkId } = await befriend("msg1", "msg2");
    await send(a, linkId, "hola");

    const senderSync = await a.authed(app).get("/api/chat/sync");
    expect(senderSync.body.unreadTotal).toBe(0);
    const recipientSync = await b.authed(app).get("/api/chat/sync");
    expect(recipientSync.body.unreadTotal).toBe(1);

    await b.authed(app).post(`/api/chat/threads/${linkId}/read`).send({});
    expect((await b.authed(app).get("/api/chat/sync")).body.unreadTotal).toBe(0);
  });

  it("does not duplicate a message resent with the same clientId", async () => {
    const { a, linkId } = await befriend("idem1", "idem2");
    const clientId = randomUUID();
    const first = await a.authed(app).post(`/api/chat/threads/${linkId}/messages`).send({ body: "una vez", clientId });
    const retry = await a.authed(app).post(`/api/chat/threads/${linkId}/messages`).send({ body: "una vez", clientId });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect(await prisma.chatMessage.count({ where: { linkId } })).toBe(1);
  });

  it("stores the body encrypted, never in clear text", async () => {
    const { a, linkId } = await befriend("enc1", "enc2");
    const secret = `secreto-${randomUUID()}`;
    await send(a, linkId, secret);
    const row = await prisma.chatMessage.findFirstOrThrow({ where: { linkId } });
    expect(row.bodyEnc).not.toBeNull();
    expect(row.bodyEnc).not.toContain(secret);
    const read = await a.authed(app).get(`/api/chat/threads/${linkId}/messages`);
    expect(read.body.messages[0].body).toBe(secret);
  });

  it("refuses a message id from another thread", async () => {
    const { a, linkId } = await befriend("mix1", "mix2");
    await send(a, linkId, "mío");
    const other = await befriend("mix3", "mix4");
    const history = await a.authed(app).get(`/api/chat/threads/${other.linkId}/messages`);
    expect(history.status).toBe(404);
  });
});

describe("Chat: typing", () => {
  it("accepts a ping from each side of an accepted thread", async () => {
    const { a, b, linkId } = await befriend("typa", "typb");
    // 202: taken and forwarded, with nothing written down.
    expect((await a.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(202);
    expect((await b.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(202);
  });

  it("refuses a stranger and a thread that is only pending", async () => {
    const a = await registerAndLogin(app, "typc");
    const b = await registerAndLogin(app, "typd");
    const stranger = await registerAndLogin(app, "type");

    // Pending, not accepted yet: nobody should be able to signal.
    const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
    const linkId = request.body.link.id as string;
    expect((await a.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(404);

    expect((await b.authed(app).post(`/api/chat/requests/${linkId}/accept`)).status).toBe(200);
    expect((await a.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(202);
    // Somebody outside the thread gets the same 404 as everywhere else.
    expect((await stranger.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(404);
  });

  it("stops a blocked person from even saying they are writing", async () => {
    const { a, b, linkId } = await befriend("typf", "typg");
    expect((await a.authed(app).post(`/api/chat/friends/${linkId}/block`)).status).toBe(200);
    expect((await b.authed(app).post(`/api/chat/threads/${linkId}/typing`)).status).toBe(404);
  });

  it("requires a session", async () => {
    const supertest = (await import("supertest")).default;
    expect((await supertest(app).post("/api/chat/threads/whatever/typing")).status).toBe(401);
  });
});

describe("Chat: buzz", () => {
  it("rejects a second buzz inside the cooldown with a retry hint", async () => {
    const { a, linkId } = await befriend("bz1", "bz2");
    expect((await a.authed(app).post(`/api/chat/threads/${linkId}/buzz`)).status).toBe(201);
    const again = await a.authed(app).post(`/api/chat/threads/${linkId}/buzz`);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("BUZZ_COOLDOWN");
    expect(again.body.retryAfterMs).toBeGreaterThan(0);
  });

  it("only creates one message when two buzzes race", async () => {
    const { a, linkId } = await befriend("bz3", "bz4");
    await Promise.all([
      a.authed(app).post(`/api/chat/threads/${linkId}/buzz`),
      a.authed(app).post(`/api/chat/threads/${linkId}/buzz`),
    ]);
    expect(await prisma.chatMessage.count({ where: { linkId, kind: "BUZZ" } })).toBe(1);
  });

  it("saves the buzz without a body", async () => {
    const { a, linkId } = await befriend("bz5", "bz6");
    await a.authed(app).post(`/api/chat/threads/${linkId}/buzz`);
    const row = await prisma.chatMessage.findFirstOrThrow({ where: { linkId, kind: "BUZZ" } });
    expect(row.bodyEnc).toBeNull();
  });
});

describe("Chat: polling", () => {
  it("answers 304 while nothing changed and a new version once it does", async () => {
    const { a, b, linkId } = await befriend("sync1", "sync2");
    const first = await b.authed(app).get("/api/chat/sync");
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const unchanged = await b.authed(app).get("/api/chat/sync").set("If-None-Match", etag);
    expect(unchanged.status).toBe(304);

    await send(a, linkId, "novedad");
    const changed = await b.authed(app).get("/api/chat/sync").set("If-None-Match", etag);
    expect(changed.status).toBe(200);
    expect(changed.body.unreadTotal).toBe(1);
  });

  it("changes the version when a friend is removed, not just on new messages", async () => {
    const { a, b, linkId } = await befriend("sync3", "sync4");
    const before = (await a.authed(app).get("/api/chat/sync")).headers.etag as string;
    await b.authed(app).delete(`/api/chat/friends/${linkId}`);
    const after = await a.authed(app).get("/api/chat/sync").set("If-None-Match", before);
    expect(after.status).toBe(200);
    expect(after.body.threads).toHaveLength(0);
  });
});

describe("Chat: account lifecycle", () => {
  it("deleting an account removes its links and messages on both sides", async () => {
    const { a, b, linkId } = await befriend("del1", "del2");
    await send(a, linkId, "hasta luego");
    await prisma.user.delete({ where: { id: b.userId } });

    expect(await prisma.friendLink.count({ where: { id: linkId } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { linkId } })).toBe(0);
    expect((await a.authed(app).get("/api/chat/friends")).body.friends).toHaveLength(0);
  });
});


describe("Chat: presence", () => {
  it("keeps the state you pick and hands it to the other side", async () => {
    const { a, b } = await befriend("pres1", "pres2");

    const saved = await b.authed(app).patch("/api/chat/settings").send({ status: "BUSY" });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.status).toBe("BUSY");
    expect((await b.authed(app).get("/api/chat/me")).body.status).toBe("BUSY");

    // Their client has just spoken to the server, so the state is live.
    await b.authed(app).get("/api/chat/sync");
    const friends = await a.authed(app).get("/api/chat/friends");
    expect(friends.body.friends[0].user.status).toBe("BUSY");
  });

  it("reads as disconnected once that client stops checking in", async () => {
    const { a, b } = await befriend("pres3", "pres4");
    await b.authed(app).patch("/api/chat/settings").send({ status: "ONLINE" });
    await prisma.user.update({
      where: { id: b.userId },
      data: { chatSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const friends = await a.authed(app).get("/api/chat/friends");
    expect(friends.body.friends[0].user.status).toBe("OFFLINE");
  });

  it("refuses a state that is not one of the three", async () => {
    const { a } = await befriend("pres5", "pres6");
    expect((await a.authed(app).patch("/api/chat/settings").send({ status: "INVISIBLE" })).status).toBe(422);
  });
});
