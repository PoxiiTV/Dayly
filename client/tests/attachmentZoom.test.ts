import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttachmentStrip } from "../src/components/AttachmentStrip";

vi.mock("@/lib/attachments", () => ({
  attachmentAccept: () => "image/*,.pdf",
  attachmentDropHint: () => "Adjuntar",
  countAttachments: (existing: unknown[], pending: unknown[]) => existing.length + pending.length,
  isPreviewableImage: (mime: string) => mime.startsWith("image/"),
  maxFilesFor: () => 8,
}));

describe("attachment image previews", () => {
  it("offers zoom only for images and keeps remove controls separate", () => {
    const markup = renderToStaticMarkup(createElement(AttachmentStrip, {
      existing: [
        { id: "image", filename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
        { id: "document", filename: "manual.pdf", mimeType: "application/pdf", sizeBytes: 10 },
      ],
      pending: [
        { key: "pending-image", file: { name: "captura.png" } as File, preview: "blob:pending-image" },
        { key: "pending-document", file: { name: "otro.pdf" } as File, preview: null },
      ],
      removed: [],
      previews: { image: "blob:saved-image" },
      fileRef: createRef<HTMLInputElement>(),
      onAdd: () => {},
      onRemoveExisting: () => {},
      onRemovePending: () => {},
      embedded: true,
    }));

    expect(markup).toContain('aria-label="Ampliar foto.jpg"');
    expect(markup).toContain('aria-label="Ampliar captura.png"');
    expect(markup).not.toContain('aria-label="Ampliar manual.pdf"');
    expect(markup).not.toContain('aria-label="Ampliar otro.pdf"');
    expect(markup).toContain('aria-label="Quitar foto.jpg"');
    expect(markup).toContain('aria-label="Quitar captura.png"');
  });
});
