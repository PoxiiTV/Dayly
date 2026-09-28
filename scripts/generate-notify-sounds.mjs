/**
 * Writes 8 original PCM WAVs for in-app alerts. Original synthesis, no samples.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "../client/public/sounds");

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

function env(t, attack, decay) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

function tone(t, hz, phase = 0) {
  return Math.sin(2 * Math.PI * hz * t + phase);
}

function render(seconds, fn) {
  const n = Math.floor(SR * seconds);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = clamp(fn(i / SR, i));
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const sounds = {
  bell: render(1.05, (t) => {
    const a = tone(t, 784) * env(t, 0.006, 0.38);
    const b = tone(t, 1175) * env(t, 0.006, 0.42) * 0.7;
    const c = tone(t, 1568) * env(t, 0.004, 0.18) * 0.25;
    return (a + b + c) * 0.55;
  }),
  ring: render(1.15, (t) => {
    const burst = (start) => {
      const u = t - start;
      if (u < 0 || u > 0.22) return 0;
      const trem = 0.55 + 0.45 * tone(u, 18);
      return (tone(u, 440) + tone(u, 480)) * 0.28 * trem * env(u, 0.008, 0.12);
    };
    return burst(0.02) + burst(0.34) + burst(0.66);
  }),
  chime: render(1.2, (t) => {
    const notes = [
      [0, 1046.5],
      [0.16, 1318.5],
      [0.32, 1568],
    ];
    let s = 0;
    for (const [start, hz] of notes) {
      const u = t - start;
      if (u >= 0) s += tone(u, hz) * env(u, 0.005, 0.28) * 0.42;
    }
    return s;
  }),
  ding: render(0.7, (t) => {
    return (tone(t, 1760) * 0.7 + tone(t, 3520) * 0.15) * env(t, 0.003, 0.22) * 0.7;
  }),
  digital: render(0.45, (t) => {
    const sq = (hz) => (tone(t, hz) >= 0 ? 1 : -1);
    if (t < 0.09) return sq(1280) * 0.18 * env(t, 0.004, 0.05);
    if (t < 0.14) return 0;
    const u = t - 0.14;
    if (u < 0.11) return sq(980) * 0.18 * env(u, 0.004, 0.06);
    return 0;
  }),
  wood: render(0.35, (t) => {
    const n = (Math.sin(t * 9123.1) * 437.3) % 1;
    const noise = (n * 2 - 1) * Math.exp(-t * 38);
    return (tone(t, 190) * env(t, 0.002, 0.045) * 0.55 + noise * 0.22);
  }),
  crystal: render(0.85, (t) => {
    return (tone(t, 2637) * 0.55 + tone(t, 3951) * 0.2 + tone(t, 5274) * 0.08) * env(t, 0.002, 0.2) * 0.65;
  }),
  marimba: render(0.8, (t) => {
    const hit = (start, hz) => {
      const u = t - start;
      if (u < 0) return 0;
      return (tone(u, hz) + tone(u, hz * 2.01) * 0.18) * env(u, 0.004, 0.16) * 0.5;
    };
    return hit(0, 523.25) + hit(0.12, 659.25) + hit(0.24, 783.99);
  }),
};

mkdirSync(outDir, { recursive: true });
for (const [id, samples] of Object.entries(sounds)) {
  const file = join(outDir, `${id}.wav`);
  writeFileSync(file, wav(samples));
  console.log(file);
}
