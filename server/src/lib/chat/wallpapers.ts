/** Backgrounds a conversation may use. Mirror of `client/src/lib/chatWallpapers.ts`. */
export const CHAT_WALLPAPER_IDS = [
  "aurora", "sunset", "mint", "lavender", "sand", "ocean", "graphite", "dots", "grid", "hex", "petal", "slate",
  "ink", "teal", "moss", "rose", "amber", "plum", "steel", "linen",
] as const;

export type ChatWallpaper = (typeof CHAT_WALLPAPER_IDS)[number];

/**
 * Only known ids are stored: the value ends up in a `style`, so anything the
 * caller invents must never reach the page.
 */
export function parseChatWallpaper(value: unknown): ChatWallpaper | null {
  if (typeof value !== "string") return null;
  return (CHAT_WALLPAPER_IDS as readonly string[]).includes(value) ? (value as ChatWallpaper) : null;
}
