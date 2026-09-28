/**
 * Whether this machine is already going out through Cloudflare.
 *
 * WARP has two modes and they look nothing alike from here. In its usual
 * "Warp" mode it is a full tunnel: everything on the computer goes through
 * Cloudflare and there is no local proxy to point anything at — a port probe
 * finds nothing and would wrongly report that WARP is off. In "proxy" mode it
 * exposes a SOCKS listener and tunnels only what is sent to it.
 *
 * Cloudflare's own trace endpoint answers the first question directly, so the
 * shield can tell "ya sales por WARP" from "WARP no está escuchando".
 */
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const TIMEOUT_MS = 3_000;

export type WarpEgress = "warp" | "direct" | "unknown";

export async function checkWarpEgress(): Promise<WarpEgress> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(TRACE_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return "unknown";
    const text = await response.text();
    const line = text.split("\n").find((row) => row.startsWith("warp="));
    if (!line) return "unknown";
    const value = line.slice("warp=".length).trim();
    // "plus" is WARP+, same tunnel with a better route.
    return value === "on" || value === "plus" ? "warp" : "direct";
  } catch {
    // Offline, blocked or slow: better to say nothing than to guess.
    return "unknown";
  } finally {
    window.clearTimeout(timer);
  }
}
