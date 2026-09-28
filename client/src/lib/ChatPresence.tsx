import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConditional, http } from "@/lib/api";
import { clearTyping, noteTyping } from "@/lib/chatTyping";
import { useToast } from "@/components/ui";
import { buzzWindow, playBuzzSound } from "@/lib/chatBuzz";
import { playChatSound } from "@/lib/chatSounds";
import { isQuietStatus, parseChatStatus } from "@/lib/chatStatus";
import { flashNativeTaskbar } from "@/lib/nativeShell";
import { isParkedInTray } from "@/lib/trayState";
import type { ChatFriendsResponse, ChatGroup, ChatIdentity, ChatSync } from "@/lib/types";

const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";
/**
 * Only a safety net. The live stream is what makes the chat feel instant; this
 * catches the case where it dies without the browser noticing.
 */
const FALLBACK_POLL_MS = 25_000;
/** Without a stream (demo build, or a proxy that eats SSE) we still poll. */
const DEGRADED_POLL_MS = 5_000;

type Presence = { unreadTotal: number; pendingIncoming: number; live: boolean };

const ChatPresenceCtx = createContext<Presence>({ unreadTotal: 0, pendingIncoming: 0, live: false });

/** Unread badge for the sidebar, without every consumer polling on its own. */
export function useChatPresence(): Presence {
  return useContext(ChatPresenceCtx);
}

/**
 * Keeps the chat live from wherever the user is, so a message or a buzz lands
 * on any page.
 *
 * Delivery is a single Server-Sent Events connection: a message shows up the
 * moment it is sent instead of up to four seconds later, and one long-lived
 * request replaces the hundreds that polling used to spend.
 */
function threadOf(data: { linkId?: string; groupId?: string }): string | null {
  return data.linkId ?? data.groupId ?? null;
}

