/**
 * Catalogue of chat message sounds.
 *
 * Deliberately a plain list: adding a tone is dropping the file into
 * `client/public/sounds/` and adding one line here and in the server's copy
 * (`server/src/lib/chat/sounds.ts`), which keeps the two in step.
 */
export const CHAT_SOUNDS = [
  { id: "soundchat", name: "Clásico", hint: "El aviso de mensaje de toda la vida", file: "soundchat.mp3" },
] as const;

export type ChatSoundId = (typeof CHAT_SOUNDS)[number]["id"];

export const DEFAULT_CHAT_SOUND: ChatSoundId = "soundchat";
/** Muting the tone without touching the rest of the chat notifications. */
export const CHAT_SOUND_OFF = "off";
export type ChatSoundChoice = ChatSoundId | typeof CHAT_SOUND_OFF;

export function parseChatSound(value: unknown): ChatSoundChoice {
  if (value === CHAT_SOUND_OFF) return CHAT_SOUND_OFF;
  if (typeof value === "string" && CHAT_SOUNDS.some((sound) => sound.id === value)) return value as ChatSoundId;
  return DEFAULT_CHAT_SOUND;
}

function chatSoundUrl(id: ChatSoundId): string {
  const file = CHAT_SOUNDS.find((sound) => sound.id === id)?.file;
  return `${import.meta.env.BASE_URL || "/"}sounds/${file ?? "soundchat.mp3"}`;
}

const cache = new Map<string, HTMLAudioElement>();

/** Plays the chosen tone. `preview` ignores "off", so the picker can be heard. */
export function playChatSound(value: unknown, opts?: { preview?: boolean }): void {
  const choice = opts?.preview && value === CHAT_SOUND_OFF ? DEFAULT_CHAT_SOUND : parseChatSound(value);
  if (choice === CHAT_SOUND_OFF || typeof Audio === "undefined") return;
  try {
    const url = chatSoundUrl(choice);
    let audio = cache.get(url);
    if (!audio) {
      audio = new Audio(url);
      cache.set(url, audio);
    }
    audio.currentTime = 0;
    audio.volume = 0.9;
    void audio.play().catch(() => { /* Audio not unlocked yet in this tab. */ });
  } catch {
    /* A missing tone must never break delivery of the message itself. */
  }
}
