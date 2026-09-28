import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ApiError } from "./errors.js";

export function isPublicIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  const words = ipv6Words(normalized);
  if (!words) return false;
  // Globally routable unicast currently lives in 2000::/3. Restricting mail
  // endpoints to it also rejects every textual spelling of loopback, ULA,
  // link/site-local, multicast, IPv4-mapped and translation prefixes.
  if ((words[0] & 0xe000) !== 0x2000) return false;
  // IETF protocol assignments, documentation, 6to4 and the newer
  // documentation prefix are not valid Internet mail destinations.
  if (words[0] === 0x2001 && words[1] < 0x0200) return false; // 2001::/23
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false; // 2001:db8::/32
  if (words[0] === 0x2002) return false; // 2002::/16
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false; // 3fff::/20
  return true;
}

function ipv6Words(address: string): number[] | null {
  let raw = address;
  if (raw.includes(".")) {
    const splitAt = raw.lastIndexOf(":");
    const ipv4 = raw.slice(splitAt + 1);
    const parts = ipv4.split(".").map(Number);
    if (splitAt < 0 || parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    raw = `${raw.slice(0, splitAt)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

export type PublicHostTarget = { address: string; servername?: string };

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export async function resolvePublicHost(host: string): Promise<PublicHostTarget> {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw ApiError.badRequest("El servidor de correo debe ser un host público.");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = isIP(normalized) ? [{ address: normalized }] : await lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw ApiError.badRequest("No se pudo resolver el servidor de correo indicado.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw ApiError.badRequest("El servidor de correo apunta a una red privada o reservada.");
  }
  return {
    address: addresses[0].address,
    ...(isIP(normalized) ? {} : { servername: normalized }),
  };
}

export async function assertPublicHost(host: string): Promise<void> {
  await resolvePublicHost(host);
}

export function assertSecureMailboxTransport(input: { imapSecure: boolean; smtpSecure: boolean; smtpPort: number }): void {
  if (!input.imapSecure) throw ApiError.badRequest("IMAP debe usar TLS directo.");
  if (!input.smtpSecure && ![25, 587, 2525].includes(input.smtpPort)) {
    throw ApiError.badRequest("SMTP debe usar TLS directo o STARTTLS en un puerto compatible.");
  }
}

export async function assertSafeMailboxConfig(input: {
  imapHost: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}): Promise<void> {
  assertSecureMailboxTransport(input);
  await Promise.all([assertPublicHost(input.imapHost), assertPublicHost(input.smtpHost)]);
}
