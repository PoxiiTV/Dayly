import { describe, expect, it } from "vitest";
import { gifUrlProvider, interleave, keepAllowed, mapGiphy, mapKlipy, type GifResult } from "../src/lib/chat/gifs.js";

describe("gif providers", () => {
  it("maps a Giphy payload to the shape the chat sends", () => {
    const mapped = mapGiphy({
      data: [{
        id: "abc",
        title: "gato bailando",
        images: {
          downsized_medium: { url: "https://media1.giphy.com/media/abc/giphy.gif", width: "300", height: "200" },
          fixed_width_small: { url: "https://media1.giphy.com/media/abc/200w_s.gif" },
        },
      }],
    });
    expect(mapped).toEqual([{
      id: "giphy:abc",
      provider: "giphy",
      preview: "https://media1.giphy.com/media/abc/200w_s.gif",
      url: "https://media1.giphy.com/media/abc/giphy.gif",
      width: 300,
      height: 200,
      description: "gato bailando",
    }]);
  });

  it("maps a Klipy payload, which follows the Tenor shape", () => {
    const mapped = mapKlipy({
      results: [{
        id: "42",
        content_description: "aplauso",
        media_formats: {
          gif: { url: "https://media.klipy.com/42.gif", dims: [480, 270] },
          tinygif: { url: "https://media.klipy.com/42-tiny.gif", dims: [120, 68] },
        },
      }],
    });
    expect(mapped[0]).toMatchObject({ id: "klipy:42", provider: "klipy", width: 480, height: 270 });
  });

  it("drops results that are missing what a message needs", () => {
    expect(mapGiphy({ data: [{ id: "x", images: {} }] })).toHaveLength(0);
    expect(mapKlipy({ results: [{ id: "y", media_formats: {} }] })).toHaveLength(0);
    expect(mapGiphy({})).toHaveLength(0);
  });

  it("recognises only the providers' own hosts", () => {
    expect(gifUrlProvider("https://media0.giphy.com/a.gif")).toBe("giphy");
    expect(gifUrlProvider("https://media.klipy.com/a.gif")).toBe("klipy");
    expect(gifUrlProvider("https://evil.example/a.gif")).toBeNull();
    // Lookalike domains must not pass as the real thing.
    expect(gifUrlProvider("https://giphy.com.evil.example/a.gif")).toBeNull();
    expect(gifUrlProvider("http://media.giphy.com/a.gif")).toBeNull();
  });

  it("filters media from unknown hosts and says so", () => {
    const results: GifResult[] = [
      { id: "1", provider: "klipy", url: "https://cdn.elsewhere.net/1.gif", preview: "https://cdn.elsewhere.net/1s.gif", width: 1, height: 1, description: "x" },
      { id: "2", provider: "klipy", url: "https://media.klipy.com/2.gif", preview: "https://media.klipy.com/2s.gif", width: 1, height: 1, description: "y" },
    ];
    const { allowed, blocked } = keepAllowed(results, "klipy");
    expect(allowed).toHaveLength(1);
    expect(blocked).toBe(true);
  });

  it("alternates between providers so the grid shows both", () => {
    const gif = (id: string): GifResult => ({ id, provider: "giphy", url: "u", preview: "p", width: 1, height: 1, description: "d" });
    expect(interleave([[gif("a1"), gif("a2"), gif("a3")], [gif("b1")]]).map((item) => item.id))
      .toEqual(["a1", "b1", "a2", "a3"]);
  });
});
