/** Tones the chat may use. Mirror of `client/src/lib/chatSounds.ts`. */
export const CHAT_SOUND_IDS = ["soundchat"] as const;
export const CHAT_SOUND_OFF = "off";
export const DEFAULT_CHAT_SOUND = "soundchat";

export type ChatSound = (typeof CHAT_SOUND_IDS)[number] | typeof CHAT_SOUND_OFF;

/** Never trust the client with a path: only known ids are stored. */
export function parseChatSound(value: unknown): ChatSound {
  if (value === CHAT_SOUND_OFF) return CHAT_SOUND_OFF;
  if (typeof value === "string" && (CHAT_SOUND_IDS as readonly string[]).includes(value)) {
    return value as ChatSound;
  }
  return DEFAULT_CHAT_SOUND;
}
