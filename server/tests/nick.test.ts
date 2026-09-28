import { describe, it, expect, beforeAll } from "vitest";
import type { Express } from "express";
import { makeApp, registerAndLogin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { NICK_MAX, SUBNICK_MAX, displayNameOf, sanitizeNick } from "../src/lib/nick.js";

let app: Express;
beforeAll(async () => {
  app = await makeApp();
});

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0x0000);
const COMBINING_ACUTE = String.fromCharCode(0x0301);

describe("nick sanitising", () => {
  it("keeps the MSN ornaments untouched", () => {
    const fancy = "·°¤*(¯`★´¯)*¤°· ALEXIS ·°¤*(¯`★´¯)*¤°·";
    expect(sanitizeNick(fancy, NICK_MAX)).toBe(fancy);
    expect(sanitizeNick("𝖐𝖗𝖎𝖘𝖙𝖎𝖆𝖓", NICK_MAX)).toBe("𝖐𝖗𝖎𝖘𝖙𝖎𝖆𝖓");
  });

  it("drops control characters, bidi overrides and invisibles", () => {
    expect(sanitizeNick(`a${NUL}b`, NICK_MAX)).toBe("ab");
    expect(sanitizeNick(`${RLO}moc.elpmaxe`, NICK_MAX)).toBe("moc.elpmaxe");
    expect(sanitizeNick(`${ZWSP}${ZWSP}Alex`, NICK_MAX)).toBe("Alex");
    // A nick made only of invisibles clears the field instead of looking blank.
    expect(sanitizeNick(`${ZWSP}${ZWSP}`, NICK_MAX)).toBeNull();
    expect(sanitizeNick("   ", NICK_MAX)).toBeNull();
  });

  it("collapses padding so nobody jumps to the top of the list", () => {
    expect(sanitizeNick("        Alex", NICK_MAX)).toBe("Alex");
    expect(sanitizeNick("Alex     is", NICK_MAX)).toBe("Alex is");
  });

  it("caps Zalgo at two combining marks in a row", () => {
    const zalgo = "e" + COMBINING_ACUTE.repeat(40);
    const out = sanitizeNick(zalgo, NICK_MAX) ?? "";
    expect(Array.from(out).length).toBe(3);
  });

  it("counts the length in code points, not UTF-16 units", () => {
    // Astral characters: `length` would be double the real count.
    const long = "𝖆".repeat(NICK_MAX + 20);
    const out = sanitizeNick(long, NICK_MAX) ?? "";
    expect(Array.from(out).length).toBe(NICK_MAX);
  });

  it("falls back to the account name when there is no nick", () => {
    expect(displayNameOf({ name: "Alexis", nick: null })).toBe("Alexis");
    expect(displayNameOf({ name: "Alexis", nick: "   " })).toBe("Alexis");
    expect(displayNameOf({ name: "Alexis", nick: "★ Alex ★" })).toBe("★ Alex ★");
  });
});

