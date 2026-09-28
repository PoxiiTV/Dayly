/**
 * A nick that changes colour partway through.
 *
 * Stored as a list of pieces, never as markup: `[{ t: "Kris", c: "#ec4899" }]`
 * is data the renderer turns into spans, so there is nothing to parse and
 * nothing to escape — the same reason the single colour was kept out of the
 * text in the first place. A plain nick is simply one piece with no colour.
 *
 * All offsets here are in CODE POINTS, not UTF-16 units: the fancy alphabets
 * are astral, and splitting a name in the middle of a surrogate pair would
 * produce a broken character.
 */

export interface NickSegment {
  /** The text of this piece. Never empty in a normalised list. */
  t: string;
  /** Hex colour, or absent for "whatever the surrounding text uses". */
  c?: string | null;
}

export const MAX_SEGMENTS = 60;

/** The plain text, which is what searching, titles and notifications use. */
export function segmentsToText(segments: NickSegment[]): string {
  return segments.map((s) => s.t).join("");
}

/** One uncoloured piece: what a plain nick looks like as segments. */
export function textToSegments(text: string, color?: string | null): NickSegment[] {
  return text ? [color ? { t: text, c: color } : { t: text }] : [];
}

/** Merges neighbours of the same colour and drops empties. */
export function normalizeSegments(segments: NickSegment[]): NickSegment[] {
  const out: NickSegment[] = [];
  for (const piece of segments) {
    if (!piece.t) continue;
    const colour = piece.c ?? null;
    const last = out[out.length - 1];
    if (last && (last.c ?? null) === colour) last.t += piece.t;
    else out.push(colour ? { t: piece.t, c: colour } : { t: piece.t });
  }
  return out;
}

/** Code points, so callers never index into half a surrogate pair. */
function chars(text: string): string[] {
  return Array.from(text);
}

export function segmentsLength(segments: NickSegment[]): number {
  return segments.reduce((total, piece) => total + chars(piece.t).length, 0);
}

/**
 * Paints `[start, end)` — in code points over the whole nick — with `color`,
 * splitting the pieces it lands inside. `null` clears the colour of the range.
 */
export function applyColorToRange(
  segments: NickSegment[],
  start: number,
  end: number,
  color: string | null,
): NickSegment[] {
  if (end <= start) return segments;
  const out: NickSegment[] = [];
  let at = 0;
  for (const piece of segments) {
    const letters = chars(piece.t);
    const from = at;
    const to = at + letters.length;
    at = to;

    // Entirely outside the selection.
    if (to <= start || from >= end) {
      out.push(piece);
      continue;
    }
    // Entirely inside it.
    if (from >= start && to <= end) {
      out.push({ t: piece.t, c: color });
      continue;
    }
    // Straddles a boundary: keep the outside, repaint the middle.
    const headEnd = Math.max(0, Math.min(letters.length, start - from));
    const tailStart = Math.max(0, Math.min(letters.length, end - from));
    if (headEnd > 0) out.push({ t: letters.slice(0, headEnd).join(""), c: piece.c });
    out.push({ t: letters.slice(headEnd, tailStart).join(""), c: color });
    if (tailStart < letters.length) out.push({ t: letters.slice(tailStart).join(""), c: piece.c });
  }
  return normalizeSegments(out);
}

/**
 * Rebuilds the list after the plain text was edited by hand.
 *
 * Colours follow the text that survived: the common prefix keeps its colours,
 * the common suffix keeps its own, and whatever was typed in between takes the
 * colour of the piece it was typed into. Anything fancier would need a real
 * rich-text field, which this is deliberately not.
 */
export function retextSegments(segments: NickSegment[], text: string): NickSegment[] {
  const before = chars(segmentsToText(segments));
  const after = chars(text);
  if (before.join("") === text) return segments;
  if (!segments.length || !after.length) return textToSegments(text);

  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++;

  const colourAt = (index: number): string | null => {
    let at = 0;
    for (const piece of segments) {
      const length = chars(piece.t).length;
      if (index < at + length) return piece.c ?? null;
      at += length;
    }
    return segments[segments.length - 1]?.c ?? null;
  };

  const middle = after.slice(head, after.length - tail).join("");
  const out: NickSegment[] = [];
  // The untouched head, piece by piece so its colours survive.
  let at = 0;
  for (const piece of segments) {
    const letters = chars(piece.t);
    if (at >= head) break;
    const take = Math.min(letters.length, head - at);
    out.push({ t: letters.slice(0, take).join(""), c: piece.c });
    at += letters.length;
  }
  if (middle) out.push({ t: middle, c: colourAt(Math.max(0, head - 1)) });
  // The untouched tail.
  const tailStart = before.length - tail;
  at = 0;
  for (const piece of segments) {
    const letters = chars(piece.t);
    const from = at;
    at += letters.length;
    if (at <= tailStart) continue;
    const skip = Math.max(0, tailStart - from);
    out.push({ t: letters.slice(skip).join(""), c: piece.c });
  }
  return normalizeSegments(out);
}

/** Trims to a maximum length in code points, dropping whole pieces as needed. */
export function capSegments(segments: NickSegment[], maxChars: number): NickSegment[] {
  const out: NickSegment[] = [];
  let used = 0;
  for (const piece of segments) {
    if (used >= maxChars) break;
    const letters = chars(piece.t);
    const take = Math.min(letters.length, maxChars - used);
    out.push({ t: letters.slice(0, take).join(""), c: piece.c });
    used += take;
  }
  return normalizeSegments(out).slice(0, MAX_SEGMENTS);
}

/** True when every piece shares one colour (or none): no need to store pieces. */
export function isSingleColour(segments: NickSegment[]): boolean {
  if (segments.length <= 1) return true;
  const first = segments[0].c ?? null;
  return segments.every((piece) => (piece.c ?? null) === first);
}
