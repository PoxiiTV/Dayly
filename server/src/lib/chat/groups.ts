import { ApiError } from "../errors.js";
import { prisma } from "../prisma.js";

/**
 * Group conversations.
 *
 * A FriendLink keeps each side's state in its own columns because there are
 * exactly two sides. With more than two, that state belongs on the membership
 * row — unread count, last read, mute, wallpaper, and the "cleared" mark that
 * hides the history for one person only.
 */

/** Enough for a family or a team; past this it is a mailing list. */
export const MAX_GROUP_MEMBERS = 25;
export const MAX_GROUPS_PER_USER = 50;

export type GroupWithMembers = Awaited<ReturnType<typeof loadGroup>>;

const memberCard = {
  id: true,
  name: true,
  avatarUrl: true,
  chatStatus: true,
  chatSeenAt: true,
} as const;

/** The group plus its people, or 404 — never 403: an id is no oracle. */
export async function loadGroup(groupId: string) {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    include: { members: { include: { user: { select: memberCard } } } },
  });
  if (!group) throw ApiError.notFound("Ese grupo no existe.");
  return group;
}

/** The group, having checked the caller belongs to it. */
export async function requireGroupMember(userId: string, groupId: string) {
  const group = await loadGroup(groupId);
  const me = group.members.find((member) => member.userId === userId);
  // Not a member reads exactly like not found: no way to probe for groups.
  if (!me) throw ApiError.notFound("Ese grupo no existe.");
  return { group, me };
}

export function requireGroupOwner(group: { ownerId: string }, userId: string): void {
  if (group.ownerId !== userId) throw ApiError.forbidden("Solo quien creó el grupo puede hacer eso.");
}

/**
 * The people you are allowed to bring in: your own accepted friends. Adding
 * someone you are not friends with would let anyone drag a stranger into a
 * conversation, and "accepted" is the instance's existing consent.
 */
export async function acceptedFriendIds(userId: string): Promise<Set<string>> {
  const links = await prisma.friendLink.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    select: { userAId: true, userBId: true },
  });
  return new Set(links.map((link) => (link.userAId === userId ? link.userBId : link.userAId)));
}

/** Everyone in the group except the person who acted, for fan-out. */
export function otherMemberIds(group: { members: { userId: string }[] }, userId: string): string[] {
  return group.members.filter((member) => member.userId !== userId).map((member) => member.userId);
}
