import { AudioLines, ExternalLink } from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { openNativeVisualizerWindow } from "@/lib/nativeShell";
import {
  canUseVisualizer,
  setVisualizerBackground,
  useVisualizerBackground,
} from "@/lib/visualizer/background";

/**
 * Only shown inside the Windows wrapper: the visualizer reads the machine's
 * own audio output, which no browser can do.
 */
export function VisualizerSettings() {
  const on = useVisualizerBackground();
  if (!canUseVisualizer()) return null;

  return (
    <div className="mt-5">
      <p className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5">
        <AudioLines className="w-3.5 h-3.5" aria-hidden="true" />
        Visualizador de música
      </p>
      <Checkbox
        label="Animar el fondo al ritmo de lo que suena"
        checked={on}
        onChange={setVisualizerBackground}
      />
      <p className="text-xs text-faint mt-2">
        Mientras esté activo, la app de Windows analiza el sonido que sale de tu equipo —incluido el de
        otros programas— para dibujar el fondo. No se graba nada ni sale del ordenador, y se detiene en
        cuanto lo desactivas o cierras el visualizador.
      </p>
      <Button
        variant="secondary"
        className="mt-3"
        onClick={() => void openNativeVisualizerWindow()}
      >
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
        Abrir en otra ventana (Alt+V)
      </Button>
    </div>
  );
}
