import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

type Account = Awaited<ReturnType<typeof registerAndLogin>>;

async function friendCodeOf(account: Account): Promise<string> {
  const res = await account.authed(app).get("/api/chat/me");
  return res.body.friendCode as string;
}

/** Accepted friendship, which is the consent a group is built on. */
async function befriend(a: Account, b: Account): Promise<string> {
  const request = await a.authed(app).post("/api/chat/requests").send({ code: await friendCodeOf(b) });
  expect(request.status).toBe(201);
  const linkId = request.body.link.id as string;
  expect((await b.authed(app).post(`/api/chat/requests/${linkId}/accept`)).status).toBe(200);
  return linkId;
}

/** Three accounts where the first is friends with the other two. */
async function trio(tag: string) {
  const owner = await registerAndLogin(app, `${tag}o`);
  const one = await registerAndLogin(app, `${tag}1`);
  const two = await registerAndLogin(app, `${tag}2`);
  await befriend(owner, one);
  await befriend(owner, two);
  return { owner, one, two };
}

async function makeGroup(owner: Account, memberIds: string[], name = "Cuadrilla") {
  const res = await owner.authed(app).post("/api/chat/groups").send({ name, memberIds });
  expect(res.status).toBe(201);
  return res.body.group as { groupId: string; members: { id: string }[] };
}

function sendToGroup(account: Account, groupId: string, body: string) {
  return account.authed(app).post(`/api/chat/groups/${groupId}/messages`).send({ body, clientId: randomUUID() });
}

const PHOTO = "data:image/jpeg;base64," + "A".repeat(64);
const OTHER_PHOTO = "data:image/png;base64," + "B".repeat(64);

