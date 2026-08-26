import { describe, it, expect } from "vitest";
import {
  parseTrashType,
  resolveAllowedMime,
  sniffMime,
  isPreviewableImage,
  maxFilesFor,
} from "../src/lib/attachment-policy.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("attachment-policy", () => {
  it("sniffs real PNG bytes and ignores the filename extension", () => {
    expect(sniffMime(PNG, "foto.jpg")).toBe("image/png");
    expect(resolveAllowedMime(PNG, "foto.jpg", "note")).toBe("image/png");
  });

  it("rejects zip bytes presented as a note image", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(sniffMime(zip, "foto.png")).toBe("application/zip");
    expect(resolveAllowedMime(zip, "foto.png", "note")).toBeNull();
    expect(resolveAllowedMime(zip, "pack.zip", "task")).toBe("application/zip");
  });

  it("treats PK-zip with .docx as Word, not generic zip", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(sniffMime(zip, "informe.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("rejects HTML-looking text as txt", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(sniffMime(html, "nota.txt")).toBeNull();
    expect(resolveAllowedMime(html, "nota.txt", "task")).toBeNull();
  });

  it("accepts plain text without NULs", () => {
    const txt = new TextEncoder().encode("hola mundo");
    expect(resolveAllowedMime(txt, "notas.txt", "task")).toBe("text/plain");
    expect(isPreviewableImage("text/plain")).toBe(false);
    expect(isPreviewableImage("image/png")).toBe(true);
  });

  it("parses canonical trash types and rejects plurals", () => {
    expect(parseTrashType("task")).toBe("task");
    expect(parseTrashType("tasks")).toBeNull();
    expect(parseTrashType("notes")).toBeNull();
    expect(maxFilesFor("note")).toBe(8);
    expect(maxFilesFor("task")).toBe(5);
  });
});
