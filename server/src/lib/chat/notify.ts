import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { parseNotifySound } from "../notifySound.js";
import { sendWebPush } from "../push.js";

/** Skip the push when the recipient is demonstrably looking at the thread. */
const READING_WINDOW_MS = 30_000;

export type ChatNotice = {
  toUserId: string;
  fromName: string;
  /** One of the two: which conversation this came from. */
  linkId?: string;
  groupId?: string;
  /** Set for a group, so the notice says where the message landed. */
  groupName?: string;
  kind: "TEXT" | "BUZZ" | "GIF" | "FILE";
  preview: string;
  /** When the recipient last opened this thread, to avoid pushing mid-chat. */
  lastReadAt: Date | null;
};

/**
 * Announces a chat message in-app and by push.
 *
 * Deliberately *not* `notifyOnce`: its de-duplication matches any notification
 * with the same actionUrl and has no time window, so only the first message of
 * each thread would ever be announced. Here the existing row is refreshed
 * instead, which also keeps the bell to one entry per conversation.
 *
 * Telegram and personal email are left out on purpose: relaying private
 * messages between users to an external bot or mailbox is not something the
 * participants agreed to.
 */
export async function notifyChatMessage(notice: ChatNotice): Promise<void> {
  const actionUrl = notice.groupId ? `/chat?g=${notice.groupId}` : `/chat?t=${notice.linkId}`;
  const title = notice.kind === "BUZZ"
    ? `Zumbido de ${notice.fromName}`
    : notice.groupName
      ? `${notice.groupName}: ${notice.fromName}`
      : notice.fromName;
  const body = notice.kind === "BUZZ" ? "Te ha mandado un zumbido." : notice.preview;

  try {
    const existing = await prisma.notification.findFirst({
      where: { userId: notice.toUserId, actionUrl },
      select: { id: true },
    });
    if (existing) {
      await prisma.notification.update({
        where: { id: existing.id },
        data: { title, body, read: false, type: "CHAT" },
      });
    } else {
      await prisma.notification.create({
        data: { userId: notice.toUserId, type: "CHAT", title, body, actionUrl },
      });
    }
  } catch (error) {
    logger.warn({ err: error, userId: notice.toUserId }, "chat notification failed");
  }

  const reading = notice.lastReadAt !== null && Date.now() - notice.lastReadAt.getTime() < READING_WINDOW_MS;
  if (reading && notice.kind !== "BUZZ") return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: notice.toUserId },
      select: { notifySound: true, notifySoundEnabled: true },
    });
    await sendWebPush(notice.toUserId, {
      title,
      body,
      url: actionUrl,
      sound: user?.notifySoundEnabled === false ? "off" : parseNotifySound(user?.notifySound),
    });
  } catch (error) {
    logger.warn({ err: error, userId: notice.toUserId }, "chat push failed");
  }
}
