import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { http } from "@/lib/api";
import { conversationFromGroup, conversationFromLink, type Conversation } from "@/lib/chatConversation";
import type { ChatFriendsResponse, ChatGroup, ChatIdentity } from "@/lib/types";

export const CHAT_FRIENDS_QUERY_KEY = ["chat-friends"] as const;
export const CHAT_GROUPS_QUERY_KEY = ["chat-groups"] as const;
export const CHAT_IDENTITY_QUERY_KEY = ["chat-identity"] as const;

/**
 * The two sources of chat membership are one cached list to the UI.
 *
 * Sidebar, /chat and the future floating chat all use these query keys, so
 * opening more than one surface does not create another request or another
 * sorting/normalisation implementation.
 */
export function useChatConversations() {
  const friendsQuery = useQuery({
    queryKey: CHAT_FRIENDS_QUERY_KEY,
    queryFn: () => http.get<ChatFriendsResponse>("/api/chat/friends"),
    // The live stream drives updates; this is only a safety net.
    refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
    refetchIntervalInBackground: false,
  });
  const groupsQuery = useQuery({
    queryKey: CHAT_GROUPS_QUERY_KEY,
    queryFn: () => http.get<{ groups: ChatGroup[] }>("/api/chat/groups"),
    refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
    refetchIntervalInBackground: false,
  });

  const friends = friendsQuery.data?.friends ?? [];
  const groups = groupsQuery.data?.groups ?? [];
  const conversations = useMemo(() => [
    ...friends.map(conversationFromLink),
    ...groups.map(conversationFromGroup),
  ].sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()), [friends, groups]);

  return {
    friends,
    groups,
    incoming: friendsQuery.data?.requests.incoming ?? [],
    outgoing: friendsQuery.data?.requests.outgoing ?? [],
    conversations,
    friendsQuery,
    groupsQuery,
    isLoading: friendsQuery.isLoading || groupsQuery.isLoading,
  };
}

export function useChatIdentity() {
  return useQuery({
    queryKey: CHAT_IDENTITY_QUERY_KEY,
    queryFn: () => http.get<ChatIdentity>("/api/chat/me"),
    staleTime: 5 * 60_000,
  });
}

export function conversationKey(conv: Pick<Conversation, "kind" | "id">): string {
  return `${conv.kind}:${conv.id}`;
}

/** Keep a stored choice while data is loading, then fall back if it vanished. */
export function resolveStoredChatConversationKey(conversations: Conversation[], storedKey: string): string {
  if (conversations.length === 0) return storedKey;
  return conversations.some((conv) => conversationKey(conv) === storedKey)
    ? storedKey
    : conversationKey(conversations[0]);
}

/**
 * Selection shared by compact surfaces. The first available conversation is a
 * safe fallback, while the remembered key lets a future bubble and the
 * sidebar reopen on the same chat without coupling either component to a
 * route.
 */
export function useStoredChatConversationSelection(
  conversations: Conversation[],
  storageKey: string,
) {
  const [selectedKey, setSelectedKey] = useState(() => {
    try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
  });
  const selected = conversations.find((conv) => conversationKey(conv) === selectedKey) ?? null;

  useEffect(() => {
    const next = resolveStoredChatConversationKey(conversations, selectedKey);
    if (!next || next === selectedKey) return;
    setSelectedKey(next);
    try { localStorage.setItem(storageKey, next); } catch { /* private mode */ }
  }, [conversations, selectedKey, storageKey]);

  const choose = useCallback((key: string) => {
    setSelectedKey(key);
    try { localStorage.setItem(storageKey, key); } catch { /* private mode */ }
  }, [storageKey]);

  return { selectedKey, selected, choose };
}
