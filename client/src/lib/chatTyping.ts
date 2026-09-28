import { useSyncExternalStore } from "react";
import { http } from "@/lib/api";

/**
 * Who is writing right now, per conversation.
 *
 * Kept outside React state on purpose: a "typing" event arrives every few
 * seconds per open conversation, and putting that in the presence context
 * would re-render the whole app each time. Components subscribe to the one
 * conversation they show.
 *
 * Nothing here is persisted. An entry expires on its own, so a tab that closes
 * mid-sentence stops "typing" without the server having to say so.
 */

/** How long a single ping keeps somebody marked as writing. */
const EXPIRY_MS = 6_000;

/** The client never pings faster than this, even mid-sentence. */
const THROTTLE_MS = 3_000;

type Entry = { name: string; until: number };

/** conversationId -> userId -> entry */
const byThread = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
/** Snapshot per thread, so useSyncExternalStore sees a stable reference. */
const snapshots = new Map<string, string[]>();

const EMPTY: string[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

function liveNames(threadId: string): string[] {
  const entries = byThread.get(threadId);
  if (!entries) return EMPTY;
  const now = Date.now();
  const names: string[] = [];
  for (const [userId, entry] of entries) {
    if (entry.until <= now) entries.delete(userId);
    else names.push(entry.name);
  }
  if (entries.size === 0) byThread.delete(threadId);
  return names.length ? names : EMPTY;
}

/** Recomputes the cached snapshot, and reports whether it actually changed. */
function refresh(threadId: string): boolean {
  const names = liveNames(threadId);
  const previous = snapshots.get(threadId) ?? EMPTY;
  if (previous.length === names.length && previous.every((n, i) => n === names[i])) return false;
  if (names === EMPTY) snapshots.delete(threadId);
  else snapshots.set(threadId, names);
  return true;
}

/** Called from the SSE handler when the other side reports typing. */
export function noteTyping(threadId: string, userId: string, name: string): void {
  const entries = byThread.get(threadId) ?? new Map<string, Entry>();
  entries.set(userId, { name, until: Date.now() + EXPIRY_MS });
  byThread.set(threadId, entries);
  if (refresh(threadId)) emit();
  // Wake up once the entry has expired so the label disappears by itself.
  window.setTimeout(() => { if (refresh(threadId)) emit(); }, EXPIRY_MS + 100);
}

/** Their own message arrived: they clearly stopped writing. */
export function clearTyping(threadId: string, userId?: string): void {
  const entries = byThread.get(threadId);
  if (!entries) return;
  if (userId) entries.delete(userId);
  else entries.clear();
  if (refresh(threadId)) emit();
}

/** The names currently writing in a conversation; empty array when nobody is. */
export function useTypingNames(threadId: string | null | undefined): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (threadId ? snapshots.get(threadId) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
}

/** "Ana está escribiendo…", and something sensible when it is a crowd. */
export function typingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está escribiendo…`;
  if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
  return "Varias personas están escribiendo…";
}

const lastPing = new Map<string, number>();

/**
 * Tells the other side we are writing, at most once every few seconds. Failures
 * are swallowed: a missed "typing" is not worth a toast, and the label expires
 * on its own anyway.
 */
export function pingTyping(basePath: string): void {
  const now = Date.now();
  if (now - (lastPing.get(basePath) ?? 0) < THROTTLE_MS) return;
  lastPing.set(basePath, now);
  void http.post(`${basePath}/typing`).catch(() => { /* ephemeral by design */ });
}