describe("Chat groups: decorated names", () => {
  it("keeps the ornaments and the fancy alphabets", async () => {
    const { owner, one } = await trio("gname");
    const fancy = "╰☆╮ 𝕮𝖚𝖆𝖉𝖗𝖎𝖑𝖑𝖆 ╰☆╮";
    const group = await makeGroup(owner, [one.userId], fancy);
    const seen = await one.authed(app).get("/api/chat/groups");
    expect(seen.body.groups.find((g: { groupId: string }) => g.groupId === group.groupId).name).toBe(fancy);
  });

  it("measures the limit in code points, not UTF-16 units", async () => {
    const { owner, one } = await trio("gnamelen");
    // 30 astral letters: `length` would say 60 and a plain max(60) would pass
    // this but reject 31. What matters is that it is accepted and stored whole.
    const astral = "𝖆".repeat(30);
    const group = await makeGroup(owner, [one.userId], astral);
    const seen = await owner.authed(app).get("/api/chat/groups");
    const stored = seen.body.groups.find((g: { groupId: string }) => g.groupId === group.groupId).name;
    expect(Array.from(stored as string)).toHaveLength(30);
  });

  it("strips what would hijack everyone else's layout", async () => {
    const { owner, one } = await trio("gnamebad");
    const group = await makeGroup(owner, [one.userId]);
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const renamed = await owner.authed(app).patch(`/api/chat/groups/${group.groupId}`)
      .send({ name: `   ${zwsp}${zwsp}${rlo}Cuadrilla   ` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.group.name).toBe("Cuadrilla");

    // Nothing usable left is a bad request, not a group with a blank name.
    const empty = await owner.authed(app).patch(`/api/chat/groups/${group.groupId}`).send({ name: `${zwsp}${zwsp}` });
    expect(empty.status).toBe(400);
  });
});

describe("Chat groups: buzz", () => {
  it("lets any participant buzz, but only once per cooldown each", async () => {
    const { owner, one, two } = await trio("gbz");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    expect((await owner.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`)).status).toBe(201);
    // Same person again, straight away: refused with the cooldown code.
    const again = await owner.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("BUZZ_COOLDOWN");
    expect(again.body.retryAfterMs).toBeGreaterThan(0);

    // The cooldown is per person: the others are not silenced by it.
    expect((await one.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`)).status).toBe(201);
    expect((await two.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`)).status).toBe(201);
  });

  it("counts as an unread for everyone else and leaves a message behind", async () => {
    const { owner, one } = await trio("gbzu");
    const group = await makeGroup(owner, [one.userId]);
    await owner.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`);

    const theirs = await one.authed(app).get("/api/chat/groups");
    const seen = theirs.body.groups.find((g: { groupId: string }) => g.groupId === group.groupId);
    expect(seen.unreadCount).toBe(1);

    const mine = await owner.authed(app).get("/api/chat/groups");
    // The sender has read their own buzz by definition.
    expect(mine.body.groups.find((g: { groupId: string }) => g.groupId === group.groupId).unreadCount).toBe(0);

    const messages = await one.authed(app).get(`/api/chat/groups/${group.groupId}/messages`);
    expect(messages.body.messages.at(-1).kind).toBe("BUZZ");
  });

  it("answers 404 to somebody who is not in the group", async () => {
    const { owner, one, two } = await trio("gbzx");
    const group = await makeGroup(owner, [one.userId]);
    expect((await two.authed(app).post(`/api/chat/groups/${group.groupId}/buzz`)).status).toBe(404);
  });
});

describe("Chat groups: typing", () => {
  it("accepts a ping from any participant and refuses everyone else", async () => {
    const { owner, one, two } = await trio("gtyp");
    const group = await makeGroup(owner, [one.userId]);
    expect((await owner.authed(app).post(`/api/chat/groups/${group.groupId}/typing`)).status).toBe(202);
    expect((await one.authed(app).post(`/api/chat/groups/${group.groupId}/typing`)).status).toBe(202);
    // `two` is a friend of the owner but not in this group.
    expect((await two.authed(app).post(`/api/chat/groups/${group.groupId}/typing`)).status).toBe(404);
  });
});

describe("Chat groups: the photo belongs to everyone", () => {
  it("lets a plain participant set it, not just the owner", async () => {
    const { owner, one, two } = await trio("gph");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    // `one` is not the owner: renaming is refused, the photo is not.
    expect((await one.authed(app).patch(`/api/chat/groups/${group.groupId}`).send({ name: "Otro" })).status).toBe(403);

    const set = await one.authed(app).patch(`/api/chat/groups/${group.groupId}/photo`).send({ avatarUrl: PHOTO });
    expect(set.status).toBe(200);
    expect(set.body.group.avatarUrl).toBe(PHOTO);

    // Everyone sees it, the owner included.
    const seen = await owner.authed(app).get("/api/chat/groups");
    expect(seen.body.groups[0].avatarUrl).toBe(PHOTO);

    // And another participant can replace it afterwards.
    const replaced = await two.authed(app).patch(`/api/chat/groups/${group.groupId}/photo`).send({ avatarUrl: OTHER_PHOTO });
    expect(replaced.body.group.avatarUrl).toBe(OTHER_PHOTO);

    const cleared = await one.authed(app).patch(`/api/chat/groups/${group.groupId}/photo`).send({ avatarUrl: null });
    expect(cleared.body.group.avatarUrl).toBeNull();
  });

  it("answers 404 to somebody who is not in the group", async () => {
    const { owner, one, two } = await trio("gpho");
    const group = await makeGroup(owner, [one.userId]);
    // `two` is a friend of the owner but was not added to this group.
    const attempt = await two.authed(app).patch(`/api/chat/groups/${group.groupId}/photo`).send({ avatarUrl: PHOTO });
    expect(attempt.status).toBe(404);

    const stranger = await registerAndLogin(app, "gphx");
    expect((await stranger.authed(app).patch(`/api/chat/groups/${group.groupId}/photo`).send({ avatarUrl: PHOTO })).status).toBe(404);
  });

  it("refuses anything that is not a bounded image data URL", async () => {
    const { owner, one } = await trio("gphv");
    const group = await makeGroup(owner, [one.userId]);
    const path = `/api/chat/groups/${group.groupId}/photo`;
    expect((await one.authed(app).patch(path).send({ avatarUrl: "https://example.com/x.jpg" })).status).toBe(422);
    expect((await one.authed(app).patch(path).send({ avatarUrl: "javascript:alert(1)" })).status).toBe(422);
    expect((await one.authed(app).patch(path).send({ avatarUrl: "data:text/html;base64,AAAA" })).status).toBe(422);
    expect((await one.authed(app).patch(path).send({ avatarUrl: "data:image/jpeg;base64," + "A".repeat(200_000) })).status).toBe(422);
  });

  it("leaves a group with no photo showing none", async () => {
    const { owner, one } = await trio("gphn");
    const group = await makeGroup(owner, [one.userId]);
    const seen = await one.authed(app).get("/api/chat/groups");
    expect(seen.body.groups[0].avatarUrl).toBeNull();
  });
});

describe("Chat groups: creating and seeing", () => {
  it("creates a group with the people who agreed to talk to you", async () => {
    const { owner, one, two } = await trio("grpA");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    expect(group.members).toHaveLength(3);

    // Everyone invited sees it, with the name and the whole cast.
    const theirs = await one.authed(app).get("/api/chat/groups");
    expect(theirs.status).toBe(200);
    expect(theirs.body.groups).toHaveLength(1);
    expect(theirs.body.groups[0].name).toBe("Cuadrilla");
    expect(theirs.body.groups[0].isOwner).toBe(false);
  });

  it("refuses to drag in someone you are not friends with", async () => {
    const { owner, one } = await trio("grpB");
    const stranger = await registerAndLogin(app, "grpBx");
    const res = await owner.authed(app).post("/api/chat/groups")
      .send({ name: "Cuadrilla", memberIds: [one.userId, stranger.userId] });
    expect(res.status).toBe(400);
    // Scoped to this owner: a bare count() sees every group left behind by the
    // other tests and by any development database this runs against.
    expect(await prisma.chatGroup.count({ where: { ownerId: owner.userId } })).toBe(0);
  });

  it("hides a group from everyone outside it, without saying it exists", async () => {
    const { owner, one, two } = await trio("grpC");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    const stranger = await registerAndLogin(app, "grpCx");

    expect((await stranger.authed(app).get(`/api/chat/groups/${group.groupId}/messages`)).status).toBe(404);
    expect((await sendToGroup(stranger, group.groupId, "hola")).status).toBe(404);
    expect((await stranger.authed(app).post(`/api/chat/groups/${group.groupId}/read`)).status).toBe(404);
    expect((await stranger.authed(app).get("/api/chat/groups")).body.groups).toHaveLength(0);
  });
});

describe("Chat groups: talking", () => {
  it("delivers a message to everyone else and counts it once each", async () => {
    const { owner, one, two } = await trio("grpD");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    expect((await sendToGroup(owner, group.groupId, "¿nos vemos?")).status).toBe(201);

    for (const member of [one, two]) {
      const list = await member.authed(app).get("/api/chat/groups");
      expect(list.body.groups[0].unreadCount).toBe(1);
      expect(list.body.groups[0].lastMessage).toBe("¿nos vemos?");
      expect(list.body.groups[0].lastMessageMine).toBe(false);
    }
    // The sender has read their own message by definition.
    expect((await owner.authed(app).get("/api/chat/groups")).body.groups[0].unreadCount).toBe(0);

    const seen = await one.authed(app).get(`/api/chat/groups/${group.groupId}/messages`);
    expect(seen.body.messages).toHaveLength(1);
    expect(seen.body.messages[0].body).toBe("¿nos vemos?");

    expect((await one.authed(app).post(`/api/chat/groups/${group.groupId}/read`)).status).toBe(200);
    expect((await one.authed(app).get("/api/chat/groups")).body.groups[0].unreadCount).toBe(0);
  });

  it("counts group messages in the badge the whole app reads", async () => {
    const { owner, one, two } = await trio("grpE");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    await sendToGroup(owner, group.groupId, "uno");
    await sendToGroup(owner, group.groupId, "dos");

    const sync = await one.authed(app).get("/api/chat/sync");
    expect(sync.status).toBe(200);
    expect(sync.body.unreadTotal).toBe(2);
    expect(sync.body.groups).toHaveLength(1);
  });

  it("clears the history for the one who asked, and nobody else", async () => {
    const { owner, one, two } = await trio("grpF");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    await sendToGroup(owner, group.groupId, "algo viejo");

    expect((await one.authed(app).post(`/api/chat/groups/${group.groupId}/clear`)).status).toBe(200);
    expect((await one.authed(app).get(`/api/chat/groups/${group.groupId}/messages`)).body.messages).toHaveLength(0);
    expect((await two.authed(app).get(`/api/chat/groups/${group.groupId}/messages`)).body.messages).toHaveLength(1);
  });

  it("does not send the same message twice when a retry arrives", async () => {
    const { owner, one, two } = await trio("grpG");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    const clientId = randomUUID();
    const first = await owner.authed(app).post(`/api/chat/groups/${group.groupId}/messages`).send({ body: "hola", clientId });
    const retry = await owner.authed(app).post(`/api/chat/groups/${group.groupId}/messages`).send({ body: "hola", clientId });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect((await one.authed(app).get(`/api/chat/groups/${group.groupId}/messages`)).body.messages).toHaveLength(1);
  });
});

describe("Chat groups: who can do what", () => {
  it("sends a friendship request from a visible participant without code or email", async () => {
    const { owner, one } = await trio("grpFriend");
    const group = await makeGroup(owner, [one.userId]);

    // Groups can outlive a friendship, which is the useful case for this
    // action: the person is visible in the group but no longer on our list.
    const existing = await prisma.friendLink.findFirst({
      where: { OR: [
        { userAId: owner.userId, userBId: one.userId },
        { userAId: one.userId, userBId: owner.userId },
      ] },
    });
    expect(existing).toBeTruthy();
    if (!existing) return;
    await prisma.friendLink.delete({ where: { id: existing.id } });

    const sent = await owner.authed(app)
      .post(`/api/chat/groups/${group.groupId}/friend-requests`)
      .send({ userId: one.userId });
    expect(sent.status).toBe(201);
    expect(sent.body.autoAccepted).toBe(false);

    const outgoing = await owner.authed(app).get("/api/chat/friends");
    const request = outgoing.body.requests.outgoing.find((row: { user: { id: string } }) => row.user.id === one.userId);
    expect(request).toBeTruthy();
    expect((await one.authed(app).post(`/api/chat/requests/${request.linkId}/accept`)).status).toBe(200);
    expect((await owner.authed(app).get("/api/chat/friends")).body.friends.some((row: { user: { id: string } }) => row.user.id === one.userId)).toBe(true);
  });

  it("only allows the request for somebody in that group", async () => {
    const { owner, one, two } = await trio("grpFriendScope");
    const group = await makeGroup(owner, [one.userId]);

    expect((await owner.authed(app).post(`/api/chat/groups/${group.groupId}/friend-requests`)
      .send({ userId: two.userId })).status).toBe(404);
    expect((await two.authed(app).post(`/api/chat/groups/${group.groupId}/friend-requests`)
      .send({ userId: one.userId })).status).toBe(404);
  });

  it("lets a member bring in their own friend and nobody else", async () => {
    const { owner, one, two } = await trio("grpH");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    const friendOfOne = await registerAndLogin(app, "grpHf");
    await befriend(one, friendOfOne);

    // `two` does not know them, so `two` cannot add them.
    expect((await two.authed(app).post(`/api/chat/groups/${group.groupId}/members`)
      .send({ userIds: [friendOfOne.userId] })).status).toBe(400);

    const added = await one.authed(app).post(`/api/chat/groups/${group.groupId}/members`)
      .send({ userIds: [friendOfOne.userId] });
    expect(added.status).toBe(200);
    expect(added.body.group.members).toHaveLength(4);
    expect((await friendOfOne.authed(app).get("/api/chat/groups")).body.groups).toHaveLength(1);
  });

  it("only the owner renames it or takes someone out", async () => {
    const { owner, one, two } = await trio("grpI");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    expect((await one.authed(app).patch(`/api/chat/groups/${group.groupId}`).send({ name: "Otra cosa" })).status).toBe(403);
    expect((await one.authed(app).delete(`/api/chat/groups/${group.groupId}/members/${two.userId}`)).status).toBe(403);

    expect((await owner.authed(app).patch(`/api/chat/groups/${group.groupId}`).send({ name: "Otra cosa" })).status).toBe(200);
    expect((await owner.authed(app).delete(`/api/chat/groups/${group.groupId}/members/${two.userId}`)).status).toBe(200);
    expect((await two.authed(app).get("/api/chat/groups")).body.groups).toHaveLength(0);
    expect((await two.authed(app).get(`/api/chat/groups/${group.groupId}/messages`)).status).toBe(404);
  });

  it("anyone can walk out, and the group follows the last one", async () => {
    const { owner, one, two } = await trio("grpJ");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    expect((await one.authed(app).delete(`/api/chat/groups/${group.groupId}/members/${one.userId}`)).status).toBe(200);
    expect((await one.authed(app).get("/api/chat/groups")).body.groups).toHaveLength(0);

    // The owner leaving hands the group over instead of stranding it.
    expect((await owner.authed(app).delete(`/api/chat/groups/${group.groupId}/members/${owner.userId}`)).status).toBe(200);
    const heir = await prisma.chatGroup.findUnique({ where: { id: group.groupId } });
    expect(heir?.ownerId).toBe(two.userId);

    expect((await two.authed(app).delete(`/api/chat/groups/${group.groupId}/members/${two.userId}`)).status).toBe(200);
    expect(await prisma.chatGroup.count({ where: { id: group.groupId } })).toBe(0);
  });

  it("mute and wallpaper belong to each member, not to the group", async () => {
    const { owner, one, two } = await trio("grpK");
    const group = await makeGroup(owner, [one.userId, two.userId]);

    expect((await one.authed(app).patch(`/api/chat/groups/${group.groupId}/prefs`).send({ muted: true })).status).toBe(200);
    expect((await one.authed(app).get("/api/chat/groups")).body.groups[0].muted).toBe(true);
    expect((await two.authed(app).get("/api/chat/groups")).body.groups[0].muted).toBe(false);
  });

  it("deleting an account takes its membership with it", async () => {
    const { owner, one, two } = await trio("grpL");
    const group = await makeGroup(owner, [one.userId, two.userId]);
    await prisma.user.delete({ where: { id: two.userId } });

    const left = await owner.authed(app).get("/api/chat/groups");
    expect(left.body.groups[0].members).toHaveLength(2);
  });
});
