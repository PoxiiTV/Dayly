/** Keep in sync with client/src/lib/notifySounds.ts */
export const NOTIFY_SOUND_IDS = ["bell", "ring", "chime", "ding", "digital", "wood", "crystal", "marimba"] as const;
export type NotifySoundId = (typeof NOTIFY_SOUND_IDS)[number];
export const DEFAULT_NOTIFY_SOUND: NotifySoundId = "bell";

export function parseNotifySound(value: unknown): NotifySoundId {
  if (typeof value === "string" && (NOTIFY_SOUND_IDS as readonly string[]).includes(value)) {
    return value as NotifySoundId;
  }
  return DEFAULT_NOTIFY_SOUND;
}
