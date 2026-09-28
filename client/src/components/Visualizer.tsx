import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  nativeAudioCaptureStatus,
  startNativeAudioCapture,
  supportsAudioCapture,
} from "@/lib/nativeShell";

/** How long to wait before admitting the device is sending nothing. */
const SILENCE_GRACE_MS = 6000;
const FRAME_URL = `${import.meta.env.BASE_URL}visualizer-frame.html`;

type Status = "starting" | "running" | "silent" | "error";

export type VisualizerHandle = {
  status: Status;
  error: string | null;
  presetName: string | null;
  next: () => void;
};

type FrameMessage =
  | { type: "visualizer-ready" }
  | { type: "visualizer-preset"; name: string }
  | { type: "visualizer-error"; message: string }
  | { type: "visualizer-close" };

/**
 * MilkDrop visualizer driven by the audio the Windows wrapper captures.
 *
 * The rendering happens in a separate document because Butterchurn compiles
 * presets with `new Function`: only that document is served with a policy that
 * allows it, so the application keeps a CSP without `'unsafe-eval'`. This
 * component owns the native capture and forwards raw samples to the frame.
 */
export function Visualizer({ className, onHandle, onCloseRequest }: {
  className?: string;
  onHandle?: (handle: VisualizerHandle) => void;
  /** The frame asks to close when Escape is pressed while it has the focus. */
  onCloseRequest?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const closeRef = useRef<(() => void) | undefined>(onCloseRequest);
  closeRef.current = onCloseRequest;

  // Only messages from our own frame, identified by its window: the page may
  // receive postMessage from anywhere.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as FrameMessage | null;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "visualizer-ready") setReady(true);
      if (data.type === "visualizer-preset") setPresetName(data.name);
      if (data.type === "visualizer-error") {
        setStatus("error");
        setError(data.message);
      }
      if (data.type === "visualizer-close") closeRef.current?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Capture only starts once the frame can actually consume the samples.
  useEffect(() => {
    if (!ready) return;
    if (!supportsAudioCapture()) {
      setStatus("silent");
      setError("Sin audio: analizar el sonido del equipo solo es posible en la app de Windows.");
      return;
    }

    let cancelled = false;
    let stop: (() => Promise<void>) | null = null;
    let watchdog = 0;
    let received = 0;

    void startNativeAudioCapture((pcm) => {
      received += 1;
      frameRef.current?.contentWindow?.postMessage({ type: "visualizer-audio", pcm }, window.location.origin, [pcm]);
    })
      .then((capture) => {
        if (cancelled) {
          void capture.stop();
          return;
        }
        stop = capture.stop;
        setStatus("running");
        // Counting both ends tells a silent device apart from blocks that
        // leave the wrapper but never reach the page.
        watchdog = window.setTimeout(async () => {
          if (cancelled || received > 0) return;
          const health = await nativeAudioCaptureStatus();
          if (cancelled || received > 0) return;
          setStatus("silent");
          setError(
            health?.lastError
              ?? (health && health.blocksSent > 0
                ? "El audio se captura pero no llega a esta ventana. Vuelve a abrir el visualizador."
                : "No llega sonido del equipo. Comprueba que estás reproduciendo algo por el dispositivo de salida principal."),
          );
        }, SILENCE_GRACE_MS);
      })
      .catch((captureError: unknown) => {
        if (cancelled) return;
        setStatus("silent");
        setError(captureError instanceof Error ? captureError.message : "No se pudo capturar el audio.");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      void stop?.().catch(() => {});
    };
  }, [ready]);

  useEffect(() => {
    onHandle?.({
      status,
      error,
      presetName,
      next: () => frameRef.current?.contentWindow?.postMessage({ type: "visualizer-next" }, window.location.origin),
    });
  }, [status, error, presetName, onHandle]);

  return (
    <iframe
      ref={frameRef}
      src={FRAME_URL}
      title="Visualizador de música"
      className={clsx("block h-full w-full border-0 bg-black", className)}
    />
  );
}
