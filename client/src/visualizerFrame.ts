/**
 * Visualizer sandbox.
 *
 * Butterchurn compiles every MilkDrop preset with `new Function`, so whatever
 * runs it needs `'unsafe-eval'`. Rather than granting that to the application
 * document — the one that also shows the vault — the renderer lives here, in
 * a document the server hands a policy of its own: eval allowed, everything
 * else denied. It only receives raw audio samples and sends back a preset name.
 */
// First, so it can report failures in the modules evaluated after it.
import "./visualizerFrameBoot";
import butterchurn from "butterchurn";
import butterchurnPresets from "butterchurn-presets";

const PRESET_SECONDS = 30;
const BLEND_SECONDS = 5.7;

/** The worklet lives in a blob so this document needs nothing from the network. */
const WORKLET_SOURCE = `
class PcmBridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (event) => {
      const chunk = event.data;
      if (!(chunk instanceof Float32Array)) return;
      this.queue.push(chunk);
      while (this.queue.length > 32) { this.queue.shift(); this.offset = 0; }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    let written = 0;
    while (written < out.length) {
      const chunk = this.queue[0];
      if (!chunk) { out.fill(0, written); break; }
      const take = Math.min(chunk.length - this.offset, out.length - written);
      out.set(chunk.subarray(this.offset, this.offset + take), written);
      written += take;
      this.offset += take;
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor("pcm-bridge", PcmBridgeProcessor);
`;

type ToParent =
  | { type: "visualizer-ready" }
  | { type: "visualizer-preset"; name: string }
  | { type: "visualizer-error"; message: string }
  | { type: "visualizer-close" };

function post(message: ToParent): void {
  window.parent.postMessage(message, window.location.origin);
}

function toFloat32(pcm: ArrayBuffer): Float32Array {
  const samples = new Int16Array(pcm);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] / 32767;
  return out;
}

async function start(): Promise<void> {
  const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("No hay lienzo.");

  const context = new AudioContext({ latencyHint: "playback" });
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  await context.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const bridge = new AudioWorkletNode(context, "pcm-bridge", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const silent = context.createGain();
  silent.gain.value = 0;
  bridge.connect(silent).connect(context.destination);
  // Never awaited: without a gesture the autoplay policy can leave this
  // pending forever, and a suspended context still renders, just silently.
  void context.resume().catch(() => {});

  const size = () => ({
    width: Math.max(1, canvas.clientWidth || window.innerWidth || 1280),
    height: Math.max(1, canvas.clientHeight || window.innerHeight || 720),
  });
  const initial = size();
  const visualizer = butterchurn.createVisualizer(context, canvas, {
    width: initial.width,
    height: initial.height,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  });
  visualizer.connectAudio(bridge);

  const presets = butterchurnPresets.getPresets();
  const names = Object.keys(presets);
  const loadRandom = (blend: number) => {
    const name = names[Math.floor(Math.random() * names.length)];
    visualizer.loadPreset(presets[name], blend);
    post({ type: "visualizer-preset", name });
  };
  loadRandom(0);
  window.setInterval(() => loadRandom(BLEND_SECONDS), PRESET_SECONDS * 1000);

  const resize = () => {
    const next = size();
    canvas.width = next.width;
    canvas.height = next.height;
    visualizer.setRendererSize(next.width, next.height);
  };
  resize();
  window.addEventListener("resize", resize);
  new ResizeObserver(resize).observe(canvas);

  const loop = () => {
    if (document.visibilityState === "visible") visualizer.render();
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);

  // Once the pointer lands on the canvas the keys go to this document, not to
  // the parent, so the shortcuts have to work from both sides.
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      loadRandom(BLEND_SECONDS);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      post({ type: "visualizer-close" });
    }
  });

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as { type?: string; pcm?: ArrayBuffer } | null;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "visualizer-audio" && data.pcm instanceof ArrayBuffer) {
      const block = toFloat32(data.pcm);
      bridge.port.postMessage(block, [block.buffer]);
      return;
    }
    if (data.type === "visualizer-next") loadRandom(BLEND_SECONDS);
  });

  post({ type: "visualizer-ready" });
}

void start().catch((error: unknown) => {
  post({
    type: "visualizer-error",
    message: error instanceof Error ? error.message : "No se pudo iniciar el visualizador.",
  });
});
