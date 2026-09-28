import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/src/lib/api", () => ({ http: {
  get: vi.fn(async () => ({ accessToken: "test-token", expiresAt: new Date(Date.now() + 3600000).toISOString() })),
} }));

import { searchSpotify } from "../../client/src/lib/spotify";

afterEach(() => vi.unstubAllGlobals());

describe("Spotify catalogue search", () => {
  it("combines songs and playlists and skips null playlist entries", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      tracks: { items: [{ id: "track123", uri: "spotify:track:track123", name: "Song", artists: [{ name: "Artist" }], duration_ms: 123000, album: { images: [] } }] },
      playlists: { items: [null, {}, { id: "list123", name: "Focus", owner: { display_name: "Curator" }, images: [{ url: "https://example.com/cover.jpg" }] }] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await searchSpotify("focus & relax");
    expect(results.map(({ kind, id }) => ({ kind, id }))).toEqual([{ kind: "track", id: "track123" }, { kind: "playlist", id: "list123" }]);
    expect(results[1]).toMatchObject({ subtitle: "Curator", uri: "spotify:playlist:list123" });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toBe("focus & relax");
    expect(url.searchParams.get("type")).toBe("track,playlist");
  });

  it("requests only playlists when selected and handles missing metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ playlists: { items: [{ id: "list123", name: "Focus", images: null, owner: null }] } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchSpotify("focus", "playlist")).toEqual([{ kind: "playlist", id: "list123", uri: "spotify:playlist:list123", name: "Focus", image: null, subtitle: "Playlist de Spotify" }]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("type")).toBe("playlist");
  });

  it("skips short queries and surfaces request failures", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchSpotify(" a ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(searchSpotify("focus")).rejects.toThrow("No se pudo buscar");
  });
});
