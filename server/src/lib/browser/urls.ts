/**
 * The same address policy the embedded browser enforces, on this side of the
 * wire: public HTTPS only.
 *
 * The client checks it before asking (client/src/lib/nativeShell.ts) and the
 * shell checks it again before navigating (parse_public_https in lib.rs). This
 * third copy is what keeps a hand-made request from parking `file:///` or an
 * address on the home network in somebody's bookmarks.
 */
export const MAX_URL_LENGTH = 300;

export function isPublicHttpsUrl(raw: string): boolean {
  if (!raw || raw.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    return false;
  }
  if (host === "::1" || host === "0.0.0.0") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  // Carrier-grade NAT, which is a private range in every way that matters.
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host)) return false;
  return true;
}

/** Same address, same row: the fragment and a trailing slash are not a visit. */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  const text = url.toString();
  return text.endsWith("/") && url.pathname === "/" && !url.search ? text.slice(0, -1) : text;
}
