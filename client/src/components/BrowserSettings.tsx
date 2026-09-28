import { useEffect, useState } from "react";
import { Globe2, RotateCcw, Trash2 } from "lucide-react";
import { Button, Checkbox, Input, Spinner, useToast } from "@/components/ui";
import { DEFAULT_HOME_URL, useBrowserSettings } from "@/lib/browserMarks";
import {
  clearNativeBrowserData,
  getNativeBrowserState,
  isAllowedBrowserUrl,
  isNativeShell,
  nativeBrowserProxyStatus,
  normalizeBrowserUrl,
} from "@/lib/nativeShell";

/** What the built-in browser opens with, and what it writes down. */
export function BrowserSettings() {
  const { push } = useToast();
  const { settings, isLoading, homeUrl, historyEnabled, update } = useBrowserSettings();
  const [draft, setDraft] = useState("");
  const [wiping, setWiping] = useState(false);
  /** Null until asked, false on a shell that predates the command. */
  const [canWipe, setCanWipe] = useState(false);
  const desktop = isNativeShell();

  // The wipe arrived with shell 1.0.13; an older one would only throw.
  useEffect(() => {
    let alive = true;
    void nativeBrowserProxyStatus().then((status) => { if (alive) setCanWipe(status !== null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (settings) setDraft(settings.homeUrl ?? "");
  }, [settings?.homeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidate = draft.trim() ? normalizeBrowserUrl(draft) : "";
  const valid = candidate === "" || isAllowedBrowserUrl(candidate);
  const changed = (settings?.homeUrl ?? "") !== (candidate || "");

  const saveHome = () => {
    if (!valid) return;
    update.mutate({ homeUrl: candidate || null });
  };

  /** Only offered on the desktop: it is the only place a browser exists. */
  const useCurrentPage = async () => {
    try {
      const state = await getNativeBrowserState();
      if (!state?.url || !isAllowedBrowserUrl(state.url)) {
        push("info", "Abre una página en el navegador integrado y vuelve aquí.");
        return;
      }
      setDraft(state.url);
      update.mutate({ homeUrl: state.url });
    } catch {
      push("info", "Abre el navegador integrado y vuelve aquí.");
    }
  };

  const wipe = async () => {
    setWiping(true);
    try {
      const result = await clearNativeBrowserData();
      push(result.complete ? "success" : "info", result.complete
        ? "Cookies y datos del navegador borrados"
        : "Borrado lo que estaba libre; cierra el navegador y repite para el resto.");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo borrar.");
    } finally {
      setWiping(false);
    }
  };

  if (isLoading) return <div className="grid place-items-center py-6 text-accent"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div>
        <Input
          label="Página de inicio"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveHome}
          placeholder={DEFAULT_HOME_URL}
          aria-invalid={!valid}
          spellCheck={false}
          inputMode="url"
        />
        <p className={`mt-1 text-xs ${valid ? "text-faint" : "text-danger"}`}>
          {valid
            ? `Con lo que hay ahora, el navegador abre en ${homeUrl}.`
            : "Solo se admiten direcciones HTTPS públicas."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={saveHome} disabled={!valid || !changed || update.isPending}>
            {update.isPending ? "Guardando…" : "Guardar"}
          </Button>
          {desktop && (
            <Button size="sm" variant="secondary" onClick={() => void useCurrentPage()}>
              <Globe2 className="w-4 h-4" aria-hidden="true" />
              Usar la página actual
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setDraft(""); update.mutate({ homeUrl: null }); }}
            disabled={!settings?.homeUrl}
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Volver a la de siempre
          </Button>
        </div>
      </div>

      <Checkbox
        label="Guardar el historial de lo que visito"
        checked={historyEnabled}
        onChange={(next) => update.mutate({ historyEnabled: next })}
      />
      <p className="-mt-2 text-xs text-faint">
        Se guarda cifrado en tu cuenta, para verlo desde cualquier equipo. Con esto apagado no se
        anota nada; lo ya guardado se borra desde el propio navegador o aquí abajo.
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="secondary" size="sm" onClick={() => void wipe()} disabled={!canWipe || wiping}>
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {wiping ? "Borrando…" : "Borrar cookies y datos del navegador"}
        </Button>
        <p className="text-xs text-faint">
          {canWipe
            ? "Cierra tus sesiones de las webs que hayas abierto ahí. La sesión de Kalendiario no se toca."
            : desktop
              ? "Necesita la app de escritorio 1.0.13 o posterior."
              : "Solo desde la app de escritorio, que es donde vive el navegador integrado."}
        </p>
      </div>
    </div>
  );
}
