export type SpotifyEmbedKind = "playlist" | "album" | "track" | "artist" | "episode" | "show";

export type SpotifyEmbed = {
  kind: SpotifyEmbedKind;
  id: string;
};

/** Public editorial playlist so the embed (cover, title, time) works without login. */
export const DEFAULT_SPOTIFY_EMBED: SpotifyEmbed = {
  kind: "playlist",
  id: "37i9dQZF1DXcBWIGoYBM5M",
};

const KINDS = new Set<SpotifyEmbedKind>(["playlist", "album", "track", "artist", "episode", "show"]);

export function parseSpotifyUrl(raw: string): SpotifyEmbed | null {
  const value = raw.trim();
  if (!value) return null;
  const uri = /^spotify:(playlist|album|track|artist|episode|show):([A-Za-z0-9]+)$/i.exec(value);
  if (uri) return { kind: uri[1].toLowerCase() as SpotifyEmbedKind, id: uri[2] };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let start = 0;
  if (parts[0] && (parts[0].length === 2 || parts[0].toLowerCase().startsWith("intl"))) start = 1;
  if (parts[start]?.toLowerCase() === "embed") start += 1;
  const kind = parts[start]?.toLowerCase();
  const id = (parts[start + 1] ?? "").replace(/[^A-Za-z0-9].*$/, "");
  if (!kind || !KINDS.has(kind as SpotifyEmbedKind) || !/^[A-Za-z0-9]+$/.test(id)) return null;
  return { kind: kind as SpotifyEmbedKind, id };
}

export function spotifyEmbedSrc(embed: SpotifyEmbed, appearance: "light" | "dark" = "dark"): string {
  const base = `https://open.spotify.com/embed/${embed.kind}/${embed.id}?utm_source=generator`;
  switch (appearance) {
    case "dark":
      return `${base}&theme=0`;
    case "light":
      return base;
    default: {
      const _exhaustive: never = appearance;
      return _exhaustive;
    }
  }
}

/**
 * Spotify's smallest embed: a single row with cover, title and play. Taller
 * sizes add the track list and eat the space we need for our own volume.
 */
export const SPOTIFY_EMBED_HEIGHT = 80;
export const SPOTIFY_EMBED_CLIP = 80;

export function spotifyEmbedHeight(_embed?: SpotifyEmbed): number {
  return SPOTIFY_EMBED_HEIGHT;
}

export function spotifyOpenUrl(embed: SpotifyEmbed): string {
  return `https://open.spotify.com/${embed.kind}/${embed.id}`;
}
