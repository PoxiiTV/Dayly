const LADDER = [24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

export function snapBitrate(kbps: number): number {
  if (!Number.isFinite(kbps) || kbps < 8) return 0;
  let best = LADDER[0]!;
  for (const step of LADDER) {
    if (Math.abs(step - kbps) < Math.abs(best - kbps)) best = step;
  }
  if (Math.abs(best - kbps) > 28) return Math.round(kbps);
  return best;
}

export function formatKbps(kbps: number | null | undefined): string | null {
  if (!kbps || kbps < 8) return null;
  return `${kbps} kbps`;
}

/** Spotify's web player quality. The SDK/embed do not expose a live bitrate. */
export function spotifyWebKbps(premium: boolean): number {
  return premium ? 160 : 128;
}

export function clientReceiveKbps(src: string): number | null {
  if (!src || typeof performance === "undefined") return null;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const hit = [...entries].reverse().find((entry) => entry.name === src);
  if (!hit || hit.transferSize < 2048) return null;
  const ms = hit.responseEnd - hit.startTime;
  if (ms < 400) return null;
  return snapBitrate((hit.transferSize * 8) / ms);
}
