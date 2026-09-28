import { createContext, useContext } from "react";
import type { RadioStation } from "./radioStations";
import type { SpotifyEmbed, SpotifyPlaylist } from "./spotify";
import type { SpotifyDevicePlayer, SpotifyNowPlaying } from "./spotifyPlayer";

export type MediaSource = "radio" | "spotify";

/**
 * Spotify state lives in the provider and not in the dashboard card: the Web
 * Playback SDK device dies with the component that created it, and Spotify
 * stops the stream a few seconds after its active device disappears.
 */
export type SpotifySession = {
  enabled: boolean;
  connected: boolean;
  premium: boolean;
  loading: boolean;
  starting: boolean;
  error: string | null;
  zenUnsupported: boolean;
  device: SpotifyDevicePlayer | null;
  playlists: SpotifyPlaylist[];
  now: SpotifyNowPlaying | null;
  preview: SpotifyNowPlaying | null;
  sdkReady: boolean;
};

export type RadioContextValue = {
  source: MediaSource;
  station: RadioStation;
  playing: boolean;
  reconnecting: boolean;
  volume: number;
  playError: string | null;
  favoriteIds: string[];
  streamKbps: number | null;
  spotifyEmbed: SpotifyEmbed | null;
  spotify: SpotifySession;
  setSource: (source: MediaSource) => void;
  setStation: (id: string) => void;
  setVolume: (value: number) => void;
  toggleFavorite: (id: string) => void;
  setSpotifyEmbed: (embed: SpotifyEmbed | null) => void;
  loadSpotifyPlaylist: (id: string) => void;
  playSpotifyEmbed: (embed: SpotifyEmbed, offsetUri?: string) => void;
  spotifyToggle: () => void;
  spotifyNext: () => void;
  spotifyPrevious: () => void;
  spotifySeek: (positionMs: number) => void;
  spotifyRetry: () => void;
  spotifyForget: () => void;
  spotifyShuffle: boolean;
  setSpotifyShuffle: (on: boolean) => void;
  play: (stationId?: string) => void;
  pause: () => void;
  toggle: () => void;
};

export const RadioContext = createContext<RadioContextValue | null>(null);

export function useRadio(): RadioContextValue {
  const value = useContext(RadioContext);
  if (!value) throw new Error("useRadio must be used within RadioProvider");
  return value;
}

export function useOptionalRadio(): RadioContextValue | null {
  return useContext(RadioContext);
}
