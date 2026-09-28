import { describe, expect, it } from "vitest";
import { cacheBustStream, matchRadioStation, RADIO_STATIONS, stationStreamUrls, stripCacheBust, type RadioStation } from "../../client/src/lib/radioStations.ts";
import { DEFAULT_SPOTIFY_EMBED, parseSpotifyUrl, SPOTIFY_EMBED_CLIP, spotifyEmbedHeight, spotifyEmbedSrc } from "../../client/src/lib/spotifyUrl.ts";
import { formatKbps, snapBitrate, spotifyWebKbps } from "../../client/src/lib/streamBitrate.ts";
import { bitrateFromAudioBytes, bitrateFromIcyHeaders, codecFromContentType } from "../src/lib/streamBitrate.ts";
import { isAllowedRadioStreamUrl, stripCacheBust as stripServerCacheBust } from "../src/lib/radioStreamInfo.ts";
import { isSpotifyClientId } from "../src/lib/spotifyClientId.ts";

describe("radio stream helpers", () => {
  it("dedupes primary and fallback mounts", () => {
    const station: RadioStation = {
      id: "gozadera",
      name: "Gozadera FM",
      streamUrl: "https://azura.abcorp.es/listen/gozadera_en_directo/live",
      streamUrls: [
        "https://azura.abcorp.es/listen/gozadera_en_directo/live",
        "https://azura.abcorp.es/listen/gozadera_en_directo/aac",
      ],
      pageUrl: "https://gozadera.es/",
    };
    expect(stationStreamUrls(station)).toEqual([
      "https://azura.abcorp.es/listen/gozadera_en_directo/live",
      "https://azura.abcorp.es/listen/gozadera_en_directo/aac",
    ]);
  });

  it("cache-busts live URLs so a dropped chunk is not replayed", () => {
    expect(cacheBustStream("https://azura.abcorp.es/listen/gozadera_en_directo/live", 9))
      .toBe("https://azura.abcorp.es/listen/gozadera_en_directo/live?_=9");
    expect(cacheBustStream("https://example.com/stream?x=1", 2)).toBe("https://example.com/stream?x=1&_=2");
    expect(stripCacheBust("https://azura.abcorp.es/listen/gozadera_en_directo/live?_=9"))
      .toBe("https://azura.abcorp.es/listen/gozadera_en_directo/live");
    expect(stripServerCacheBust("https://example.com/stream?x=1&_=2")).toBe("https://example.com/stream?x=1");
  });
});

describe("radio stream bitrate", () => {
  it("reads icy-br and ice-audio-info", () => {
    expect(bitrateFromIcyHeaders(new Headers({ "icy-br": "128,64" }))).toBe(128);
    expect(bitrateFromIcyHeaders(new Headers({ "ice-audio-info": "ice-samplerate=44100;ice-bitrate=192;ice-channels=2" }))).toBe(192);
    expect(codecFromContentType("audio/mpeg")).toBe("mp3");
    expect(codecFromContentType("audio/aacp")).toBe("aac");
  });

  it("parses MPEG-1 Layer III frame headers", () => {
    expect(bitrateFromAudioBytes(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe(128);
    expect(bitrateFromAudioBytes(new Uint8Array([0x00, 0xff, 0xfb, 0xd0, 0x00]))).toBe(256);
  });

  it("allows catalog mounts and rejects SSRF-ish URLs", () => {
    for (const station of RADIO_STATIONS) {
      for (const url of stationStreamUrls(station)) {
        expect(isAllowedRadioStreamUrl(url), url).toBe(true);
        expect(isAllowedRadioStreamUrl(cacheBustStream(url, 1)), url).toBe(true);
      }
    }
    expect(isAllowedRadioStreamUrl("http://azura.abcorp.es/listen/gozadera_en_directo/live")).toBe(false);
    expect(isAllowedRadioStreamUrl("https://127.0.0.1/stream")).toBe(false);
    expect(isAllowedRadioStreamUrl("https://evil.example/stream")).toBe(false);
  });

  it("does not confuse Remember The Music FM with Loca FM Remember", () => {
    expect(matchRadioStation("remember")?.id).toBe("remember-music");
    expect(matchRadioStation("Remember The Music FM")?.id).toBe("remember-music");
    expect(matchRadioStation("pon remember the music")?.id).toBe("remember-music");
    expect(matchRadioStation("remember the music fm")?.id).toBe("remember-music");
    expect(matchRadioStation("loca remember")?.id).toBe("loca-remember");
    expect(matchRadioStation("loca fm remember")?.id).toBe("loca-remember");
    expect(RADIO_STATIONS.find((station) => station.id === "remember-music")?.streamUrl)
      .toBe("https://eu1.lhdserver.es:9041/stream");
    expect(RADIO_STATIONS.find((station) => station.id === "remember-music")?.pageUrl)
      .not.toContain("rememberthemusicfm.com");
    expect(matchRadioStation("wifon")?.id).toBe("wifon-fm");
    expect(matchRadioStation("los40")?.id).toBe("los40");
    expect(matchRadioStation("los40 dance")?.id).toBe("los40-dance");
  });

  it("formats web Spotify quality", () => {
    expect(formatKbps(128)).toBe("128 kbps");
    expect(formatKbps(null)).toBeNull();
    expect(snapBitrate(131)).toBe(128);
    expect(spotifyWebKbps(true)).toBe(160);
    expect(spotifyWebKbps(false)).toBe(128);
    expect(isSpotifyClientId("abcd1234ef")).toBe(true);
    expect(isSpotifyClientId("no")).toBe(false);
  });
});

describe("spotify url parser", () => {
  it("accepts open.spotify.com and spotify: uris", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"))
      .toEqual({ kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M" });
    expect(parseSpotifyUrl("https://open.spotify.com/intl-es/album/1ABC23def?si=x"))
      .toEqual({ kind: "album", id: "1ABC23def" });
    expect(parseSpotifyUrl("spotify:track:4cOdK2wGLETKBW3PvgPWqT"))
      .toEqual({ kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" });
    expect(parseSpotifyUrl("https://example.com/playlist/x")).toBeNull();
  });

  it("builds the official embed that works with Spotify Free", () => {
    expect(spotifyEmbedSrc({ kind: "playlist", id: "abc" }))
      .toBe("https://open.spotify.com/embed/playlist/abc?utm_source=generator&theme=0");
    expect(spotifyEmbedSrc({ kind: "playlist", id: "abc" }, "light"))
      .toBe("https://open.spotify.com/embed/playlist/abc?utm_source=generator");
    expect(spotifyEmbedHeight({ kind: "playlist", id: "abc" })).toBe(80);
    expect(spotifyEmbedHeight({ kind: "track", id: "abc" })).toBe(80);
    expect(SPOTIFY_EMBED_CLIP).toBe(80);
    expect(DEFAULT_SPOTIFY_EMBED.kind).toBe("playlist");
    expect(parseSpotifyUrl(`https://open.spotify.com/playlist/${DEFAULT_SPOTIFY_EMBED.id}`)).toEqual(DEFAULT_SPOTIFY_EMBED);
  });
});
