/**
 * Nick and subnick sanitising.
 *
 * A nick is free text that OTHER people render in their own sidebar and chat
 * list. React escapes HTML, so the risk here is not script injection: it is
 * text that hijacks the layout around it. Three things do that and all three
 * are stripped — bidi overrides (they flip the direction of everything after
 * them), invisible characters (an all-blank nick, or padding past the length
 * cap) and unbounded combining marks ("Zalgo", which grows a row to any
 * height).
 *
 * Decorative symbols are deliberately NOT filtered: the whole point of the
 * feature is the MSN-style ornaments around the name.
 */

/** C0/C1 controls, plus the line and paragraph separators. */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
}

/** Bidi embedding, override and isolate marks. */
function isBidi(cp: number): boolean {
  return cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/** Zero-width and other invisible padding, plus the BOM. */
function isInvisible(cp: number): boolean {
  return cp === 0x00ad || (cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff;
}

/** Combining marks: kept, but never more than two in a row. */
const COMBINING = /\p{M}/u;

const MAX_COMBINING_RUN = 2;

export const NICK_MAX = 80;
export const SUBNICK_MAX = 120;
/** Group names share the cleaning but have their own, shorter column. */
export const GROUP_NAME_MAX = 60;

/**
 * Cleans a nick or subnick. Returns null when nothing usable is left, so an
 * all-invisible value clears the field instead of storing a blank that looks
 * like a missing name.
 */
export function sanitizeNick(value: string | null | undefined, maxChars: number): string | null {
  if (value == null) return null;

  const kept: string[] = [];
  let combiningRun = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp) || isBidi(cp) || isInvisible(cp)) continue;
    if (COMBINING.test(ch)) {
      combiningRun += 1;
      if (combiningRun > MAX_COMBINING_RUN) continue;
    } else {
      combiningRun = 0;
    }
    kept.push(ch);
  }

  // Any run of blanks becomes a single space: leading padding was the classic
  // trick to jump to the top of the MSN contact list.
  const cleaned = kept.join("").replace(/\s+/gu, " ").trim();
  if (!cleaned) return null;

  // Counted in code points, not UTF-16 units: the fancy alphabets are astral
  // and `length` would halve the allowance.
  const chars = Array.from(cleaned);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("").trim() : cleaned;
}

/** What the app shows: the nick when there is one, the account name otherwise. */
export function displayNameOf(user: { name: string; nick?: string | null }): string {
  return user.nick?.trim() || user.name;
}

/**
 * A nick or group name that changes colour partway through.
 *
 * Pieces, never markup: the renderer turns `[{ t, c }]` into spans, so there is
 * nothing to parse and nothing to escape. Each piece's text goes through the
 * same cleaning as a plain nick, and the total is capped in CODE POINTS, which
 * is what the database column counts too.
 */
export interface NickSegment {
  t: string;
  c?: string | null;
}

/** Enough for a letter-by-letter rainbow without letting the column explode. */
export const MAX_NICK_SEGMENTS = 60;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeSegments(value: unknown, maxChars: number): NickSegment[] | null {
  if (!Array.isArray(value)) return null;
  const out: NickSegment[] = [];
  let used = 0;
  for (const raw of value.slice(0, MAX_NICK_SEGMENTS)) {
    if (used >= maxChars) break;
    if (!raw || typeof raw !== "object") continue;
    const text = (raw as { t?: unknown }).t;
    if (typeof text !== "string") continue;
    // Each piece is cleaned on its own, then the running total is what caps it.
    const clean = sanitizeNick(text, maxChars - used);
    if (!clean) continue;
    const colour = (raw as { c?: unknown }).c;
    const hex = typeof colour === "string" && HEX.test(colour) ? colour : null;
    const previous = out[out.length - 1];
    if (previous && (previous.c ?? null) === hex) previous.t += clean;
    else out.push(hex ? { t: clean, c: hex } : { t: clean });
    used += Array.from(clean).length;
  }
  return out.length ? out : null;
}

/** The plain text of a set of pieces, which is what gets stored in `nick`. */
export function segmentsText(segments: NickSegment[]): string {
  return segments.map((piece) => piece.t).join("");
}

/** Pieces are only worth storing when they actually differ in colour. */
export function segmentsAreUniform(segments: NickSegment[]): boolean {
  if (segments.length <= 1) return true;
  const first = segments[0].c ?? null;
  return segments.every((piece) => (piece.c ?? null) === first);
}
