import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageCircle, Music, Unlink } from "lucide-react";
import { ApiError, http } from "@/lib/api";
import { Button, ComingSoonBadge, ConfirmDialog, Input, Spinner, useToast } from "@/components/ui";
import { integrationShown, useIntegration } from "@/lib/integrations";
import { QrCode } from "@/components/QrCode";
import {
  beginSpotifyLogin,
  disconnectSpotify,
  fetchSpotifyMe,
  loadSpotifyConfig,
  resetSpotifyConfig,
  spotifyIsConnected,
  type SpotifyMe,
} from "@/lib/spotify";
import { formatKbps, spotifyWebKbps } from "@/lib/streamBitrate";

export function IntegrationsSettings() {
  const telegram = useIntegration("telegram");
  return (
    <div className="space-y-8">
      {integrationShown(telegram) && (
        <IntegrationBlock icon={<MessageCircle className="h-4 w-4" />} title="Telegram" comingSoon={telegram === "COMING_SOON"}>
          {telegram === "AVAILABLE"
            ? <TelegramSettings />
            : <p className="text-sm text-muted">Podrás usar tu propio bot para recibir recordatorios y hablar con Kalen desde Telegram. Estará disponible pronto.</p>}
        </IntegrationBlock>
      )}
      <IntegrationBlock icon={<Music className="h-4 w-4" />} title="Spotify">
        <SpotifySettings />
      </IntegrationBlock>
    </div>
  );
}

function IntegrationBlock({ icon, title, comingSoon, children }: { icon: ReactNode; title: string; comingSoon?: boolean; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">{icon}{title}{comingSoon && <ComingSoonBadge />}</h3>
      {children}
    </section>
  );
}

