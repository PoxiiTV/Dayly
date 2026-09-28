import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Search, Ban, CheckCircle2, Activity, Settings2, Mail, Send, Music, MessageCircle, MessageSquare, Image as ImageIcon, KeyRound } from "lucide-react";
import clsx from "clsx";
import { ApiError, http } from "@/lib/api";
import { Spinner, Button, Input, Select, useToast, ConfirmDialog, EmptyState, Avatar, PageHeader } from "@/components/ui";
import { relativeDay } from "@/lib/dates";

interface AdminStats { stats: { totalUsers: number; activeUsers: number; newUsers: number; newUsersWeek: number; tasks: number; events: number; activeSessions: number; recentErrors: number }; recentActivity: { id: string; action: string; createdAt: string; user?: { name: string; email: string } }[]; }
interface AdminUser { id: string; email: string; name: string; status: "ACTIVE" | "SUSPENDED"; role: { name: string }; createdAt: string; lastLoginAt?: string | null; twoFactorEnabled: boolean; }

export function Admin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPass, setCPass] = useState("");
  const [cRole, setCRole] = useState("USER");
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [rPass, setRPass] = useState("");

  const { data: stats } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => http.get<AdminStats>("/api/admin/stats") });
  const { data: users, isLoading } = useQuery({ queryKey: ["admin", "users", q, page], queryFn: () => http.get<{ users: AdminUser[]; total: number; hasMore: boolean }>("/api/admin/users", { q: q || undefined, page }) });

  const setStatus = async (u: AdminUser, status: "ACTIVE" | "SUSPENDED") => {
    try { await http.patch(`/api/admin/users/${u.id}`, { status }); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", status === "SUSPENDED" ? "Usuario suspendido" : "Usuario reactivado"); } catch (e: any) { push("error", e.message); }
  };
  const setRole = async (u: AdminUser, role: "USER" | "ADMIN") => {
    try { await http.patch(`/api/admin/users/${u.id}`, { role }); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", "Rol actualizado"); } catch (e: any) { push("error", e.message); }
  };
  const create = async () => {
    if (!cName.trim() || !cEmail.trim() || !cPass) return;
    try {
      const created = await http.post<{ user: { email: string }; emailSent?: boolean }>("/api/admin/users", { name: cName.trim(), email: cEmail.trim(), password: cPass, role: cRole });
      setCreateOpen(false); setCName(""); setCEmail(""); setCPass("");
      qc.invalidateQueries({ queryKey: ["admin"] });
      push("success", created.emailSent ? "Usuario creado. Le hemos enviado el acceso por correo." : "Usuario creado. El correo de acceso no se pudo enviar.");
    } catch (e: any) { push("error", e.message); }
  };
  const resetPassword = async () => {
    if (!resetTarget || !rPass) return;
    try {
      const result = await http.post<{ emailSent?: boolean }>(`/api/admin/users/${resetTarget.id}/reset-password`, { password: rPass });
      setResetTarget(null); setRPass("");
      push("success", result.emailSent ? "Contraseña restablecida. Se la hemos enviado por correo." : "Contraseña restablecida. El correo no se pudo enviar.");
    } catch (e: any) { push("error", e.message); }
  };

  const s = stats?.stats;

  return (
    <div className="page-shell">
      <PageHeader
        title="Panel de administración"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear usuario</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Usuarios" value={s?.totalUsers ?? "–"} icon={<Users className="w-4 h-4" />} />
        <Kpi label="Activos" value={s?.activeUsers ?? "–"} icon={<Activity className="w-4 h-4" />} />
        <Kpi label="Nuevos (7d)" value={s?.newUsersWeek ?? "–"} icon={<Plus className="w-4 h-4" />} />
        <Kpi label="Sesiones activas" value={s?.activeSessions ?? "–"} icon={<Activity className="w-4 h-4" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Tareas" value={s?.tasks ?? "–"} />
        <Kpi label="Eventos" value={s?.events ?? "–"} />
        <Kpi label="Con 2FA" value={"–"} />
        <Kpi label="Sesiones" value={"–"} />
      </div>

      <IntegrationSettings />

      {/* Users table */}
      <div className="card overflow-hidden mb-6">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-2.5 w-4 h-4 text-faint" /><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Buscar por nombre o email…" className="pl-9" /></div>
          <span className="text-sm text-muted">{users?.total ?? 0} usuarios</span>
        </div>
        {isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> : !users || users.users.length === 0 ? <EmptyState title="Sin resultados" /> : (
          <div className="divide-y divide-border/60">
            {users.users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={u.name} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{u.name}</p>
                  <p className="text-xs text-muted truncate">{u.email} · alta {relativeDay(u.createdAt)}</p>
                </div>
                <span className={clsx("chip text-[10px]", u.status === "ACTIVE" ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger")}>{u.status === "ACTIVE" ? "Activo" : "Suspendido"}</span>
                <select value={u.role.name} onChange={(e) => setRole(u, e.target.value as "USER" | "ADMIN")} className="input w-28 h-8 text-xs">
                  <option value="USER">Usuario</option><option value="ADMIN">Admin</option>
                </select>
                <div className="flex gap-1">
                  {u.status === "ACTIVE"
                    ? <Button size="sm" variant="ghost" onClick={() => setStatus(u, "SUSPENDED")} title="Suspender"><Ban className="w-4 h-4 text-danger" /></Button>
                    : <Button size="sm" variant="ghost" onClick={() => setStatus(u, "ACTIVE")} title="Reactivar"><CheckCircle2 className="w-4 h-4 text-ok" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => { setResetTarget(u); setRPass(""); }} title="Restablecer contraseña"><KeyRound className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(u)} title="Eliminar">🗑</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {users?.hasMore && <div className="p-3 text-center"><Button variant="secondary" size="sm" onClick={() => setPage(page + 1)}>Cargar más</Button></div>}
      </div>

      {/* Recent activity */}
      {(stats?.recentActivity?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="section-title mb-3">Actividad reciente</h2>
          <ul className="space-y-1.5">
            {stats!.recentActivity.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-muted">{a.user?.name ?? "Sistema"} · <code className="text-faint">{a.action}</code></span>
                <span className="text-faint">{relativeDay(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title="Eliminar usuario" message={`Se borrarán definitivamente todos los datos de «${confirm?.name}». Esta acción no se puede deshacer.`} onConfirm={async () => { if (confirm) { try { await http.del(`/api/admin/users/${confirm.id}`); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", "Usuario eliminado"); } catch (e: any) { push("error", e.message); } } setConfirm(null); }} />

      {/* Create user modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCreateOpen(false)} />
          <div className="relative bg-surface rounded-t-3xl md:rounded-3xl w-full md:max-w-sm p-5 space-y-4 animate-slide-up">
            <h3 className="card-title">Crear usuario</h3>
            <Input label="Nombre" value={cName} onChange={(e) => setCName(e.target.value)} />
            <Input label="Email" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
            <Input label="Contraseña" type="password" value={cPass} onChange={(e) => setCPass(e.target.value)} placeholder="Mín. 10 caracteres" />
            <Select label="Rol" value={cRole} onChange={(e) => setCRole(e.target.value)}><option value="USER">Usuario</option><option value="ADMIN">Admin</option></Select>
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setResetTarget(null)} />
          <div className="relative bg-surface rounded-t-3xl md:rounded-3xl w-full md:max-w-sm p-5 space-y-4 animate-slide-up">
            <h3 className="card-title">Restablecer contraseña</h3>
            <p className="text-sm text-muted">Define una contraseña temporal para <strong className="text-text">{resetTarget.name}</strong>. Se la enviaremos por correo y le pediremos que la cambie al entrar; sus sesiones activas se cerrarán.</p>
            <Input label="Contraseña temporal" type="password" value={rPass} onChange={(e) => setRPass(e.target.value)} placeholder="Mín. 10 caracteres" autoComplete="new-password" />
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setResetTarget(null)}>Cancelar</Button><Button onClick={resetPassword}>Restablecer</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

type SmtpAdmin = { host: string; port: number; username: string; fromAddress: string; passwordConfigured: boolean };
type SpotifyAdmin = { enabled: boolean; configured: boolean; operational: boolean; clientId: string; validatedAt: string | null };
type GoogleAdmin = { enabled: boolean; configured: boolean; operational: boolean; clientId: string; clientSecretConfigured: boolean; validatedAt: string | null };
type WhatsAppAdmin = { enabled: boolean; configured: boolean; operational: boolean; appId: string; configId: string; graphVersion: string; appSecretConfigured: boolean; verifyTokenConfigured: boolean; validatedAt: string | null };
type GifAdmin = { enabled: boolean; hasGiphyKey: boolean; hasKlipyKey: boolean; giphyOn: boolean; klipyOn: boolean; updatedAt: string | null };

type ReconnectKey = "spotify" | "google" | "whatsapp";
type VisibilityKey = "telegram" | "whatsapp" | "gmailGoogle";
type UnavailableDisplay = "HIDDEN" | "COMING_SOON";

function IntegrationSettings() {
  const qc = useQueryClient();
  const { push } = useToast();
  const smtpQuery = useQuery({ queryKey: ["admin", "smtp"], queryFn: () => http.get<{ smtp: SmtpAdmin }>("/api/admin/smtp") });
  const telegramQuery = useQuery({ queryKey: ["admin", "telegram"], queryFn: () => http.get<{ telegram: { enabled: boolean } }>("/api/admin/telegram") });
  const spotifyQuery = useQuery({ queryKey: ["admin", "spotify"], queryFn: () => http.get<{ spotify: SpotifyAdmin }>("/api/admin/spotify") });
  const googleQuery = useQuery({ queryKey: ["admin", "google"], queryFn: () => http.get<{ google: GoogleAdmin }>("/api/admin/google") });
  const whatsappQuery = useQuery({ queryKey: ["admin", "whatsapp"], queryFn: () => http.get<{ whatsapp: WhatsAppAdmin }>("/api/admin/whatsapp") });
  const gifQuery = useQuery({ queryKey: ["admin", "gif"], queryFn: () => http.get<{ gif: GifAdmin }>("/api/admin/gif") });
  const visibilityQuery = useQuery({ queryKey: ["admin", "integration-visibility"], queryFn: () => http.get<{ visibility: Record<VisibilityKey, UnavailableDisplay> }>("/api/admin/integration-visibility") });

  const [smtp, setSmtp] = useState({ host: "", port: "587", username: "", password: "", fromAddress: "" });
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [spotify, setSpotify] = useState({ enabled: false, clientId: "" });
  const [google, setGoogle] = useState({ enabled: false, clientId: "", clientSecret: "" });
  const [whatsapp, setWhatsApp] = useState({ enabled: false, appId: "", appSecret: "", configId: "", verifyToken: "", graphVersion: "" });
  const [gif, setGif] = useState({ enabled: false, giphyKey: "", klipyKey: "", giphyOn: true, klipyOn: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reconnectConfirm, setReconnectConfirm] = useState<{ key: ReconnectKey; affected: number } | null>(null);

  useEffect(() => {
    if (!smtpQuery.data?.smtp) return;
    const value = smtpQuery.data.smtp;
    setSmtp({ host: value.host, port: String(value.port), username: value.username, password: "", fromAddress: value.fromAddress });
  }, [smtpQuery.data]);
  useEffect(() => { if (telegramQuery.data) setTelegramEnabled(telegramQuery.data.telegram.enabled); }, [telegramQuery.data]);
  useEffect(() => { if (spotifyQuery.data) setSpotify({ enabled: spotifyQuery.data.spotify.enabled, clientId: spotifyQuery.data.spotify.clientId }); }, [spotifyQuery.data]);
  useEffect(() => {
    if (googleQuery.data) setGoogle({ enabled: googleQuery.data.google.enabled, clientId: googleQuery.data.google.clientId, clientSecret: "" });
  }, [googleQuery.data]);
  useEffect(() => {
    if (!gifQuery.data) return;
    const value = gifQuery.data.gif;
    setGif({ enabled: value.enabled, giphyKey: "", klipyKey: "", giphyOn: value.giphyOn, klipyOn: value.klipyOn });
  }, [gifQuery.data]);
  useEffect(() => {
    if (!whatsappQuery.data) return;
    const value = whatsappQuery.data.whatsapp;
    setWhatsApp({ enabled: value.enabled, appId: value.appId, appSecret: "", configId: value.configId, verifyToken: "", graphVersion: value.graphVersion });
  }, [whatsappQuery.data]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      await action();
      setReconnectConfirm(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", key] }),
        qc.invalidateQueries({ queryKey: ["integration-visibility"] }),
      ]);
      push("success", success);
    } catch (error: unknown) {
      const details = error instanceof ApiError ? error.details as { reason?: string; affectedConnections?: number } | undefined : undefined;
      if (error instanceof ApiError && error.status === 409 && details?.reason === "RECONNECT_REQUIRED" && ["spotify", "google", "whatsapp"].includes(key)) {
        setReconnectConfirm({ key: key as ReconnectKey, affected: Number(details.affectedConnections ?? 0) });
        return;
      }
      const message = error instanceof Error ? error.message : "No se pudieron guardar los cambios.";
      setErrors((current) => ({ ...current, [key]: message }));
    } finally { setBusy(null); }
  };

  const saveVisibility = async (key: VisibilityKey, value: UnavailableDisplay) => {
    setBusy("integration-visibility");
    try {
      await http.patch("/api/admin/integration-visibility", { [key]: value });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "integration-visibility"] }),
        qc.invalidateQueries({ queryKey: ["integration-visibility"] }),
      ]);
      push("success", value === "HIDDEN" ? "Se ocultará a los usuarios mientras no esté activa" : "Se mostrará como «Próximamente» mientras no esté activa");
    } catch (error: unknown) {
      push("error", error instanceof Error ? error.message : "No se pudo guardar la visibilidad.");
    } finally { setBusy(null); }
  };
  const visibilityControl = (key: VisibilityKey) => (
    <UnavailableDisplaySelect
      value={visibilityQuery.data?.visibility[key]}
      disabled={busy === "integration-visibility"}
      onChange={(value) => void saveVisibility(key, value)}
    />
  );

  const saveSpotify = (confirmReconnect = false) => run(
    "spotify",
    () => http.patch("/api/admin/spotify", { ...spotify, confirmReconnect }),
    "Spotify actualizado",
  );
  const saveGoogle = (confirmReconnect = false) => run(
    "google",
    async () => {
      const payload: Record<string, unknown> = { enabled: google.enabled, clientId: google.clientId, confirmReconnect };
      if (google.clientSecret) payload.clientSecret = google.clientSecret;
      await http.patch("/api/admin/google", payload);
      setGoogle((value) => ({ ...value, clientSecret: "" }));
    },
    "Google actualizado",
  );
  const saveWhatsApp = (confirmReconnect = false) => run(
    "whatsapp",
    async () => {
      const payload: Record<string, unknown> = { enabled: whatsapp.enabled, appId: whatsapp.appId, configId: whatsapp.configId, graphVersion: whatsapp.graphVersion, confirmReconnect };
      if (whatsapp.appSecret) payload.appSecret = whatsapp.appSecret;
      if (whatsapp.verifyToken) payload.verifyToken = whatsapp.verifyToken;
      await http.patch("/api/admin/whatsapp", payload);
      setWhatsApp((value) => ({ ...value, appSecret: "", verifyToken: "" }));
    },
    "WhatsApp actualizado",
  );

  const saveGif = () => run(
    "gif",
    async () => {
      // An empty field means "keep the stored key", never "clear it": clearing
      // is done by switching the integration off.
      const payload: Record<string, unknown> = { enabled: gif.enabled, giphyOn: gif.giphyOn, klipyOn: gif.klipyOn };
      if (gif.giphyKey) payload.giphyKey = gif.giphyKey;
      if (gif.klipyKey) payload.klipyKey = gif.klipyKey;
      await http.patch("/api/admin/gif", payload);
      setGif((value) => ({ ...value, giphyKey: "", klipyKey: "" }));
    },
    "GIF actualizado",
  );

  const confirmPlatformReconnect = () => {
    if (!reconnectConfirm) return;
    if (reconnectConfirm.key === "spotify") void saveSpotify(true);
    else if (reconnectConfirm.key === "google") void saveGoogle(true);
    else void saveWhatsApp(true);
  };

  const pending = [smtpQuery, telegramQuery, spotifyQuery, googleQuery, whatsappQuery, gifQuery].some((query) => query.isLoading);
  return (
    <section className="card p-5 mb-6" aria-labelledby="integration-settings-title">
      <div className="flex items-start gap-3 mb-4">
        <Settings2 className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
        <div>
          <h2 id="integration-settings-title" className="section-title">Integraciones de la plataforma</h2>
          <p className="text-xs text-muted mt-1">Estas credenciales son globales. Cada usuario conecta después sus propias cuentas y bots desde Ajustes.</p>
          <p className="text-xs text-muted mt-1">Google, Meta y Spotify quedan validados cuando una conexión real completa el flujo del proveedor.</p>
        </div>
      </div>
      {pending ? <div className="h-24 grid place-items-center text-accent"><Spinner /></div> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <AdminIntegrationForm title="Telegram" icon={<MessageCircle className="w-4 h-4" aria-hidden />} configured={telegramQuery.data?.telegram.enabled ?? false} error={errors.telegram} onSubmit={(event) => { event.preventDefault(); void run("telegram", () => http.patch("/api/admin/telegram", { enabled: telegramEnabled }), "Telegram actualizado"); }} busy={busy === "telegram"}>
            <AdminSwitch label="Habilitar Telegram para usuarios" checked={telegramEnabled} onChange={setTelegramEnabled} />
            <p className="text-xs text-muted">El bot y el webhook pertenecen a cada usuario; este interruptor detiene envíos y recepción globalmente.</p>
            {visibilityControl("telegram")}
          </AdminIntegrationForm>

          <AdminIntegrationForm title="GIF del chat" icon={<ImageIcon className="w-4 h-4" aria-hidden />} configured={(gifQuery.data?.gif.hasGiphyKey || gifQuery.data?.gif.hasKlipyKey) ?? false} operational={gifQuery.data?.gif.enabled} error={errors.gif} onSubmit={(event) => { event.preventDefault(); void saveGif(); }} busy={busy === "gif"}>
            <AdminSwitch label="Habilitar la búsqueda de GIF" checked={gif.enabled} onChange={(enabled) => setGif((value) => ({ ...value, enabled }))} />
            <AdminSwitch label="Usar Giphy" checked={gif.giphyOn} onChange={(giphyOn) => setGif((value) => ({ ...value, giphyOn }))} />
            <Input
              label={gifQuery.data?.gif.hasGiphyKey ? "Clave de Giphy (guardada; escribe para rotarla)" : "Clave de Giphy"}
              type="password"
              value={gif.giphyKey}
              onChange={(event) => setGif((value) => ({ ...value, giphyKey: event.target.value }))}
              autoComplete="off"
              placeholder={gifQuery.data?.gif.hasGiphyKey ? "••••••••" : "developers.giphy.com"}
            />
            <AdminSwitch label="Usar Klipy" checked={gif.klipyOn} onChange={(klipyOn) => setGif((value) => ({ ...value, klipyOn }))} />
            <Input
              label={gifQuery.data?.gif.hasKlipyKey ? "Clave de Klipy (guardada; escribe para rotarla)" : "Clave de Klipy"}
              type="password"
              value={gif.klipyKey}
              onChange={(event) => setGif((value) => ({ ...value, klipyKey: event.target.value }))}
              autoComplete="off"
              placeholder={gifQuery.data?.gif.hasKlipyKey ? "••••••••" : "klipy.com/developers"}
            />
            <p className="text-xs text-muted">Basta con una de las dos; con ambas, cada búsqueda mezcla resultados de las dos y una sigue funcionando si la otra agota su cuota. Apagar un proveedor conserva su clave para volver a encenderlo. Se guardan cifradas y nunca se devuelven al navegador: las búsquedas las hace el servidor.</p>
          </AdminIntegrationForm>

          <AdminIntegrationForm title="Spotify" icon={<Music className="w-4 h-4" aria-hidden />} configured={spotifyQuery.data?.spotify.configured ?? false} operational={spotifyQuery.data?.spotify.operational} error={errors.spotify} onSubmit={(event) => { event.preventDefault(); void saveSpotify(); }} busy={busy === "spotify"}>
            <AdminSwitch label="Habilitar Spotify" checked={spotify.enabled} onChange={(enabled) => setSpotify((value) => ({ ...value, enabled }))} />
            <Input label="Client ID" value={spotify.clientId} onChange={(event) => setSpotify((value) => ({ ...value, clientId: event.target.value }))} autoComplete="off" />
            <p className="text-xs text-muted break-all">Redirect URI: {window.location.origin}/spotify/callback</p>
          </AdminIntegrationForm>

          <AdminIntegrationForm title="Google Gmail" icon={<Mail className="w-4 h-4" aria-hidden />} configured={googleQuery.data?.google.configured ?? false} operational={googleQuery.data?.google.operational} error={errors.google} onSubmit={(event) => { event.preventDefault(); void saveGoogle(); }} busy={busy === "google"}>
            <AdminSwitch label="Habilitar conexión con Gmail" checked={google.enabled} onChange={(enabled) => setGoogle((value) => ({ ...value, enabled }))} />
            <Input label="Client ID" value={google.clientId} onChange={(event) => setGoogle((value) => ({ ...value, clientId: event.target.value }))} autoComplete="off" />
            <Input label="Client Secret" type="password" value={google.clientSecret} onChange={(event) => setGoogle((value) => ({ ...value, clientSecret: event.target.value }))} placeholder={googleQuery.data?.google.clientSecretConfigured ? "Guardado · vacío conserva el actual" : "Client Secret"} autoComplete="new-password" />
            <p className="text-xs text-muted break-all">Redirect URI: {window.location.origin}/api/inbox/mailboxes/google/callback</p>
            {visibilityControl("gmailGoogle")}
          </AdminIntegrationForm>

          <AdminIntegrationForm title="WhatsApp Business" icon={<MessageSquare className="w-4 h-4" aria-hidden />} configured={whatsappQuery.data?.whatsapp.configured ?? false} operational={whatsappQuery.data?.whatsapp.operational} error={errors.whatsapp} onSubmit={(event) => { event.preventDefault(); void saveWhatsApp(); }} busy={busy === "whatsapp"}>
            <AdminSwitch label="Habilitar WhatsApp Business" checked={whatsapp.enabled} onChange={(enabled) => setWhatsApp((value) => ({ ...value, enabled }))} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="App ID" value={whatsapp.appId} onChange={(event) => setWhatsApp((value) => ({ ...value, appId: event.target.value }))} autoComplete="off" />
              <Input label="Configuration ID" value={whatsapp.configId} onChange={(event) => setWhatsApp((value) => ({ ...value, configId: event.target.value }))} autoComplete="off" />
              <Input label="App Secret" type="password" value={whatsapp.appSecret} onChange={(event) => setWhatsApp((value) => ({ ...value, appSecret: event.target.value }))} placeholder={whatsappQuery.data?.whatsapp.appSecretConfigured ? "Guardado · vacío conserva el actual" : "App Secret"} autoComplete="new-password" />
              <Input label="Verify Token" type="password" value={whatsapp.verifyToken} onChange={(event) => setWhatsApp((value) => ({ ...value, verifyToken: event.target.value }))} placeholder={whatsappQuery.data?.whatsapp.verifyTokenConfigured ? "Guardado · vacío conserva el actual" : "Verify Token"} autoComplete="new-password" />
              <Input label="Versión Graph" value={whatsapp.graphVersion} onChange={(event) => setWhatsApp((value) => ({ ...value, graphVersion: event.target.value }))} placeholder="v23.0" />
            </div>
            <p className="text-xs text-muted break-all">Webhook: {window.location.origin}/api/messaging/whatsapp/webhook</p>
            {visibilityControl("whatsapp")}
          </AdminIntegrationForm>

          <AdminIntegrationForm title="Correo transaccional SMTP" icon={<Mail className="w-4 h-4" aria-hidden />} configured={Boolean(smtpQuery.data?.smtp.host)} error={errors.smtp} onSubmit={(event) => { event.preventDefault(); const payload: Record<string, unknown> = { host: smtp.host, port: Number(smtp.port), username: smtp.username, fromAddress: smtp.fromAddress }; if (smtp.password) payload.password = smtp.password; void run("smtp", async () => { await http.patch("/api/admin/smtp", payload); setSmtp((value) => ({ ...value, password: "" })); }, "SMTP actualizado"); }} busy={busy === "smtp"}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Servidor" value={smtp.host} onChange={(event) => setSmtp((value) => ({ ...value, host: event.target.value }))} placeholder="smtp.example.com" />
              <Input label="Puerto" type="number" min={1} max={65535} value={smtp.port} onChange={(event) => setSmtp((value) => ({ ...value, port: event.target.value }))} />
              <Input label="Usuario" value={smtp.username} onChange={(event) => setSmtp((value) => ({ ...value, username: event.target.value }))} autoComplete="username" />
              <Input label="Contraseña" type="password" value={smtp.password} onChange={(event) => setSmtp((value) => ({ ...value, password: event.target.value }))} placeholder={smtpQuery.data?.smtp.passwordConfigured ? "Guardada · vacío conserva la actual" : "Contraseña"} autoComplete="new-password" />
              <div className="sm:col-span-2"><Input label="Remitente" value={smtp.fromAddress} onChange={(event) => setSmtp((value) => ({ ...value, fromAddress: event.target.value }))} placeholder="DAYLY <no-reply@example.com>" /></div>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void run("smtp", () => http.post("/api/admin/smtp/test"), "Conexión SMTP correcta")} disabled={busy === "smtp"}><Send className="w-4 h-4" aria-hidden />Probar conexión</Button>
          </AdminIntegrationForm>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(reconnectConfirm)}
        onClose={() => setReconnectConfirm(null)}
        title="Cambiar aplicación de plataforma"
        message={`La nueva configuración dejará ${reconnectConfirm?.affected ?? 0} conexión(es) pendientes de volver a autorizar y cancelará sus envíos programados.`}
        confirmLabel="Cambiar y solicitar reconexión"
        danger
        busy={Boolean(busy)}
        onConfirm={confirmPlatformReconnect}
      />
    </section>
  );
}

function AdminIntegrationForm({ title, icon, configured, operational, error, busy, onSubmit, children }: { title: string; icon: React.ReactNode; configured: boolean; operational?: boolean; error?: string; busy: boolean; onSubmit: React.FormEventHandler<HTMLFormElement>; children: React.ReactNode }) {
  const label = operational === undefined ? (configured ? "Configurado" : "Pendiente") : operational ? "Validado" : configured ? "Sin validar" : "Pendiente";
  const ready = operational === undefined ? configured : operational;
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-text flex items-center gap-2">{icon}{title}</h3>
        <span className={clsx("chip text-[10px]", ready ? "bg-ok/15 text-ok" : "bg-bg text-muted")}>{label}</span>
      </div>
      {error && <p role="alert" tabIndex={-1} className="text-sm text-danger rounded-lg bg-danger/10 px-3 py-2">{error}</p>}
      {children}
      <Button type="submit" size="sm" disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
    </form>
  );
}

/** What users see while the integration is off or incomplete. Saves on change. */
function UnavailableDisplaySelect({ value, disabled, onChange }: { value?: UnavailableDisplay; disabled: boolean; onChange: (value: UnavailableDisplay) => void }) {
  return (
    <div className="space-y-1">
      <Select label="Mientras no esté activa, los usuarios la ven" value={value ?? "COMING_SOON"} disabled={disabled || !value} onChange={(event) => onChange(event.target.value as UnavailableDisplay)}>
        <option value="COMING_SOON">Con la etiqueta «Próximamente»</option>
        <option value="HIDDEN">Oculta</option>
      </Select>
      <p className="text-xs text-muted">Se aplica al instante. Al habilitarla y completar su configuración, aparece para todos.</p>
    </div>
  );
}

function AdminSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="min-h-11 flex w-full items-center justify-between gap-4 rounded-xl border border-border px-3.5 py-2 text-left text-sm text-text hover:bg-surface transition-colors">
      <span>{label}</span>
      <span aria-hidden className={clsx("relative shrink-0 h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-border")}><span className={clsx("absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-[18px]")} /></span>
    </button>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted mb-1 text-[11px]">{icon}{label}</div>
      <div className="text-2xl font-bold text-text tabular-nums">{value}</div>
    </div>
  );
}
