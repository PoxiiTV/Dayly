export function isSpotifyClientId(value: string): boolean {
  return /^[A-Za-z0-9]{8,80}$/.test(value.trim());
}
