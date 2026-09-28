import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { http, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CHAT_SIDEBAR_EVENT, MASCOT_SIDEBAR_EVENT } from "@/lib/navOrder";
import { Button, Input, Select, Spinner, useToast } from "@/components/ui";
import { MascotSprite } from "@/components/MascotSprites";
import { MASCOT_IDS, asMascotId, mascotProfile, type MascotId } from "@/lib/mascotCharacters";

type Provider = "opencode" | "openrouter" | "custom";
type KeyStatus = { hasKey: boolean; valid: boolean };
type MascotSettings = {
  enabled: boolean;
  character?: string;
  provider: Provider;
  model: string;
  taskModel?: string | null;
  baseUrl: string | null;
  modelsUrl: string | null;
  usageUrl: string | null;
  hasKey: boolean;
  keyValid?: boolean;
  keys?: Record<Provider, KeyStatus>;
  hasFootballKey?: boolean;
};
type CatalogModel = { id: string; label: string; lane?: "go" | "zen" };

export function MascotSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["mascot-settings"],
    queryFn: () => http.get<{ settings: MascotSettings }>("/api/mascot/settings"),
  });
  const s = data?.settings;
  const [enabled, setEnabled] = useState(true);
  const [sidebarEnabled, setSidebarEnabled] = useState(() => user?.navLayout?.mascotSidebar === true);
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [character, setCharacter] = useState<MascotId>("calen");
  const [provider, setProvider] = useState<Provider>("opencode");
  const [model, setModel] = useState("auto-free");
  const [taskModel, setTaskModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelsUrl, setModelsUrl] = useState("");
  const [usageUrl, setUsageUrl] = useState("");
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
    setCharacter(asMascotId(s.character));
    setProvider(s.provider);
    setModel(s.model);
    setTaskModel(s.taskModel ?? "");
    setBaseUrl(s.baseUrl ?? "");
    setModelsUrl(s.modelsUrl ?? "");
    setUsageUrl(s.usageUrl ?? "");
    setApiKey("");
    setReplacingKey(false);
    setFootballKey("");
  }, [s]);

  useEffect(() => {
    setSidebarEnabled(user?.navLayout?.mascotSidebar === true);
  }, [user?.id, user?.navLayout?.mascotSidebar]);

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
    setCharacter(asMascotId(settings.character));
    setProvider(settings.provider);
    setModel(settings.model);
    setTaskModel(settings.taskModel ?? "");
    setBaseUrl(settings.baseUrl ?? "");
    setModelsUrl(settings.modelsUrl ?? "");
    setUsageUrl(settings.usageUrl ?? "");
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

  const toggleSidebar = async () => {
    if (!user || !enabled || sidebarBusy) return;
    const next = !sidebarEnabled;
    const previousLayout = user.navLayout ?? {};
    setSidebarBusy(true);
    setSidebarEnabled(next);
    window.dispatchEvent(new CustomEvent(MASCOT_SIDEBAR_EVENT, { detail: next }));
    if (next) window.dispatchEvent(new CustomEvent(CHAT_SIDEBAR_EVENT, { detail: false }));
    try {
      await http.patch("/api/users/me/preferences", {
        navLayout: {
          ...previousLayout,
          mascotSidebar: next,
          ...(next ? { chatSidebar: false } : {}),
        },
      });
      void refresh();
      push("success", next ? "Chat de la mascota activado" : "Chat de la mascota oculto");
    } catch (e) {
      setSidebarEnabled(!next);
      window.dispatchEvent(new CustomEvent(MASCOT_SIDEBAR_EVENT, { detail: !next }));
      window.dispatchEvent(new CustomEvent(CHAT_SIDEBAR_EVENT, { detail: previousLayout.chatSidebar === true }));
      push("error", e instanceof ApiError ? e.message : "No se pudo actualizar el chat de la mascota.");
    } finally {
      setSidebarBusy(false);
    }
  };

  const chooseCharacter = async (id: MascotId) => {
    if (id === character) return;
    const prev = character;
    setCharacter(id);
    if (s) qc.setQueryData(["mascot-settings"], { settings: { ...s, character: id } });
    try {
      const r = await http.patch<{ settings: MascotSettings }>("/api/mascot/settings", { character: id });
      applySettings(r.settings);
    } catch (e) {
      setCharacter(prev);
      if (s) qc.setQueryData(["mascot-settings"], { settings: s });
      push("error", e instanceof ApiError ? e.message : "No se pudo cambiar la mascota.");
    }
  };

  const save = async (extra?: { clearKey?: boolean; clearFootballKey?: boolean; silent?: boolean }): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await http.patch<{ settings: MascotSettings }>("/api/mascot/settings", {
        enabled,
        character,
        provider,
        model: model.trim() || "auto-free",
        taskModel: taskModel.trim() || null,
        baseUrl: provider === "custom" ? (baseUrl.trim() || null) : null,
        modelsUrl: provider === "custom" ? (modelsUrl.trim() || null) : null,
        usageUrl: provider === "custom" ? (usageUrl.trim() || null) : null,
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
      <div className="flex min-h-32 items-center justify-center" aria-label="Cargando ajustes de la mascota">
        <Spinner />
      </div>
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
    <div>
      <p className="mb-5 text-sm text-muted">Elige compañera kawaii y configúrala. Ayudan con la agenda, el clima, el fútbol, recetas y ejercicio básico. Cada proveedor guarda su propia API key, cifrada en el servidor; nunca vuelve al navegador.</p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-text">Tu mascota</h3>
          <p className="mb-3 text-xs text-faint">Selecciona quién te acompaña y decide si aparece en la aplicación.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {MASCOT_IDS.map((id) => {
          const profile = mascotProfile(id);
          const selected = character === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => void chooseCharacter(id)}
              aria-pressed={selected}
              aria-label={`Elegir a ${profile.name}, ${profile.role}`}
              className={clsx(
                "rounded-xl border px-2 py-2.5 text-center transition-colors",
                selected ? "border-accent bg-accent-soft ring-2 ring-accent/40" : "border-border hover:border-accent/40 hover:bg-surface",
              )}
            >
              <span className="mx-auto block h-14 w-14">
                <MascotSprite id={id} mood="idle" />
              </span>
              <span className="mt-1 block text-xs font-semibold text-text">{profile.name}</span>
              <span className="block text-[10px] text-faint">{profile.role}</span>
            </button>
          );
        })}
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70 divide-y divide-border/70">
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
        <button
          type="button"
          role="switch"
          aria-checked={sidebarEnabled}
          aria-label="Mostrar chat de la mascota en Aplicaciones"
          disabled={!enabled || sidebarBusy}
          aria-busy={sidebarBusy}
          onClick={() => void toggleSidebar()}
          className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text transition-colors hover:bg-surface/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0">
            <span className="block font-medium">Chat de la mascota en Aplicaciones</span>
            <span className="mt-0.5 block text-xs leading-5 text-faint">Siempre disponible entre Apps y Ayuda.</span>
          </span>
          <span aria-hidden="true" className={sidebarEnabled ? "relative shrink-0 h-5 w-9 rounded-full bg-accent" : "relative shrink-0 h-5 w-9 rounded-full bg-border"}>
            <span className={sidebarEnabled ? "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm translate-x-[18px]" : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm"} />
          </span>
        </button>
          </div>
          <p role="note" className="mt-2 text-xs leading-5 text-muted">
            La mascota y el chat fijados a la izquierda comparten espacio. Solo uno puede estar activo; al activar uno, el otro se desactiva.
          </p>
          {!enabled && <p className="mt-2 text-xs text-faint">Activa «Mostrar mascota» para usar su chat en el sidebar.</p>}
        </div>
        <div className="lg:border-l lg:border-border/70 lg:pl-8">
          <h3 className="mb-1 text-sm font-semibold text-text">Configuración de IA</h3>
          <p className="mb-4 text-xs text-faint">Elige el proveedor y conserva las credenciales cifradas en el servidor.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Proveedor"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as Provider;
            setProvider(p);
            setApiKey("");
            setReplacingKey(false);
            setTaskModel("");
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
        <div className="sm:col-span-2">
          {models.length > 0 ? (
            <Select label="Modelo para tareas" value={taskModel} onChange={(e) => setTaskModel(e.target.value)}>
              <option value="">Igual que la mascota</option>
              {models.filter((m) => m.lane !== "zen").map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {models.some((m) => m.lane === "zen") && (
                <optgroup label="Gratis Zen (no valen con clave Go)">
                  {models.filter((m) => m.lane === "zen").map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </optgroup>
              )}
              {taskModel && models.every((m) => m.id !== taskModel) && <option value={taskModel}>{taskModel}</option>}
            </Select>
          ) : (
            <Input label="Modelo para tareas" value={taskModel} onChange={(e) => setTaskModel(e.target.value)} placeholder="Igual que la mascota" />
          )}
          <p className="mt-1 text-xs text-faint">Título, descripción, subtareas, reprogramar y plan del día. Mejor uno rápido que no razone. Si el elegido no funciona con tu clave, se usa el de la mascota.</p>
        </div>
        {provider === "custom" && (
          <>
            <Input label="URL base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" />
            <Input
              label="URL de modelos"
              value={modelsUrl}
              onChange={(e) => setModelsUrl(e.target.value)}
              placeholder={baseUrl.trim() ? `${baseUrl.replace(/\/+$/, "")}/models` : "https://api.groq.com/openai/v1/models"}
            />
            <Input
              className="sm:col-span-2"
              label="URL de saldo/uso (opcional)"
              value={usageUrl}
              onChange={(e) => setUsageUrl(e.target.value)}
              placeholder={baseUrl.trim() ? `${baseUrl.replace(/\/+$/, "")}/usage` : "https://api.example.com/usage"}
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
          <p className="mt-2 text-xs text-faint">La clave de fútbol es personal, se guarda cifrada y permite a Kalen consultar partidos. Consíguela en <a className="text-accent-strong underline" href="https://www.football-data.org/client/register" target="_blank" rel="noreferrer">football-data.org</a>.</p>
      {provider === "custom" && (
            <p className="mt-2 text-xs text-faint">La URL de modelos debe ser OpenAI-compatible (JSON con <code className="font-mono">data[].id</code>). Pulsa el icono de recarga para listar modelos; si el catálogo pide clave, guarda la API key antes.</p>
      )}
          <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar mascota"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing || busy}>{testing ? <Spinner /> : "Probar conexión"}</Button>
        {keyInfo.hasKey && (
          <Button size="sm" variant="ghost" onClick={() => void save({ clearKey: true })} disabled={busy}>Quitar clave</Button>
        )}
        {s.hasFootballKey && (
          <Button size="sm" variant="ghost" onClick={() => void save({ clearFootballKey: true })} disabled={busy}>Quitar clave de fútbol</Button>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