export function ChatPresenceProvider({ children }: PropsWithChildren) {
  const [presence, setPresence] = useState<Presence>({ unreadTotal: 0, pendingIncoming: 0, live: false });
  const qc = useQueryClient();
  const { push } = useToast();
  // The first successful sync only sets the baseline. Without this, every page
  // reload would replay the last buzz.
  const baselineRef = useRef(false);
  const buzzRef = useRef(new Map<string, string>());
  const buzzEnabled = useRef(true);
  const soundRef = useRef<string>("soundchat");
  /** "No disponible": everything still arrives, nothing makes a noise. */
  const quietRef = useRef(false);
  /** Only used when there is no stream: then sync is what spots a message. */
  const unreadRef = useRef(0);

  // Through the cache, not a one-off fetch: changing your state anywhere in
  // the app invalidates this key and the refs follow within the same tick.
  const identity = useQuery({
    queryKey: ["chat-identity"],
    queryFn: () => http.get<ChatIdentity>("/api/chat/me"),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!identity.data) return;
    buzzEnabled.current = identity.data.buzzEnabled;
    soundRef.current = identity.data.sound;
    quietRef.current = isQuietStatus(parseChatStatus(identity.data.status));
  }, [identity.data]);

  useEffect(() => {
    let alive = true;
    let live = false;
    let timer = 0;

    /** A silenced conversation still updates the badge, it just stays quiet. */
    const silenced = (id: { linkId?: string; groupId?: string }): boolean => {
      // "No disponible" silences the lot, conversation by conversation or not.
      if (quietRef.current) return true;
      if (id.groupId) {
        const cached = qc.getQueryData<{ groups: ChatGroup[] }>(["chat-groups"]);
        return cached?.groups.some((group) => group.groupId === id.groupId && group.muted) ?? false;
      }
      if (!id.linkId) return false;
      const cached = qc.getQueryData<ChatFriendsResponse>(["chat-friends"]);
      return cached?.friends.some((friend) => friend.linkId === id.linkId && friend.muted) ?? false;
    };

    /**
     * Buzzes the stream already announced. No expiry on purpose: the sync that
     * spots one may land seconds later or when the window is restored hours
     * later, and either way it must not sound a second time.
     */
    const announced = new Set<string>();

    /**
     * A buzz shakes the window only when it is in front. Behind another one it
     * is heard and the taskbar flashes, and that is the end of it: coming back
     * must never replay the shakes that piled up while you were away.
     */
    const announceBuzz = () => {
      if (quietRef.current || isParkedInTray()) return;
      if (document.hasFocus()) {
        if (buzzEnabled.current) buzzWindow();
        else playBuzzSound();
        return;
      }
      playBuzzSound();
      alertAway();
    };

    /** Rings the taskbar button when the message landed behind another window. */
    const alertAway = () => {
      if (document.hasFocus() || isParkedInTray()) return;
      void flashNativeTaskbar(true);
    };

    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const state = await getConditional<ChatSync>("/api/chat/sync");
        if (!alive) return;
        setPresence({ unreadTotal: state.unreadTotal, pendingIncoming: state.pendingIncoming, live });

        const grew = state.unreadTotal > unreadRef.current;
        unreadRef.current = state.unreadTotal;
        if (!live && baselineRef.current && grew && !quietRef.current && !isParkedInTray()) {
          playChatSound(soundRef.current);
          alertAway();
        }

        const seen = buzzRef.current;
        for (const thread of state.threads) {
          const last = thread.otherBuzzAt;
          if (!last) continue;
          const previous = seen.get(thread.linkId);
          seen.set(thread.linkId, last);
          if (!baselineRef.current || previous === last || silenced({ linkId: thread.linkId })) continue;

          // With a stream the event already announced this one, whenever that
          // was: the sync only catches up on the mark.
          if (announced.delete(thread.linkId)) continue;
          announceBuzz();
          push("info", "Te han mandado un zumbido");
        }
        baselineRef.current = true;
      } catch {
        /* A failed sync is not worth bothering the user about. */
      }
    };

    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void sync(), live ? FALLBACK_POLL_MS : DEGRADED_POLL_MS);
    };

    void sync();
    schedule();

    let source: EventSource | null = null;
    if (!IS_DEMO && typeof EventSource !== "undefined") {
      source = new EventSource("/api/chat/events", { withCredentials: true });
      source.addEventListener("open", () => {
        live = true;
        schedule();
      });
      source.addEventListener("chat", (event) => {
        let data: { type?: string; linkId?: string; groupId?: string; userId?: string; name?: string } = {};
        try {
          data = JSON.parse((event as MessageEvent).data) as typeof data;
        } catch {
          return;
        }
        // Typing is ephemeral: no sound, no badge, no cache to invalidate.
        // Handled before everything else so it returns without touching any.
        if (data.type === "typing") {
          const thread = data.linkId ?? data.groupId;
          if (thread && data.userId) noteTyping(thread, data.userId, data.name || "Alguien");
          return;
        }
        // Straight off the stream, not off the sync: sync only runs while the
        // tab is visible, and the whole point is to be heard from behind
        // another window. The buzz baseline keeps `sync` from repeating it.
        const quiet = silenced({ linkId: data.linkId, groupId: data.groupId });
        if (data.type === "message") {
          // Their message landed, so they are no longer writing.
          if (threadOf(data)) clearTyping(threadOf(data)!);
          if (!quiet && !isParkedInTray()) {
            playChatSound(soundRef.current);
            alertAway();
          }
        } else if (data.type === "buzz") {
          if (data.linkId) announced.add(data.linkId);
          if (!quiet) announceBuzz();
        }
        const threadId = data.linkId ?? data.groupId;
        if (threadId) void qc.invalidateQueries({ queryKey: ["chat-thread", threadId] });
        void qc.invalidateQueries({ queryKey: ["chat-friends"] });
        void qc.invalidateQueries({ queryKey: ["chat-groups"] });
        void sync();
      });
      source.addEventListener("error", () => {
        // EventSource reconnects on its own; until it does, poll faster.
        live = false;
        schedule();
      });
    }

    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    const onFocus = () => { void flashNativeTaskbar(false); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      source?.close();
    };
  }, [push, qc]);

  return <ChatPresenceCtx.Provider value={presence}>{children}</ChatPresenceCtx.Provider>;
}