function SpotifySettings() {
  const { push } = useToast();
  const [me, setMe] = useState<SpotifyMe | null>(null);
  const [connected, setConnected] = useState(spotifyIsConnected);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resetSpotifyConfig();
    void (async () => {
      const cfg = await loadSpotifyConfig();
      if (cancelled) return;
      setEnabled(cfg.available);
      if (!cfg.available || !spotifyIsConnected()) return;
      try {
        const profile = await fetchSpotifyMe();
        if (cancelled) return;
        setMe(profile);
        setConnected(true);
      } catch {
        if (cancelled) return;
        setConnected(spotifyIsConnected());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const connect = () => {
    setBusy(true);
    void beginSpotifyLogin().catch((err: unknown) => {
      setBusy(false);
      push("error", err instanceof Error ? err.message : "No se pudo abrir Spotify.");
    });
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectSpotify();
      setConnected(false);
      setMe(null);
      push("success", "Spotify desconectado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo desconectar Spotify.");
      const cfg = await loadSpotifyConfig().catch(() => null);
      setConnected(Boolean(cfg?.connected));
    } finally {
      setBusy(false);
    }
  };

  const quality = me ? formatKbps(spotifyWebKbps(me.premium)) : null;
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Conectar abre el permiso oficial de Spotify y vuelve a la agenda. Premium usa el reproductor interno (160 kbps en la web); Free mantiene el widget compacto (128 kbps).
      </p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{connected ? "Spotify conectado" : "Spotify no conectado"}</p>
          <p className="truncate text-xs text-muted">
            {me ? `${me.name}${me.premium ? " · Premium" : " · Free"}${quality ? ` · ${quality}` : ""}` : enabled ? "Conecta para ver tus listas en el bloque Radio." : "El administrador aún no ha vinculado la app de Spotify."}
          </p>
        </div>
        {connected ? (
          <Button size="sm" variant="secondary" onClick={() => void disconnect()} disabled={busy}><Unlink className="h-4 w-4" />Desconectar</Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={busy}>{busy ? <Spinner /> : "Conectar"}</Button>
        )}
      </div>
    </div>
  );
}

function TelegramSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => http.get<{
      platformEnabled: boolean;
      linked: boolean;
      username: string | null;
      linkedAt: string | null;
      notifyTelegramReminders: boolean;
      configured: boolean;
      bot: { username: string | null; firstName: string | null; status: "PENDING" | "ACTIVE" | "ERROR"; businessCapable: boolean; webhookVerifiedAt: string | null; lastError: string | null } | null;
    }>("/api/telegram/status"),
  });
  const [notifyReminders, setNotifyReminders] = useState(true);
  const [botToken, setBotToken] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "replace-webhook" | "replace-bot" | "remove"; host?: string | null; nextUsername?: string | null } | null>(null);

  useEffect(() => {
    if (status) setNotifyReminders(status.notifyTelegramReminders);
  }, [status]);

  const savePreference = async (value: boolean) => {
    setNotifyReminders(value);
    try {
      await http.patch("/api/users/me/preferences", { notifyTelegramReminders: value });
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    } catch (e: unknown) {
      setNotifyReminders(!value);
      push("error", e instanceof Error ? e.message : "No se pudo guardar la preferencia.");
    }
  };

  const saveBot = async (replaceExisting = false) => {
    if (!botToken.trim()) return;
    setBusy(true);
    try {
      await http.put("/api/telegram/bot", { token: botToken.trim(), replaceExisting });
      setBotToken("");
      setDeepLink("");
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ["telegram-status"] });
      push("success", "Bot validado. Activa ahora su webhook.");
    } catch (e: unknown) {
      const details = e instanceof ApiError ? e.details as { reason?: string; nextUsername?: string | null } | undefined : undefined;
      if (!replaceExisting && e instanceof ApiError && e.status === 409 && details?.reason === "REPLACE_REQUIRED") {
        setConfirm({ kind: "replace-bot", nextUsername: details.nextUsername });
      } else {
        push("error", e instanceof Error ? e.message : "No se pudo guardar Telegram.");
      }
    } finally {
      setBusy(false);
    }
  };

  const activateWebhook = async (replaceExisting = false) => {
    setBusy(true);
    try {
      await http.post("/api/telegram/bot/webhook", { replaceExisting });
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ["telegram-status"] });
      push("success", "Webhook de Telegram activo");
    } catch (e: unknown) {
      if (!replaceExisting && e instanceof ApiError && e.status === 409) {
        setConfirm({ kind: "replace-webhook", host: (e.details as { existingHost?: string | null } | undefined)?.existingHost });
      } else {
        push("error", e instanceof Error ? e.message : "No se pudo activar el webhook.");
      }
    } finally {
      setBusy(false);
    }
  };

  const removeBot = async () => {
    setBusy(true);
    try {
      await http.del("/api/telegram/bot");
      setConfirm(null);
      setDeepLink("");
      await qc.invalidateQueries({ queryKey: ["telegram-status"] });
      push("success", "Bot de Telegram desconectado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo desconectar el bot.");
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    try {
      const result = await http.post<{ deepLink: string }>("/api/telegram/link");
      setDeepLink(result.deepLink);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo generar el enlace.");
    }
  };

  const unlink = async () => {
    try {
      await http.post("/api/telegram/unlink");
      setDeepLink("");
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
      push("success", "Telegram desvinculado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo desvincular Telegram.");
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted">Cada cuenta usa su propio bot de Telegram. Créalo con @BotFather, pega el token y vincula después tu chat para recibir recordatorios y hablar con Kalen.</p>
      {status && !status.platformEnabled && <p className="mb-3 text-sm text-warn">Telegram está pausado globalmente por el administrador.</p>}
      <div className="mb-3 space-y-3 rounded-xl border border-border/70 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{status?.bot ? (status.bot.username ? `@${status.bot.username}` : status.bot.firstName ?? "Bot configurado") : "Sin bot configurado"}</p>
            <p className="text-xs text-muted">{status?.bot?.status === "ACTIVE" ? "Webhook activo" : status?.bot ? "Pendiente de activar el webhook" : "El token se cifra y nunca vuelve a mostrarse."}</p>
          </div>
          {status?.bot && <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: "remove" })} disabled={busy}>Desconectar bot</Button>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input label={status?.bot ? "Sustituir token o bot" : "Token del bot"} type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Token de @BotFather" />
          <Button className="sm:self-end" size="sm" onClick={() => void saveBot()} disabled={busy || !botToken.trim()}>{busy ? <Spinner /> : "Guardar bot"}</Button>
        </div>
        {status?.bot && status.bot.status !== "ACTIVE" && <Button size="sm" variant="secondary" onClick={() => void activateWebhook()} disabled={busy || !status.platformEnabled}>Activar webhook</Button>}
        {status?.bot?.lastError && <p className="text-xs text-danger">{status.bot.lastError}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3.5 py-3">
        <div className="min-w-0"><p className="text-sm font-medium text-text">{status?.linked ? "Telegram vinculado" : "Telegram no vinculado"}</p><p className="truncate text-xs text-muted">{status?.username ? `@${status.username}` : "Vincula este usuario con un chat de Telegram."}</p></div>
        {status?.linked ? <Button size="sm" variant="secondary" onClick={() => void unlink()}><Unlink className="h-4 w-4" />Desvincular</Button> : <Button size="sm" onClick={() => void link()} disabled={status?.bot?.status !== "ACTIVE" || !status?.platformEnabled}>Vincular</Button>}
      </div>
      {deepLink && (
        <div className="mt-3 space-y-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
          <p className="text-sm text-text">Abre este enlace en Telegram y pulsa iniciar:</p>
          <QrCode value={deepLink} label="Código QR para vincular Telegram" />
          <a className="break-all text-xs text-accent-strong underline" href={deepLink}>{deepLink}</a>
        </div>
      )}
      <div className="mt-3 rounded-xl border border-border/70">
        <Toggle label="Recordatorios por Telegram" on={notifyReminders} set={(value) => void savePreference(value)} />
      </div>
      <ConfirmDialog open={confirm?.kind === "replace-webhook"} onClose={() => setConfirm(null)} title="Sustituir webhook existente" message={`Este bot ya envía sus avisos a ${confirm?.host ?? "otro servidor"}. Sustituirlo puede interrumpir esa integración.`} confirmLabel="Sustituir webhook" danger busy={busy} onConfirm={() => void activateWebhook(true)} />
      <ConfirmDialog open={confirm?.kind === "replace-bot"} onClose={() => setConfirm(null)} title="Sustituir bot de Telegram" message={`Se revocarán el bot actual, su chat vinculado y las conexiones empresariales pendientes${confirm?.nextUsername ? ` para usar @${confirm.nextUsername}` : ""}.`} confirmLabel="Sustituir bot" danger busy={busy} onConfirm={() => void saveBot(true)} />
      <ConfirmDialog open={confirm?.kind === "remove"} onClose={() => setConfirm(null)} title="Desconectar bot" message="Se revocarán el vínculo y las conexiones de Telegram asociadas a esta cuenta." confirmLabel="Desconectar" danger busy={busy} onConfirm={() => void removeBot()} />
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text transition-colors hover:bg-surface/80">
      <span className="min-w-0 leading-snug">{label}</span>
      <span className={clsx("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
        <span className={clsx("absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", on && "translate-x-[18px]")} />
      </span>
    </button>
  );
}
