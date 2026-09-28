/** HIBP k-anonymity: only a SHA-1 prefix leaves the browser. Our server is not involved. */

export function pwnedCountFromRange(sha1Hex: string, body: string): number {
  const suffix = sha1Hex.slice(5).toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const [hash, count] = line.trim().split(":");
    if (hash && hash.toUpperCase() === suffix) {
      const n = Number(count);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
  }
  return 0;
}

async function sha1Hex(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function checkPwnedPassword(password: string): Promise<number> {
  const pw = password.trim();
  if (!pw) return 0;
  const hex = await sha1Hex(pw);
  const prefix = hex.slice(0, 5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!res.ok) throw new Error("No se pudo consultar Have I Been Pwned.");
  return pwnedCountFromRange(hex, await res.text());
}
