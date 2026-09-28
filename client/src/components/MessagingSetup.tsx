import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessageCircleMore, RefreshCw, Settings2, Trash2, Unplug } from "lucide-react";
import { Button, ComingSoonBadge, ConfirmDialog, Spinner, useToast } from "@/components/ui";
import { integrationShown, type IntegrationState } from "@/lib/integrations";
import { http } from "@/lib/api";
import type { MessagingConnection } from "@/lib/types";

export type MessagingAvailability = {
  telegram: { enabled: boolean; linkedToCalen: boolean; username: string | null };
  whatsapp: { enabled: boolean; configured: boolean; appId: string | null; configId: string | null; graphVersion?: string | null };
};

export function MessagingSetup({ connections, availability, states }: {
  connections: MessagingConnection[];
  availability: MessagingAvailability;
  states: { telegram?: IntegrationState; whatsapp?: IntegrationState };
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<MessagingConnection | null>(null);
  const [remove, setRemove] = useState<MessagingConnection | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["messaging-connections"] });
  const telegram = preferredConnection(connections, "TELEGRAM");
  const whatsapp = preferredConnection(connections, "WHATSAPP");
  const visible = new Set([telegram?.id, whatsapp?.id].filter(Boolean));
  const archived = connections.filter((item) => item.status === "REVOKED" && !visible.has(item.id));

  const linkTelegram = async () => {
    setBusy("telegram");
    try {
      const result = await http.post<{ deepLink: string }>("/api/telegram/link");
      window.open(result.deepLink, "_blank", "noopener,noreferrer");
      push("info", "Completa la vinculación en Telegram y después conecta el bot desde Telegram Business.");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo iniciar la vinculación.");
    } finally {
      setBusy(null);
    }
  };

  const connectWhatsApp = async () => {
    const cfg = availability.whatsapp;
    if (!cfg.configured || !cfg.appId || !cfg.configId || !cfg.graphVersion) {
      push("error", "WhatsApp aún no está preparado por el administrador.");
      return;
    }
    setBusy("whatsapp");
    try {
      const result = await launchWhatsAppSignup(cfg.appId, cfg.configId, cfg.graphVersion);
      await http.post("/api/messaging/whatsapp/connect", result);
      await refresh();
      push("success", "WhatsApp Business conectado");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo conectar WhatsApp.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="card overflow-hidden group">
      <summary className="min-h-11 px-4 py-3 flex items-center gap-3 cursor-pointer list-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <Settings2 className="w-4 h-4 text-accent" aria-hidden />
        <span className="font-medium text-sm text-text">Canales conectados</span>
        <span className="text-xs text-muted ml-auto">{connections.filter((item) => item.status === "ACTIVE").length}/{[states.telegram, states.whatsapp].filter(integrationShown).length} activos</span>
      </summary>
      <div className="border-t border-border/70 p-4 grid gap-3 lg:grid-cols-2">
        {integrationShown(states.telegram) && <ChannelCard
          title="Telegram Business"
          comingSoon={states.telegram === "COMING_SOON"}
          description={availability.telegram.linkedToCalen
            ? "Calen ya conoce tu identidad. Conecta este bot desde Telegram → Ajustes → Telegram Business → Chatbots."
            : "Primero vincula tu chat con Calen para comprobar la identidad de la cuenta empresarial."}
          connection={telegram}
          enabled={availability.telegram.enabled}
          busy={busy === "telegram"}
          actionLabel={availability.telegram.linkedToCalen ? "Abrir bot" : "Vincular Telegram"}
          onAction={() => void linkTelegram()}
          onDisconnect={() => telegram && setDisconnect(telegram)}
          onRemove={() => telegram && setRemove(telegram)}
          onRefresh={() => void refresh()}
        />}
        {integrationShown(states.whatsapp) && <ChannelCard
          title="WhatsApp Business"
          comingSoon={states.whatsapp === "COMING_SOON"}
          description="Conexión oficial mediante Embedded Signup. La coexistencia conserva el uso de la app de WhatsApp Business."
          connection={whatsapp}
          enabled={availability.whatsapp.enabled && availability.whatsapp.configured}
          busy={busy === "whatsapp"}
          actionLabel="Conectar WhatsApp"
          onAction={() => void connectWhatsApp()}
          onDisconnect={() => whatsapp && setDisconnect(whatsapp)}
          onRemove={() => whatsapp && setRemove(whatsapp)}
          onRefresh={() => void refresh()}
        />}
      </div>
      {archived.length > 0 && (
        <div className="border-t border-border/70 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Copias archivadas</h3>
          <ul className="mt-2 space-y-2">
            {archived.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                <span className="min-w-0 text-sm text-text truncate">{connection.provider === "TELEGRAM" ? "Telegram" : "WhatsApp"} · {connection.label}</span>
                <Button size="sm" variant="danger" onClick={() => setRemove(connection)} disabled={busy === connection.id}><Trash2 className="w-4 h-4" aria-hidden />Borrar copia</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(disconnect)}
        onClose={() => setDisconnect(null)}
        title={`Desconectar ${disconnect?.label ?? "canal"}`}
        message={`Se revocará el uso local y se cancelarán los envíos pendientes. La copia cifrada de los mensajes se conserva hasta que decidas borrarla o venza el plazo de 90 días.${disconnect?.provider === "TELEGRAM" ? " Para volver a conectarlo, quita el bot en Telegram → Ajustes → Telegram Business → Chatbots y añádelo de nuevo." : ""}`}
        confirmLabel="Desconectar"
        onConfirm={() => {
          if (!disconnect) return;
          setBusy(disconnect.id);
          void http.post(`/api/messaging/connections/${disconnect.id}/disconnect`)
            .then(async () => { await refresh(); push("success", "Canal desconectado"); })
            .catch((error: unknown) => push("error", error instanceof Error ? error.message : "No se pudo desconectar."))
            .finally(() => { setBusy(null); setDisconnect(null); });
        }}
      />
      <ConfirmDialog
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Borrar copia local"
        message="Se eliminarán de Dayly la conexión, conversaciones, mensajes y borradores de este canal. Los recordatorios se conservarán indicando que el origen ya no está disponible. Esta acción no se puede deshacer."
        confirmLabel="Borrar copia local"
        onConfirm={() => {
          if (!remove) return;
          setBusy(remove.id);
          void http.del(`/api/messaging/connections/${remove.id}/data`, { confirmation: "BORRAR" })
            .then(async () => { await refresh(); push("success", "Copia local eliminada"); })
            .catch((error: unknown) => push("error", error instanceof Error ? error.message : "No se pudo borrar."))
            .finally(() => { setBusy(null); setRemove(null); });
        }}
      />
    </details>
  );
}

function preferredConnection(connections: MessagingConnection[], provider: MessagingConnection["provider"]): MessagingConnection | undefined {
  const matching = connections.filter((item) => item.provider === provider);
  return matching.find((item) => item.status !== "REVOKED") ?? matching[0];
}

function ChannelCard(props: {
  title: string;
  comingSoon?: boolean;
  description: string;
  connection?: MessagingConnection;
  enabled: boolean;
  busy: boolean;
  actionLabel: string;
  onAction: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const active = props.connection?.status === "ACTIVE";
  if (props.comingSoon && !props.connection) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-surface/30 p-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-bg text-faint grid place-items-center shrink-0"><MessageCircleMore className="w-5 h-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-text">{props.title}</h3>
            <p className="text-xs text-muted mt-0.5 leading-relaxed">Estamos preparando esta conexión. Aparecerá aquí en cuanto esté disponible.</p>
          </div>
          <ComingSoonBadge />
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-surface/50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><MessageCircleMore className="w-5 h-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-text">{props.title}</h3>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">{props.description}</p>
        </div>
        <span className={active ? "chip bg-ok/15 text-ok" : "chip bg-bg text-muted"}>{active ? "Activo" : props.connection ? "Desconectado" : "Sin conectar"}</span>
      </div>
      {props.connection && <p className="text-sm text-text truncate">Cuenta: {props.connection.label}</p>}
      {props.connection?.lastError && <p className="text-xs text-warning">{props.connection.lastError}</p>}
      {!props.enabled && <p className="text-xs text-warning">Este canal todavía no está habilitado en el servidor.</p>}
      <div className="flex flex-wrap gap-2">
        {!active && (
          <Button size="sm" onClick={props.onAction} disabled={!props.enabled || props.busy}>
            {props.busy ? <Spinner /> : <ExternalLink className="w-4 h-4" aria-hidden />}{props.actionLabel}
          </Button>
        )}
        {active && <Button size="sm" variant="secondary" onClick={props.onDisconnect}><Unplug className="w-4 h-4" aria-hidden />Desconectar</Button>}
        {props.connection?.status === "REVOKED" && <Button size="sm" variant="danger" onClick={props.onRemove}><Trash2 className="w-4 h-4" aria-hidden />Borrar copia</Button>}
        <Button size="sm" variant="ghost" onClick={props.onRefresh}><RefreshCw className="w-4 h-4" aria-hidden />Actualizar</Button>
      </div>
    </section>
  );
}

type FacebookAuthResponse = { authResponse?: { code?: string } };
type FacebookApi = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: FacebookAuthResponse) => void, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    FB?: FacebookApi;
    fbAsyncInit?: () => void;
  }
}

