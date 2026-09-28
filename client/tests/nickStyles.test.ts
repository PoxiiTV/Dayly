import { describe, it, expect } from "vitest";
import {
  NICK_FONTS, NICK_SYMBOLS, NICK_TEMPLATES,
  applyFont, applyTemplate, nickLength, previewFonts, previewTemplates,
} from "../src/lib/nickStyles";

describe("nick alphabets", () => {
  it("has 26 glyphs per case, and 10 digits when it claims to", () => {
    for (const font of NICK_FONTS) {
      expect(Array.from(font.upper), font.id).toHaveLength(26);
      expect(Array.from(font.lower), font.id).toHaveLength(26);
      if (font.digits) expect(Array.from(font.digits), font.id).toHaveLength(10);
    }
  });

  it("rewrites A-Z and a-z", () => {
    const gothic = NICK_FONTS.find((f) => f.id === "gotica")!;
    expect(applyFont("Kris", gothic)).toBe("𝕶𝖗𝖎𝖘");
    const wide = NICK_FONTS.find((f) => f.id === "ancha")!;
    expect(applyFont("abc", wide)).toBe("ａｂｃ");
  });

  it("leaves alone what the alphabet does not cover", () => {
    const gothic = NICK_FONTS.find((f) => f.id === "gotica")!;
    // Accents, spaces and ornaments survive untouched.
    expect(applyFont("Kristián ★", gothic)).toBe("𝕶𝖗𝖎𝖘𝖙𝖎á𝖓 ★");
  });

  it("maps digits only in the alphabets that have them", () => {
    const wide = NICK_FONTS.find((f) => f.id === "ancha")!;
    expect(applyFont("a1", wide)).toBe("ａ１");
    const gothic = NICK_FONTS.find((f) => f.id === "gotica")!;
    expect(applyFont("a1", gothic)).toBe("𝖆1");
  });

  it("can be stacked on top of an ornament", () => {
    const template = NICK_TEMPLATES.find((t) => t.id === "estrellita")!;
    const gothic = NICK_FONTS.find((f) => f.id === "gotica")!;
    const decorated = applyTemplate("Kris", template);
    expect(decorated).toBe("╰☆╮ Kris ╰☆╮");
    // The ornament stays put while only the letters change.
    expect(applyFont(decorated, gothic)).toBe("╰☆╮ 𝕶𝖗𝖎𝖘 ╰☆╮");
  });
});

describe("nick ornaments", () => {
  it("puts the name inside every template", () => {
    for (const t of NICK_TEMPLATES) {
      expect(t.pattern, t.id).toContain("{n}");
      expect(applyTemplate("Kris", t), t.id).toContain("Kris");
      expect(applyTemplate("Kris", t), t.id).not.toContain("{n}");
    }
  });

  it("falls back to a placeholder name in the pickers", () => {
    expect(previewTemplates("  ")[0].value).toContain("TU NOMBRE");
    expect(previewFonts("")[0].value).toBeTruthy();
    expect(previewTemplates("Kris")).toHaveLength(NICK_TEMPLATES.length);
    expect(previewFonts("Kris")).toHaveLength(NICK_FONTS.length);
  });

  it("offers symbols without duplicates", () => {
    expect(NICK_SYMBOLS.length).toBeGreaterThan(40);
    expect(new Set(NICK_SYMBOLS).size).toBe(NICK_SYMBOLS.length);
  });
});

describe("nick length", () => {
  it("counts code points, matching the server's limit", () => {
    // Astral glyphs: `length` would say 8 here.
    expect("𝕶𝖗𝖎𝖘".length).toBe(8);
    expect(nickLength("𝕶𝖗𝖎𝖘")).toBe(4);
    expect(nickLength("Kris")).toBe(4);
  });
});
