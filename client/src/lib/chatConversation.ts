import { STATUS_META, parseChatPresence } from "@/lib/chatStatus";
import type { ChatGroup, ChatGroupMember, ChatLink } from "@/lib/types";

/**
 * One shape for both kinds of conversation.
 *
 * A one-to-one and a group differ in who is on the other side and in what you
 * can do (there is nobody to buzz in a group, and no read receipt from five
 * people), but everything else — the thread, the composer, the wallpaper, the
 * unread badge — is the same screen. Normalising here keeps that screen from
 * growing two of everything.
 */
export type Conversation = {
  kind: "direct" | "group";
  /** linkId or groupId; unique across both, so it can key a query. */
  id: string;
  basePath: string;
  title: string;
  /** Colour and weight of the title, when the other side decorated their nick. */
  titleColor?: string | null;
  /** Coloured pieces of the title, when it changes colour partway through. */
  titleSegments?: { t: string; c?: string | null }[] | null;
  titleBold?: boolean;
  /** Their MSN line, shown under the name in the list and the header. */
  subnick?: string | null;
  avatarUrl: string | null;
  /** Under the title: their state, or how many people are here. */
  subtitle: string;
  /** Presence of the other person; groups have none of their own. */
  status?: string;
  members?: ChatGroupMember[];
  muted: boolean;
  wallpaper: string | null;
  blocked: boolean;
  /** When the other side last read, for the ticks. One-to-one only. */
  otherReadAt: string | null;
  canBuzz: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastMessageMine: boolean | null;
  /** The group as it came from the server, for its own menu. */
  group?: ChatGroup;
  link?: ChatLink;
};

export function conversationFromLink(link: ChatLink): Conversation {
  return {
    kind: "direct",
    id: link.linkId,
    basePath: `/api/chat/threads/${link.linkId}`,
    // The nick is what they want to be called; the account name is the fallback.
    title: link.user.nick?.trim() || link.user.name,
    titleColor: link.user.nickColor ?? null,
    titleSegments: link.user.nickSegments ?? null,
    titleBold: Boolean(link.user.nickBold),
    subnick: link.user.subnick ?? null,
    avatarUrl: link.user.avatarUrl,
    subtitle: STATUS_META[parseChatPresence(link.user.status)].label,
    status: link.user.status,
    muted: link.muted ?? false,
    wallpaper: link.wallpaper ?? null,
    blocked: link.status === "BLOCKED",
    otherReadAt: link.otherReadAt ?? null,
    canBuzz: true,
    unreadCount: link.unreadCount,
    lastMessageAt: link.lastMessageAt,
    lastMessage: link.lastMessage ?? null,
    lastMessageMine: link.lastMessageMine ?? null,
    link,
  };
}

export function conversationFromGroup(group: ChatGroup): Conversation {
  return {
    kind: "group",
    id: group.groupId,
    basePath: `/api/chat/groups/${group.groupId}`,
    title: group.name,
    titleSegments: group.nameSegments ?? null,
    avatarUrl: group.avatarUrl ?? null,
    subtitle: `${group.members.length} participantes`,
    members: group.members,
    muted: group.muted,
    wallpaper: group.wallpaper ?? null,
    blocked: false,
    otherReadAt: null,
    // There is no one person to shake, and shaking everybody is not a poke.
    // Groups buzz too, with a much longer cooldown: see the route.
    canBuzz: true,
    unreadCount: group.unreadCount,
    lastMessageAt: group.lastMessageAt,
    lastMessage: group.lastMessage ?? null,
    lastMessageMine: group.lastMessageMine ?? null,
    group,
  };
}

/** Who wrote this, for the name over a message in a group. */
export function senderName(conv: Conversation, senderId: string): string | null {
  if (conv.kind !== "group") return null;
  return conv.members?.find((member) => member.id === senderId)?.name ?? "Alguien";
}
