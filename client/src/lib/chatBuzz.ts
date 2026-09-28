const SHAKE_CLASS = "dayly-buzz";
const SHAKE_MS = 820;
const NUDGE_URL = `${import.meta.env.BASE_URL}sounds/nudge.mp3`;

let shaking = 0;
let audio: AudioContext | null = null;
let nudge: HTMLAudioElement | null = null;

/** The real nudge clip, reused across buzzes so it is only fetched once. */
function playNudgeClip(): boolean {
  if (typeof Audio === "undefined") return false;
  try {
    nudge ??= new Audio(NUDGE_URL);
    nudge.currentTime = 0;
    void nudge.play().catch(() => { /* Not unlocked yet; the fallback covers it. */ });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback for when the clip cannot play: a handful of oscillators with the
 * same shape — a low, rattling thud that drops in pitch.
 */
function synthesiseNudge(): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  audio ??= new Ctor();
  const context = audio;
  if (context.state === "suspended") void context.resume().catch(() => {});

  const now = context.currentTime;
  const out = context.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  out.connect(context.destination);

  // Body: a square wave sliding down, which is what gives it the "thud".
  const body = context.createOscillator();
  body.type = "square";
  body.frequency.setValueAtTime(196, now);
  body.frequency.exponentialRampToValueAtTime(72, now + 0.4);

  // Rattle: a fast tremolo over the body, the part that reads as a shake.
  const rattle = context.createOscillator();
  rattle.type = "sine";
  rattle.frequency.setValueAtTime(22, now);
  const rattleDepth = context.createGain();
  rattleDepth.gain.setValueAtTime(0.45, now);
  rattle.connect(rattleDepth).connect(out.gain);

  body.connect(out);
  body.start(now);
  rattle.start(now);
  body.stop(now + 0.45);
  rattle.stop(now + 0.45);
}

/** The nudge clip on its own, for a buzz that arrives behind another window. */
export function playBuzzSound(): void {
  try {
    if (!playNudgeClip()) synthesiseNudge();
  } catch {
    /* Audio may not be unlocked yet; the taskbar still flashes. */
  }
}

/**
 * The MSN nudge: the window shakes and the clip sounds.
 *
 * Only call it while the window is in front. A shake nobody is looking at is
 * wasted, and worse, replaying it on return would mean a wall of shakes for
 * buzzes that arrived hours ago.
 *
 * Respects `prefers-reduced-motion` — for someone with vestibular sensitivity
 * a shaking screen is not a joke — and falls back to a flash of the accent
 * border, so the buzz still lands.
 */
export function buzzWindow(): void {
  const root = document.documentElement;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // Restart the animation rather than assume the class is gone: two buzzes in
  // a row would otherwise re-add a class already there, which animates nothing.
  root.classList.remove(SHAKE_CLASS, "dayly-buzz-flash");
  void root.offsetWidth;
  root.classList.add(reduced ? "dayly-buzz-flash" : SHAKE_CLASS);
  window.clearTimeout(shaking);
  shaking = window.setTimeout(() => {
    root.classList.remove(SHAKE_CLASS, "dayly-buzz-flash");
  }, SHAKE_MS);
  playBuzzSound();
}
