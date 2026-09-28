import { RefreshCw } from "lucide-react";
import type { ReleaseUpdateState } from "@/lib/releaseUpdate";

export function ReleaseUpdateButton({ availableVersion, updating, onUpdate }: ReleaseUpdateState) {
  if (!availableVersion) return null;
  const label = updating ? `Actualizando a la versión v${availableVersion}` : `Actualizar a la versión v${availableVersion}`;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onUpdate}
        disabled={updating}
        aria-busy={updating}
        aria-label={label}
        title={updating ? "Actualizando la aplicación…" : `Hay una actualización disponible: v${availableVersion}`}
        className="btn-ghost btn-icon-lg text-accent-strong hover:text-accent-strong focus-visible:ring-accent-soft"
      >
        <RefreshCw className={`w-5 h-5 ${updating ? "animate-spin" : ""}`} aria-hidden="true" />
        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-accent border-2 border-surface" aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" aria-live="polite">{updating ? `Actualizando a la versión v${availableVersion}.` : `Hay una actualización disponible: v${availableVersion}.`}</span>
    </div>
  );
}
