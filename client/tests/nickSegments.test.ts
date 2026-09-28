import { describe, it, expect } from "vitest";
import {
  applyColorToRange,
  capSegments,
  isSingleColour,
  normalizeSegments,
  retextSegments,
  segmentsLength,
  segmentsToText,
  textToSegments,
} from "../src/lib/nickSegments";

const RED = "#ef4444";
const BLUE = "#3b82f6";

describe("nick segments", () => {
  it("round-trips plain text", () => {
    expect(segmentsToText(textToSegments("Cris"))).toBe("Cris");
    expect(textToSegments("")).toEqual([]);
    expect(textToSegments("Cris", RED)).toEqual([{ t: "Cris", c: RED }]);
  });

  it("merges neighbours of the same colour and drops empties", () => {
    expect(normalizeSegments([{ t: "Cr" }, { t: "is" }])).toEqual([{ t: "Cris" }]);
    expect(normalizeSegments([{ t: "a", c: RED }, { t: "b", c: RED }])).toEqual([{ t: "ab", c: RED }]);
    expect(normalizeSegments([{ t: "a" }, { t: "" }, { t: "b", c: RED }]))
      .toEqual([{ t: "a" }, { t: "b", c: RED }]);
  });

  it("paints a range in the middle, splitting the piece", () => {
    const out = applyColorToRange(textToSegments("Cristian"), 4, 8, RED);
    expect(out).toEqual([{ t: "Cris" }, { t: "tian", c: RED }]);
    expect(segmentsToText(out)).toBe("Cristian");
  });

  it("paints across a boundary between two colours", () => {
    const base = applyColorToRange(textToSegments("Cristian"), 0, 4, RED);
    const out = applyColorToRange(base, 2, 6, BLUE);
    expect(out).toEqual([{ t: "Cr", c: RED }, { t: "isti", c: BLUE }, { t: "an" }]);
    expect(segmentsToText(out)).toBe("Cristian");
  });

  it("clears a colour with null", () => {
    const base = textToSegments("Cris", RED);
    expect(applyColorToRange(base, 0, 4, null)).toEqual([{ t: "Cris" }]);
  });

  it("ignores an empty selection", () => {
    const base = textToSegments("Cris");
    expect(applyColorToRange(base, 2, 2, RED)).toBe(base);
  });

  it("counts and splits by code point, not UTF-16 unit", () => {
    // Four astral letters: `length` would say 8.
    const gothic = "𝖐𝖗𝖎𝖘";
    expect(gothic.length).toBe(8);
    expect(segmentsLength(textToSegments(gothic))).toBe(4);
    const out = applyColorToRange(textToSegments(gothic), 2, 4, RED);
    expect(segmentsToText(out)).toBe(gothic);
    expect(out).toEqual([{ t: "𝖐𝖗" }, { t: "𝖎𝖘", c: RED }]);
  });

  it("keeps colours when the text is edited around them", () => {
    const base = applyColorToRange(textToSegments("Cristian"), 0, 4, RED);
    // Typing at the end leaves the coloured head alone.
    const grown = retextSegments(base, "Cristians");
    expect(segmentsToText(grown)).toBe("Cristians");
    expect(grown[0]).toEqual({ t: "Cris", c: RED });
    // Deleting from the end likewise.
    const shrunk = retextSegments(base, "Crist");
    expect(segmentsToText(shrunk)).toBe("Crist");
    expect(shrunk[0]).toEqual({ t: "Cris", c: RED });
  });

  it("falls back to plain text when everything changed", () => {
    const base = applyColorToRange(textToSegments("Cristian"), 0, 4, RED);
    expect(retextSegments(base, "")).toEqual([]);
    expect(segmentsToText(retextSegments(base, "Otro"))).toBe("Otro");
  });

  it("caps by code points, dropping whole pieces past the limit", () => {
    const base = applyColorToRange(textToSegments("Cristian"), 4, 8, RED);
    const capped = capSegments(base, 6);
    expect(segmentsToText(capped)).toBe("Cristi");
    expect(segmentsLength(capped)).toBe(6);
  });

  it("knows when pieces are not worth storing", () => {
    expect(isSingleColour(textToSegments("Cris"))).toBe(true);
    expect(isSingleColour(textToSegments("Cris", RED))).toBe(true);
    expect(isSingleColour([{ t: "a", c: RED }, { t: "b", c: BLUE }])).toBe(false);
  });
});
