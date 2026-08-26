/**
 * Web Push endpoints we will POST to. Anything else is treated as SSRF.
 */
const ALLOWED_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
  "notify.live.net",
];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
