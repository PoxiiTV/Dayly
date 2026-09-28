export const NOTIFY_SOUND_IDS = ["bell", "ring", "chime", "ding", "digital", "wood", "crystal", "marimba"] as const;
export type NotifySoundId = (typeof NOTIFY_SOUND_IDS)[number];

export const DEFAULT_NOTIFY_SOUND: NotifySoundId = "bell";
const STORAGE = "dayly.notifySound";
const ENABLED_STORAGE = "dayly.notifySoundEnabled";

export const NOTIFY_SOUNDS: { id: NotifySoundId; name: string; hint: string }[] = [
  { id: "bell", name: "Campana", hint: "Dos notas, tipo timbre de mesa" },
  { id: "ring", name: "Timbre", hint: "Tres toques cortos, estilo teléfono" },
  { id: "chime", name: "Carillón", hint: "Tres notas ascendentes" },
  { id: "ding", name: "Ding", hint: "Un toque agudo" },
  { id: "digital", name: "Digital", hint: "Dos pitidos secos" },
  { id: "wood", name: "Madera", hint: "Golpe suave" },
  { id: "crystal", name: "Cristal", hint: "Ping brillante" },
  { id: "marimba", name: "Marimba", hint: "Tres notas cálidas" },
];

export function parseNotifySound(value: unknown): NotifySoundId {
  if (typeof value === "string" && (NOTIFY_SOUND_IDS as readonly string[]).includes(value)) {
    return value as NotifySoundId;
  }
  return DEFAULT_NOTIFY_SOUND;
}

export function notifySoundUrl(id: NotifySoundId): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}sounds/${id}.wav`;
}

export function readSavedNotifySound(): NotifySoundId {
  try {
    return parseNotifySound(localStorage.getItem(STORAGE));
  } catch {
    return DEFAULT_NOTIFY_SOUND;
  }
}

export function persistNotifySound(id: NotifySoundId) {
  try {
    localStorage.setItem(STORAGE, id);
  } catch { /* quota */ }
}

export function readNotifySoundEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_STORAGE);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch { /* quota */ }
  return true;
}

export function persistNotifySoundEnabled(on: boolean) {
  try {
    localStorage.setItem(ENABLED_STORAGE, on ? "1" : "0");
  } catch { /* quota */ }
}

let unlocked = false;
let current: HTMLAudioElement | null = null;

export function unlockNotifyAudio() {
  if (unlocked || typeof Audio === "undefined") return;
  const audio = new Audio(notifySoundUrl(readSavedNotifySound()));
  audio.volume = 0.01;
  void audio.play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      unlocked = true;
    })
    .catch(() => { /* need a later gesture */ });
}

export function playNotifySound(id: unknown = readSavedNotifySound(), opts?: { preview?: boolean }) {
  if (!opts?.preview && !readNotifySoundEnabled()) return;
  if (typeof Audio === "undefined") return;
  const sound = parseNotifySound(id);
  persistNotifySound(sound);
  try {
    current?.pause();
    const audio = new Audio(notifySoundUrl(sound));
    audio.volume = 0.85;
    current = audio;
    void audio.play().then(() => { unlocked = true; }).catch(() => { /* autoplay until unlocked */ });
  } catch { /* ignore */ }
}
