const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
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

export function bitrateFromIcyHeaders(headers: Headers): number | null {
  const br = headers.get("icy-br") ?? headers.get("ice-bitrate") ?? headers.get("x-audiocast-bitrate");
  const fromBr = firstNumber(br);
  if (fromBr) return snapBitrate(fromBr);
  const info = headers.get("ice-audio-info") ?? headers.get("icy-audio-info") ?? "";
  const match = /bitrate\s*=\s*(\d+(?:\.\d+)?)/i.exec(info);
  if (match) return snapBitrate(Number(match[1]));
  return null;
}

export function codecFromContentType(contentType: string | null): string | null {
  const raw = (contentType ?? "").toLowerCase();
  if (raw.includes("mpeg") || raw.includes("mp3")) return "mp3";
  if (raw.includes("aac") || raw.includes("mp4")) return "aac";
  if (raw.includes("ogg") || raw.includes("vorbis") || raw.includes("opus")) return "ogg";
  return null;
}

export function bitrateFromAudioBytes(bytes: Uint8Array): number | null {
  const mpeg = bitrateFromMpeg(bytes);
  if (mpeg) return mpeg;
  return bitrateFromAdts(bytes);
}

function firstNumber(raw: string | null): number | null {
  if (!raw) return null;
  const match = /(\d+(?:\.\d+)?)/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 8 && value <= 512 ? value : null;
}

function bitrateFromMpeg(bytes: Uint8Array): number | null {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1]! >> 3) & 3;
    const layer = (bytes[i + 1]! >> 1) & 3;
    const bitrateIndex = (bytes[i + 2]! >> 4) & 15;
    if (layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15) continue;
    const table = version === 3 ? MPEG1_L3 : MPEG2_L3;
    const kbps = table[bitrateIndex];
    if (kbps) return kbps;
  }
  return null;
}

function bitrateFromAdts(bytes: Uint8Array): number | null {
  for (let i = 0; i < bytes.length - 6; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xf6) !== 0xf0) continue;
    const srIndex = (bytes[i + 2]! >> 2) & 0x0f;
    const sampleRate = AAC_RATES[srIndex];
    const frameLen = ((bytes[i + 3]! & 3) << 11) | (bytes[i + 4]! << 3) | ((bytes[i + 5]! >> 5) & 7);
    if (!sampleRate || frameLen < 7) continue;
    return snapBitrate((frameLen * 8 * sampleRate) / 1024 / 1000);
  }
  return null;
}