async function launchWhatsAppSignup(appId: string, configId: string, graphVersion: string) {
  const FB = await loadFacebookSdk(appId, graphVersion);
  let resolveSession!: (value: { phoneNumberId: string; wabaId: string }) => void;
  let rejectSession!: (error: Error) => void;
  const session = new Promise<{ phoneNumberId: string; wabaId: string }>((resolve, reject) => { resolveSession = resolve; rejectSession = reject; });
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
    let value: unknown = event.data;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return; }
    }
    const root = value as { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };
    if (root.type !== "WA_EMBEDDED_SIGNUP") return;
    // Coexistence onboarding (WhatsApp Business app) finishes with its own
    // event name; the Cloud API-only flow uses FINISH.
    const finished = root.event === "FINISH" || root.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
    if (finished && root.data?.phone_number_id && root.data.waba_id) {
      resolveSession({ phoneNumberId: root.data.phone_number_id, wabaId: root.data.waba_id });
    } else if (root.event === "CANCEL" || root.event === "ERROR") {
      rejectSession(new Error("La conexión de WhatsApp no se completó."));
    }
  };
  window.addEventListener("message", onMessage);
  try {
    const code = await new Promise<string>((resolve, reject) => {
      FB.login((response) => response.authResponse?.code ? resolve(response.authResponse.code) : reject(new Error("Meta no devolvió autorización.")), {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      });
    });
    const info = await withTimeout(session, 60_000, "Meta no devolvió los datos del número seleccionado.");
    return { code, ...info };
  } finally {
    window.removeEventListener("message", onMessage);
  }
}

function loadFacebookSdk(appId: string, graphVersion: string): Promise<FacebookApi> {
  return new Promise((resolve, reject) => {
    const init = () => {
      if (!window.FB) { reject(new Error("No se pudo cargar el SDK de Meta.")); return; }
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      resolve(window.FB);
    };
    if (window.FB) { init(); return; }
    window.fbAsyncInit = init;
    const existing = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("error", () => reject(new Error("No se pudo cargar el SDK de Meta.")), { once: true }); return; }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.src = "https://connect.facebook.net/es_ES/sdk.js";
    script.onerror = () => reject(new Error("No se pudo cargar el SDK de Meta."));
    document.head.appendChild(script);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}