describe("nick and subnick over the API", () => {
  it("saves, cleans and clears them", async () => {
    const { authed } = await registerAndLogin(app, "nick");
    const saved = await authed(app).patch("/api/users/me").send({
      nick: `  ${ZWSP}·°¤*(¯\`★´¯)*¤°· KRIS ·°¤*(¯\`★´¯)*¤°·  `,
      nickColor: "#ec4899",
      nickBold: true,
      subnick: "Escuchando: Bon Jovi - It's My Life",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.nick).toBe("·°¤*(¯`★´¯)*¤°· KRIS ·°¤*(¯`★´¯)*¤°·");
    expect(saved.body.user.nickColor).toBe("#ec4899");
    expect(saved.body.user.nickBold).toBe(true);
    expect(saved.body.user.subnick).toBe("Escuchando: Bon Jovi - It's My Life");

    const cleared = await authed(app).patch("/api/users/me").send({ nick: null, subnick: null });
    expect(cleared.body.user.nick).toBeNull();
    expect(cleared.body.user.subnick).toBeNull();
    // The account name is untouched by all of this.
    expect(cleared.body.user.name).toMatch(/^Test nick/);
  });

  it("rejects a colour that is not a hex code", async () => {
    const { authed } = await registerAndLogin(app, "nickcol");
    const bad = await authed(app).patch("/api/users/me").send({ nickColor: "javascript:alert(1)" });
    expect(bad.status).toBe(422);
  });

  it("truncates an over-long nick instead of failing", async () => {
    const { authed } = await registerAndLogin(app, "nicklong");
    const r = await authed(app).patch("/api/users/me").send({ nick: "★".repeat(150) });
    expect(r.status).toBe(200);
    expect(Array.from(r.body.user.nick as string).length).toBe(NICK_MAX);
    const sub = await authed(app).patch("/api/users/me").send({ subnick: "a".repeat(200) });
    expect(Array.from(sub.body.user.subnick as string).length).toBe(SUBNICK_MAX);
  });
});

describe("multicoloured nick", () => {
  it("stores the pieces and derives the plain nick from them", async () => {
    const { authed } = await registerAndLogin(app, "nickseg");
    const saved = await authed(app).patch("/api/users/me").send({
      nickSegments: [
        { t: "Alex", c: "#ef4444" },
        { t: "is", c: "#3b82f6" },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.nick).toBe("Alexis");
    expect(saved.body.user.nickSegments).toHaveLength(2);
    expect(saved.body.user.nickSegments[1]).toMatchObject({ t: "is", c: "#3b82f6" });
  });

  it("collapses a single colour back to nickColor, with no pieces stored", async () => {
    const { authed } = await registerAndLogin(app, "nickuni");
    const saved = await authed(app).patch("/api/users/me").send({
      nickSegments: [{ t: "Alex", c: "#ec4899" }, { t: "is", c: "#ec4899" }],
    });
    expect(saved.body.user.nick).toBe("Alexis");
    expect(saved.body.user.nickSegments).toBeNull();
    expect(saved.body.user.nickColor).toBe("#ec4899");
  });

  it("cleans each piece and refuses a colour that is not a hex code", async () => {
    const { authed } = await registerAndLogin(app, "nicksegbad");
    const rlo = String.fromCharCode(0x202e);
    const saved = await authed(app).patch("/api/users/me").send({
      nickSegments: [{ t: `${rlo}Alex`, c: "#ef4444" }, { t: "is", c: "#3b82f6" }],
    });
    expect(saved.body.user.nick).toBe("Alexis");

    const bad = await authed(app).patch("/api/users/me").send({
      nickSegments: [{ t: "Alex", c: "javascript:alert(1)" }],
    });
    expect(bad.status).toBe(422);
  });

  it("caps the total across pieces in code points", async () => {
    const { authed } = await registerAndLogin(app, "nicksegcap");
    const saved = await authed(app).patch("/api/users/me").send({
      nickSegments: [
        { t: "𝖆".repeat(50), c: "#ef4444" },
        { t: "𝖇".repeat(50), c: "#3b82f6" },
      ],
    });
    expect(saved.status).toBe(200);
    expect(Array.from(saved.body.user.nick as string)).toHaveLength(NICK_MAX);
  });
});

describe("profile update cannot write columns the schema does not declare", () => {
  it("refuses to make the caller an administrator", async () => {
    const { authed, userId } = await registerAndLogin(app, "escalate");
    const adminRole = await prisma.role.findFirstOrThrow({ where: { name: "ADMIN" } });

    // The regression: `req.body` used to be handed straight to prisma.update,
    // so a plain user could promote themselves with a single PATCH.
    const attempt = await authed(app).patch("/api/users/me").send({ name: "Esc", roleId: adminRole.id });
    expect(attempt.status).toBe(200);
    expect(attempt.body.user.roleName).toBe("USER");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { roleId: true } });
    expect(stored.roleId).not.toBe(adminRole.id);
  });

  it("refuses the same trick through the preferences endpoint", async () => {
    const { authed, userId } = await registerAndLogin(app, "escalate2");
    const adminRole = await prisma.role.findFirstOrThrow({ where: { name: "ADMIN" } });
    const attempt = await authed(app).patch("/api/users/me/preferences").send({ timezone: "Europe/Madrid", roleId: adminRole.id });
    expect(attempt.status).toBe(200);
    expect(attempt.body.user.roleName).toBe("USER");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { roleId: true } });
    expect(stored.roleId).not.toBe(adminRole.id);
  });

  it("refuses to flip account status or verify its own email", async () => {
    const { authed, userId } = await registerAndLogin(app, "escalate3");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true, status: true } });
    await authed(app).patch("/api/users/me").send({
      name: "Esc",
      emailVerifiedAt: new Date().toISOString(),
      status: "SUSPENDED",
      mustChangePassword: false,
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true, status: true } });
    expect(after.emailVerifiedAt).toEqual(before.emailVerifiedAt);
    expect(after.status).toBe(before.status);
  });
});
