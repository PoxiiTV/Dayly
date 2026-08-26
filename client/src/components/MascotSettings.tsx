import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, PawPrint, RefreshCw } from "lucide-react";
import { http, ApiError } from "@/lib/api";
import { Button, Input, Select, Spinner, useToast } from "@/components/ui";

const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";

type Provider = "opencode" | "openrouter" | "custom";
type KeyStatus = { hasKey: boolean; valid: boolean };
type MascotSettings = {
  enabled: boolean;
  provider: Provider;
  model: string;
  baseUrl: string | null;
  modelsUrl: string | null;
  hasKey: boolean;
  keyValid?: boolean;
  keys?: Record<Provider, KeyStatus>;
  hasFootballKey?: boolean;
};
type CatalogModel = { id: string; label: string; lane?: "go" | "zen" };

export function MascotSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const loc = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["mascot-settings"],
    queryFn: () => http.get<{ settings: MascotSettings }>("/api/mascot/settings"),
  });
  const s = data?.settings;
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState<Provider>("opencode");
  const [model, setModel] = useState("auto-free");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelsUrl, setModelsUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [footballKey, setFootballKey] = useState("");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!s) return;
    setEnabled(s.enabled);
    setProvider(s.provider);
    setModel(s.model);
    setBaseUrl(s.baseUrl ?? "");
    setModelsUrl(s.modelsUrl ?? "");
    setApiKey("");
    setReplacingKey(false);
    setFootballKey("");
  }, [s]);

  useEffect(() => {
    if (loc.hash !== "#mascot") return;
    const t = window.setTimeout(() => {
      document.getElementById("mascot")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [loc.hash]);

  const loadModels = async (p: Provider, url?: string, notifyEmpty = false) => {
    const catalogUrl = (url ?? modelsUrl).trim();
    if (p === "custom" && !catalogUrl) {
      setModels([]);
      if (notifyEmpty) push("error", "Indica la URL de modelos, por ejemplo https://api.groq.com/openai/v1/models");
      return;
    }
    setLoadingModels(true);
    try {
      const r = await http.get<{ models: CatalogModel[] }>("/api/mascot/models", {
        provider: p,
        modelsUrl: p === "custom" ? catalogUrl : undefined,
      });
      setModels(r.models);
    } catch (e) {
      setModels([]);
      push("error", e instanceof ApiError ? e.message : "No se pudo cargar el catálogo.");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    void loadModels(provider, s?.modelsUrl ?? undefined);
  }, [provider, s?.modelsUrl]);

  const applySettings = (settings: MascotSettings) => {
    qc.setQueryData(["mascot-settings"], { settings });
    setEnabled(settings.enabled);
    setProvider(settings.provider);
    setModel(settings.model);
    setBaseUrl(settings.baseUrl ?? "");
    setModelsUrl(settings.modelsUrl ?? "");
    setApiKey("");
    setReplacingKey(false);
    setFootballKey("");
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    if (s) qc.setQueryData(["mascot-settings"], { settings: { ...s, enabled: next } });
    try {
      const r = await http.patch<{ settings: MascotSettings }>("/api/mascot/settings", { enabled: next });
      applySettings(r.settings);
    } catch (e) {
      setEnabled(!next);
      if (s) qc.setQueryData(["mascot-settings"], { settings: s });
      push("error", e instanceof ApiError ? e.message : "No se pudo actualizar la visibilidad.");
    }
  };

  const save = async (extra?: { clearKey?: boolean; clearFootballKey?: boolean; silent?: boolean }): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await http.patch<{ settings: MascotSettings }>("/api/mascot/settings", {
        enabled,
        provider,
        model: model.trim() || "auto-free",
        baseUrl: provider === "custom" ? (baseUrl.trim() || null) : null,
        modelsUrl: provider === "custom" ? (modelsUrl.trim() || null) : null,
        apiKey: apiKey.trim() || undefined,
        clearKey: extra?.clearKey || undefined,
        footballApiKey: extra?.clearFootballKey ? undefined : (footballKey.trim() || undefined),
        clearFootballKey: extra?.clearFootballKey || undefined,
      });
      setApiKey("");
      setFootballKey("");
      applySettings(r.settings);
      if (!extra?.silent) push("success", extra?.clearKey ? "Clave eliminada" : "Mascota guardada");
      return true;
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "No se pudo guardar.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const saved = await save({ silent: true });
      if (!saved) return;
      await http.post<{ ok: boolean; model: string; preview: string }>("/api/mascot/test");
      const fresh = await http.get<{ settings: MascotSettings }>("/api/mascot/settings");
      applySettings(fresh.settings);
      push("success", "Conexión OK");
    } catch (e) {
      try {
        const fresh = await http.get<{ settings: MascotSettings }>("/api/mascot/settings");
        applySettings(fresh.settings);
      } catch { /* el toast de abajo basta */ }
      push("error", e instanceof ApiError ? e.message : "La prueba falló.");
    } finally {
      setTesting(false);
    }
  };

  if (isLoading || !s) {
    return (
      <section className="card p-5" id="mascot">
        <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint">
          <PawPrint className="w-4 h-4" />Mascota
        </h2>
        <Spinner />
      </section>
    );
  }

  const keyInfo = s.keys?.[provider] ?? {
    hasKey: provider === s.provider && s.hasKey,
    valid: provider === s.provider && s.keyValid,
  };
  const showValid = keyInfo.valid && !replacingKey && !apiKey;

  const customModelField = models.length > 0 ? (
    <Select label="Modelo" value={model} onChange={(e) => setModel(e.target.value)}>
      {models.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
      {models.every((m) => m.id !== model) && model && <option value={model}>{model}</option>}
    </Select>
  ) : (
    <Input label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama-3.1-8b-instant" />
  );

  return (
    <section className="card p-5" id="mascot">
      <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint">
        <PawPrint className="w-4 h-4" />Mascota
      </h2>
      <p className="text-sm text-muted mb-4">Calen ayuda con la agenda, el clima, el fútbol, recetas y ejercicio básico. Cada proveedor guarda su propia API key, cifrada en el servidor; nunca vuelve al navegador.</p>
      {IS_DEMO && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-warn" />
          <span className="text-sm text-text">Calen <b>no se puede probar en la demo</b>: aquí no hay servidor ni modelo de IA. En la app real sí funciona.</span>
        </div>
      )}
      <div className="rounded-xl border border-border/70 overflow-hidden mb-4">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => void toggleEnabled()}
          className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text hover:bg-surface/80"
        >
          <span>Mostrar mascota</span>
          <span className={enabled ? "relative shrink-0 h-5 w-9 rounded-full bg-accent" : "relative shrink-0 h-5 w-9 rounded-full bg-border"}>
            <span className={enabled ? "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm translate-x-[18px]" : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm"} />
          </span>
        </button>
      </div>
      {!IS_DEMO && (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label="Proveedor"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as Provider;
            setProvider(p);
            setApiKey("");
            setReplacingKey(false);
            if (p === "opencode" && model === "") setModel("auto-free");
          }}
        >
          <option value="opencode">OpenCode</option>
          <option value="openrouter">OpenRouter</option>
          <option value="custom">Personalizado</option>
        </Select>
        {provider === "custom" ? (
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">{customModelField}</div>
            <Button type="button" size="sm" variant="ghost" onClick={() => void loadModels(provider, undefined, true)} aria-label="Actualizar catálogo" disabled={loadingModels}>
              {loadingModels ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <Select label="Modelo" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.filter((m) => !m.lane).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {models.some((m) => m.lane === "zen") && (
                  <optgroup label="Gratis (Zen)">
                    {models.filter((m) => m.lane === "zen").map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                {models.some((m) => m.lane === "go") && (
                  <optgroup label="OpenCode Go">
                    {models.filter((m) => m.lane === "go").map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                {models.every((m) => m.id !== model) && model && <option value={model}>{model}</option>}
              </Select>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => void loadModels(provider)} aria-label="Actualizar catálogo">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        )}
        {provider === "custom" && (
          <>
            <Input label="URL base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" />
            <Input
              label="URL de modelos"
              value={modelsUrl}
              onChange={(e) => setModelsUrl(e.target.value)}
              placeholder={baseUrl.trim() ? `${baseUrl.replace(/\/+$/, "")}/models` : "https://api.groq.com/openai/v1/models"}
            />
          </>
        )}
        {showValid ? (
          <div className="space-y-1.5">
            <label className="label">API key</label>
            <button
              type="button"
              className="input w-full text-left text-ok font-semibold tracking-wide"
              onClick={() => setReplacingKey(true)}
              aria-label="API key válida. Pulsar para cambiar"
            >
              API_KEY VALIDA
            </button>
          </div>
        ) : (
          <Input
            label="API key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => {
              if (!apiKey.trim()) setReplacingKey(false);
            }}
            placeholder={keyInfo.hasKey ? "Guardada (deja vacío para no cambiar)" : "sk-…"}
          />
        )}
        <Input
          label="API key de fútbol (football-data.org)"
          type="password"
          value={footballKey}
          onChange={(e) => setFootballKey(e.target.value)}
          placeholder={s.hasFootballKey ? "Guardada (deja vacío para no cambiar)" : "Token de football-data.org"}
        />
      </div>
      <p className="text-xs text-faint mt-2">La clave de fútbol es personal, se guarda cifrada y permite a Calen consultar partidos. Consíguela en <a className="text-accent-strong underline" href="https://www.football-data.org/client/register" target="_blank" rel="noreferrer">football-data.org</a>.</p>
      {provider === "custom" && (
        <p className="text-xs text-faint mt-2">La URL de modelos debe ser OpenAI-compatible (JSON con <code className="font-mono">data[].id</code>). Pulsa el icono de recarga para listar modelos; si el catálogo pide clave, guarda la API key antes.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar mascota"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing || busy}>{testing ? <Spinner /> : "Probar conexión"}</Button>
        {keyInfo.hasKey && (
          <Button size="sm" variant="ghost" onClick={() => void save({ clearKey: true })} disabled={busy}>Quitar clave</Button>
        )}
        {s.hasFootballKey && (
          <Button size="sm" variant="ghost" onClick={() => void save({ clearFootballKey: true })} disabled={busy}>Quitar clave de fútbol</Button>
        )}
      </div>
      </>
      )}
    </section>
  );
}
