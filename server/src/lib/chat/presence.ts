import { prisma } from "../prisma.js";
import { logger } from "../logger.js";

/**
 * Chat presence: the state someone picks, and whether anybody is there to see
 * it. A picked state alone would leave "en línea" hanging over an account that
 * closed the app three days ago, so it is only reported while that account's
 * client has been alive recently.
 */

/** What a person can pick. */
export const CHAT_STATUSES = ["ONLINE", "AWAY", "BUSY"] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];

/** What the other side gets told, which adds "nobody home". */
export type ChatPresence = ChatStatus | "OFFLINE";

/** A client that has not checked in for this long counts as gone. */
export const PRESENCE_FRESH_MS = 3 * 60 * 1000;

/** Anything unknown in the column reads as ONLINE, the old implicit state. */
export function parseChatStatus(raw: string | null | undefined): ChatStatus {
  return (CHAT_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as ChatStatus) : "ONLINE";
}

export function presenceOf(user: { chatStatus: string | null; chatSeenAt: Date | null }, now = Date.now()): ChatPresence {
  if (!user.chatSeenAt || now - user.chatSeenAt.getTime() > PRESENCE_FRESH_MS) return "OFFLINE";
  return parseChatStatus(user.chatStatus);
}

/** True when this state means "leave me alone": no sound, no buzz. */
export function isQuietStatus(status: ChatStatus): boolean {
  return status === "BUSY";
}

/**
 * Heartbeat. Called from the two endpoints a live client always hits, so it
 * runs on every poll: the write is throttled per account to keep that cheap,
 * and it is fire-and-forget — a failed heartbeat must never fail the request
 * that carried it.
 */
const HEARTBEAT_EVERY_MS = 60_000;
const lastWrite = new Map<string, number>();

export function touchChatPresence(userId: string): void {
  const now = Date.now();
  const previous = lastWrite.get(userId) ?? 0;
  if (now - previous < HEARTBEAT_EVERY_MS) return;
  lastWrite.set(userId, now);
  // Keeps the map from growing with every account that ever connected.
  if (lastWrite.size > 500) {
    for (const [id, at] of lastWrite) {
      if (now - at > PRESENCE_FRESH_MS) lastWrite.delete(id);
    }
  }
  void prisma.user.update({ where: { id: userId }, data: { chatSeenAt: new Date(now) } })
    .catch((err) => logger.debug({ err }, "chat presence heartbeat failed"));
}
