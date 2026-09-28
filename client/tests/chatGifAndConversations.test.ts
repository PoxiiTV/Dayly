import { describe, expect, it } from "vitest";
import {
  isChatGifPopoverTarget,
  reduceChatGifPickerOpen,
  sendChatGifAndClose,
  sendChatGifOnPointerClick,
} from "../src/components/chat/ChatGifBrowser";
import {
  conversationKey,
  resolveStoredChatConversationKey,
} from "../src/lib/chatConversations";
import type { ChatGif } from "../src/lib/types";
import type { Conversation } from "../src/lib/chatConversation";

const gif: ChatGif = {
  url: "https://media.example/gif.gif",
  preview: "https://media.example/preview.gif",
  width: 320,
  height: 180,
  description: "saludo",
};

function conversation(kind: Conversation["kind"], id: string): Conversation {
  return {
    kind,
    id,
    basePath: `/api/chat/${id}`,
    title: id,
    avatarUrl: null,
    subtitle: "",
    muted: false,
    wallpaper: null,
    blocked: false,
    otherReadAt: null,
    canBuzz: false,
    unreadCount: 0,
    lastMessageAt: null,
    lastMessage: null,
    lastMessageMine: null,
  };
}

describe("compact GIF picker contracts", () => {
  it("toggles open and closes explicitly", () => {
    expect(reduceChatGifPickerOpen(false, "toggle")).toBe(true);
    expect(reduceChatGifPickerOpen(true, "toggle")).toBe(false);
    expect(reduceChatGifPickerOpen(true, "close")).toBe(false);
  });

  it("sends the selected GIF before closing the popup", () => {
    const events: string[] = [];
    sendChatGifAndClose(gif, () => events.push("send"), () => events.push("close"));
    expect(events).toEqual(["send", "close"]);
  });

  it("sends only from pointer clicks and clears tile focus before sending", () => {
    const events: string[] = [];
    const tile = { blur: () => events.push("blur") };
    const send = () => events.push("send");
    sendChatGifOnPointerClick({ detail: 0, currentTarget: tile }, gif, send);
    expect(events).toEqual([]);
    sendChatGifOnPointerClick({ detail: 1, currentTarget: tile }, gif, send);
    expect(events).toEqual(["blur", "send"]);
  });

  it("recognises clicks from the portalled popup", () => {
    const target = {
      closest: (selector: string) => selector === "[data-chat-gif-popover]" ? {} : null,
    } as unknown as EventTarget;
    expect(isChatGifPopoverTarget(target)).toBe(true);
    expect(isChatGifPopoverTarget(null)).toBe(false);
  });
});

describe("stored chat conversation selection", () => {
  const direct = conversation("direct", "link-1");
  const group = conversation("group", "group-1");

  it("keeps a valid stored selection and falls back when it disappears", () => {
    expect(conversationKey(direct)).toBe("direct:link-1");
    expect(resolveStoredChatConversationKey([direct, group], "group:group-1")).toBe("group:group-1");
    expect(resolveStoredChatConversationKey([direct, group], "direct:gone")).toBe("direct:link-1");
  });

  it("does not discard the stored key while conversations are loading", () => {
    expect(resolveStoredChatConversationKey([], "group:group-1")).toBe("group:group-1");
  });
});
