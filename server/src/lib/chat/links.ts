import { randomInt } from "node:crypto";
import type { FriendLink } from "@prisma/client";
import { ApiError } from "../errors.js";
import { prisma } from "../prisma.js";

/**
 * Crockford Base32: no I, L, O or U, so a code read out loud or copied by hand
 * cannot turn into a different one. Ten characters is 2^50 combinations, well
 * beyond guessing, which is what lets the lookup endpoint stay generous.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

export function generateFriendCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** `XXXXX-XXXXX` for display; storage stays canonical. */
export function formatFriendCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Accepts what a human would actually type: lowercase, spaces, dashes, and the
 * characters Crockford maps back (O to 0, I and L to 1).
 */
export function normalizeFriendCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return null;
  return cleaned;
}

/** Assigns a code on first use; collisions are retried, not ignored. */
export async function ensureFriendCode(userId: string): Promise<string> {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { friendCode: true } });
  if (current.friendCode) return current.friendCode;
  return rotateFriendCode(userId);
}

export async function rotateFriendCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const friendCode = generateFriendCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { friendCode, friendCodeUpdatedAt: new Date() } });
      return friendCode;
    } catch {
      // Unique violation: 2^50 makes this vanishingly rare, but retry anyway.
    }
  }
  throw ApiError.internal("No se pudo generar un código de amigo.");
}

/** Canonical ordering, so a pair has exactly one row whoever asks first. */
export function pairKey(one: string, other: string): { userAId: string; userBId: string } {
  return one < other ? { userAId: one, userBId: other } : { userAId: other, userBId: one };
}

export type LinkSide = {
  side: "A" | "B";
  otherId: string;
  myUnread: "aUnreadCount" | "bUnreadCount";
  otherUnread: "aUnreadCount" | "bUnreadCount";
  myRead: "aLastReadAt" | "bLastReadAt";
  otherRead: "aLastReadAt" | "bLastReadAt";
  myBuzz: "aLastBuzzAt" | "bLastBuzzAt";
  otherBuzz: "aLastBuzzAt" | "bLastBuzzAt";
  myWallpaper: "aWallpaper" | "bWallpaper";
  myMuted: "aMuted" | "bMuted";
  myCleared: "aClearedAt" | "bClearedAt";
};

/** Keeps every counter update from guessing which column belongs to whom. */
export function sideOf(link: Pick<FriendLink, "userAId" | "userBId">, userId: string): LinkSide {
  if (link.userAId === userId) {
    return {
      side: "A", otherId: link.userBId,
      myUnread: "aUnreadCount", otherUnread: "bUnreadCount",
      myRead: "aLastReadAt", otherRead: "bLastReadAt",
      myBuzz: "aLastBuzzAt", otherBuzz: "bLastBuzzAt",
      myWallpaper: "aWallpaper", myMuted: "aMuted", myCleared: "aClearedAt",
    };
  }
  if (link.userBId === userId) {
    return {
      side: "B", otherId: link.userAId,
      myUnread: "bUnreadCount", otherUnread: "aUnreadCount",
      myRead: "bLastReadAt", otherRead: "aLastReadAt",
      myBuzz: "bLastBuzzAt", otherBuzz: "aLastBuzzAt",
      myWallpaper: "bWallpaper", myMuted: "bMuted", myCleared: "bClearedAt",
    };
  }
  // Guarded by the queries above; reaching here would be a programming error.
  throw ApiError.notFound("La conversación no existe.");
}

/**
 * Any link the user takes part in. Same doctrine as `assertOwned`: a stranger
 * gets 404, never 403, so an id is not an oracle for what exists.
 */
export async function requireLink(userId: string, linkId: string): Promise<FriendLink> {
  const link = await prisma.friendLink.findFirst({
    where: { id: linkId, OR: [{ userAId: userId }, { userBId: userId }] },
  });
  if (!link) throw ApiError.notFound("La conversación no existe.");
  return link;
}

/**
 * A link that can carry messages. Blocking is deliberately asymmetric: for the
 * blocked user the friend simply vanishes, indistinguishable from a deleted
 * account, while the blocker keeps the thread read-only to undo it.
 */
export async function requireAcceptedLink(userId: string, linkId: string): Promise<FriendLink> {
  const link = await requireLink(userId, linkId);
  if (link.status !== "ACCEPTED") throw ApiError.notFound("La conversación no existe.");
  return link;
}
