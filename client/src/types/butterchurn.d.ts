// Butterchurn ships untyped UMD builds; this is the slice of its API we use.
declare module "butterchurn" {
  export type ButterchurnPreset = Record<string, unknown>;

  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: ButterchurnPreset, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }

  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: { width: number; height: number; pixelRatio?: number; textureRatio?: number },
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module "butterchurn-presets" {
  import type { ButterchurnPreset } from "butterchurn";

  const presets: { getPresets(): Record<string, ButterchurnPreset> };
  export default presets;
}
