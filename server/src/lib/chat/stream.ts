import type { Response } from "express";
import { logger } from "../logger.js";

/**
 * Live chat delivery over Server-Sent Events.
 *
 * Polling every four seconds meant a message took up to four seconds to show
 * and burned most of the per-client request budget. One long-lived connection
 * per tab delivers instantly and costs a single request. The client keeps a
 * slow poll as a safety net, so a dropped stream degrades instead of breaking.
 *
 * State is per process and in memory, which matches how this instance runs: a
 * single API container. A second one would need a shared bus.
 */
type Client = { res: Response; userId: string };

const clients = new Map<string, Set<Client>>();

/** Proxies drop a silent connection; this keeps it warm and spots dead sockets. */
const HEARTBEAT_MS = 25_000;

export type ChatEvent =
  | { type: "message"; linkId: string }
  | { type: "message"; groupId: string }
  | { type: "buzz"; linkId: string }
  | { type: "buzz"; groupId: string }
  | { type: "friends" }
  /** Membership or name changed: reload the list of groups. */
  | { type: "groups"; groupId?: string }
  /**
   * Somebody is writing. Deliberately ephemeral: nothing is stored and nothing
   * is invalidated, it just travels to whoever is in the conversation and
   * expires on its own at the other end.
   */
  | { type: "typing"; linkId?: string; groupId?: string; userId: string; name: string };

function write(res: Response, event: string, data: unknown): boolean {
  try {
    return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    return false;
  }
}

/**
 * Registers an open stream and returns the cleanup for the request's close.
 *
 * `onAlive` runs on every heartbeat that the socket accepts, which is the only
 * honest "this person still has the app open" signal the server gets: a tab in
 * the background stops polling, but its stream stays up.
 */
export function addChatClient(userId: string, res: Response, onAlive?: () => void): () => void {
  const client: Client = { res, userId };
  const set = clients.get(userId) ?? new Set<Client>();
  set.add(client);
  clients.set(userId, set);

  const heartbeat = setInterval(() => {
    // A comment frame is invisible to EventSource but keeps the socket warm.
    if (!write(res, "ping", Date.now())) close();
    else onAlive?.();
  }, HEARTBEAT_MS);

  const close = () => {
    clearInterval(heartbeat);
    const current = clients.get(userId);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) clients.delete(userId);
  };
  return close;
}

/** Pushes an event to every tab that user has open. Never throws. */
export function publishChatEvent(userId: string, event: ChatEvent): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  for (const client of [...set]) {
    if (!write(client.res, "chat", event)) {
      set.delete(client);
      try {
        client.res.end();
      } catch (error) {
        logger.debug({ err: error }, "chat stream already closed");
      }
    }
  }
  if (set.size === 0) clients.delete(userId);
}

/** How many tabs are listening; used by the tests and by /api/health checks. */
export function chatClientCount(userId: string): number {
  return clients.get(userId)?.size ?? 0;
}
