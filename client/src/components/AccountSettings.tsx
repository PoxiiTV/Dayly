import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import clsx from "clsx";
import { Lock, LockKeyhole, ShieldCheck, Trash2, RefreshCw, Download, Upload, Database, KeyRound, Fingerprint, Copy, Link2 } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Input, Spinner, useToast, Modal, Checkbox, ConfirmDialog } from "@/components/ui";
import { QrCode } from "@/components/QrCode";

type QuickPinMode = "setup" | "change" | "disable" | "delete";

function pinDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function AccountSecurity() {
  const { user, refresh } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; current?: boolean; userAgent?: string; lastUsedAt: string }[]>([]);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [tfSetup, setTfSetup] = useState<{ secret: string; url: string } | null>(null);
  const [tfCode, setTfCode] = useState("");
  const [tfPwOpen, setTfPwOpen] = useState(false);
  const [tfPw, setTfPw] = useState("");
  const [quickPinMode, setQuickPinMode] = useState<QuickPinMode | null>(null);
  const [quickPin, setQuickPin] = useState("");
  const [quickPinConfirmation, setQuickPinConfirmation] = useState("");
  const [quickPinCurrent, setQuickPinCurrent] = useState("");
  const [quickPinBusy, setQuickPinBusy] = useState(false);
  const [quickPinCurrentError, setQuickPinCurrentError] = useState("");
  const [quickPinError, setQuickPinError] = useState("");
  const [quickPinConfirmationError, setQuickPinConfirmationError] = useState("");

  if (!user) return null;

  const changePassword = async () => {
    setBusy(true);
    try {
      await http.post("/api/auth/change-password", { currentPassword: oldPw, newPassword: newPw });
      push("success", "Contraseña cambiada");
      setOldPw("");
      setNewPw("");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar.");
    } finally { setBusy(false); }
  };

  const loadSessions = async () => {
    const d = await http.get<{ sessions: typeof sessions }>("/api/auth/sessions");
    setSessions(d.sessions);
  };

  const setup2fa = async () => {
    try {
      const d = await http.post<{ secret: string; url: string }>("/api/auth/2fa/setup", { currentPassword: tfPw });
      setTfPwOpen(false);
      setTfPw("");
      setTfSetup(d);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo iniciar 2FA.");
    }
  };

  const enable2fa = async () => {
    try {
      const d = await http.post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code: tfCode });
      setCodes(d.recoveryCodes);
      setTfSetup(null);
      setTfCode("");
      qc.invalidateQueries();
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo activar.");
    }
  };

  const disable2fa = async () => {
    try {
      await http.post("/api/auth/2fa/disable", { code: tfCode });
      push("success", "2FA desactivada");
      setTfCode("");
      setDisableOpen(false);
      qc.invalidateQueries();
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo desactivar.");
    }
  };

  const regenCodes = async () => {
    try {
      const d = await http.post<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery-codes", { code: tfCode });
      setCodes(d.recoveryCodes);
      setRegenOpen(false);
      setTfCode("");
      push("success", "Códigos nuevos. Los anteriores ya no valen.");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudieron generar.");
    }
  };

  const openQuickPin = (mode: QuickPinMode) => {
    setQuickPinMode(mode);
    setQuickPin("");
    setQuickPinConfirmation("");
    setQuickPinCurrent("");
    setQuickPinCurrentError("");
    setQuickPinError("");
    setQuickPinConfirmationError("");
  };

  const closeQuickPin = () => {
    setQuickPinMode(null);
    setQuickPin("");
    setQuickPinConfirmation("");
    setQuickPinCurrent("");
    setQuickPinCurrentError("");
    setQuickPinError("");
    setQuickPinConfirmationError("");
  };

  const toggleQuickPin = async (enabled: boolean) => {
    if (!enabled) {
      openQuickPin("disable");
      return;
    }
    setQuickPinBusy(true);
    try {
      await http.patch("/api/auth/quick-pin", { enabled: true });
      await refresh();
      push("success", "PIN rápido activado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo activar el PIN.");
    } finally { setQuickPinBusy(false); }
  };

  const saveQuickPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!quickPinMode) return;
    const requiresCurrent = quickPinMode !== "setup";
    const requiresNewPin = quickPinMode === "setup" || quickPinMode === "change";
    let valid = true;
    if (requiresCurrent && quickPinCurrent.length !== 4) {
      setQuickPinCurrentError("Escribe el PIN actual de 4 dígitos.");
      valid = false;
    } else {
      setQuickPinCurrentError("");
    }
    if (requiresNewPin && quickPin.length !== 4) {
      setQuickPinError("El PIN debe tener exactamente 4 dígitos.");
      valid = false;
    } else {
      setQuickPinError("");
    }
    if (requiresNewPin && quickPin !== quickPinConfirmation) {
      setQuickPinConfirmationError("Los PIN no coinciden.");
      valid = false;
    } else {
      setQuickPinConfirmationError("");
    }
    if (!valid) return;

    setQuickPinBusy(true);
    try {
      if (quickPinMode === "setup" || quickPinMode === "change") {
        await http.post("/api/auth/quick-pin", { pin: quickPin, ...(quickPinMode === "change" ? { currentPin: quickPinCurrent } : {}) });
        push("success", quickPinMode === "setup" ? "PIN rápido configurado" : "PIN rápido cambiado");
      } else if (quickPinMode === "disable") {
        await http.patch("/api/auth/quick-pin", { enabled: false, currentPin: quickPinCurrent });
        push("success", "PIN rápido desactivado");
      } else {
        await http.del("/api/auth/quick-pin", { currentPin: quickPinCurrent });
        push("success", "PIN rápido eliminado");
      }
      await refresh();
      closeQuickPin();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "No se pudo actualizar el PIN.";
      if (requiresCurrent) setQuickPinCurrentError(message);
      else setQuickPinError(message);
    } finally { setQuickPinBusy(false); }
  };

  return (
    <>
      <section className="card p-5">
        <h2 className="section-title mb-4"><Lock className="w-4 h-4" />Seguridad</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Contraseña actual" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="••••••••" />
          <Input label="Nueva contraseña" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mín. 10 caracteres" />
        </div>
        <Button size="sm" onClick={() => void changePassword()} disabled={busy} className="mt-3"><Lock className="w-4 h-4" />Cambiar contraseña</Button>

        <div className="border-t border-border mt-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-ok" />Verificación en dos pasos</p>
              <p className="text-xs text-muted mt-0.5">{user.twoFactorEnabled ? "Activa" : "Inactiva — protege tu cuenta"}</p>
            </div>
            {!user.twoFactorEnabled ? <Button size="sm" onClick={() => { setTfPw(""); setTfPwOpen(true); }}>Activar</Button> : (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setTfCode(""); setRegenOpen(true); }}>Códigos</Button>
                <Button size="sm" variant="secondary" onClick={() => { setTfCode(""); setDisableOpen(true); }}>Desactivar</Button>
              </div>
            )}
          </div>
          <p className="text-xs text-muted mt-3 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <Link to="/vault" className="text-accent-strong hover:underline">Kontraseñas</Link> exige esta verificación en cada apertura.
          </p>
        </div>

        <div className="border-t border-border mt-4 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text flex items-center gap-2"><LockKeyhole className="w-4 h-4" />PIN rápido</p>
              <p className="text-xs text-muted mt-0.5">
                {!user.quickPinConfigured ? "Inactivo — añade un PIN para bloquear la aplicación." : user.quickPinEnabled ? "Activo — protege el arranque y la vuelta desde Ctrl+Espacio." : "Desactivado — tu PIN se conserva para volver a activarlo."}
              </p>
            </div>
            {user.quickPinConfigured ? (
              <button
                type="button"
                role="switch"
                aria-checked={user.quickPinEnabled}
                aria-label={user.quickPinEnabled ? "Desactivar PIN rápido" : "Activar PIN rápido"}
                disabled={quickPinBusy}
                onClick={() => void toggleQuickPin(!user.quickPinEnabled)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
              >
                <span aria-hidden="true" className={clsx("flex h-6 w-10 items-center rounded-full p-1 transition-colors duration-150", user.quickPinEnabled ? "bg-accent" : "bg-border")}>
                  <span className={clsx("h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150", user.quickPinEnabled && "translate-x-4")} />
                </span>
              </button>
            ) : (
              <Button size="sm" onClick={() => openQuickPin("setup")} disabled={quickPinBusy}>Configurar</Button>
            )}
          </div>
          <p className="text-xs text-muted mt-3 leading-relaxed">
            Se pedirá al iniciar la app y cada vez que la recuperes con <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">Ctrl+Espacio</kbd>. No sustituye la contraseña de tu cuenta.
          </p>
          {user.quickPinConfigured && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="secondary" onClick={() => openQuickPin("change")} disabled={quickPinBusy}>Cambiar PIN</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => openQuickPin("delete")} disabled={quickPinBusy}>Eliminar PIN</Button>
            </div>
          )}
        </div>

        <PasskeysPanel />

        <div className="border-t border-border mt-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text">Sesiones activas</p>
            <Button size="sm" variant="ghost" onClick={() => void loadSessions()}><RefreshCw className="w-4 h-4" /></Button>
          </div>
          {sessions.length === 0 ? <p className="text-xs text-muted">Pulsa el botón para ver tus sesiones.</p> : (
            <ul className="space-y-1.5">{sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-muted truncate pr-2">{s.userAgent?.slice(0, 40) ?? "Dispositivo"}{s.current && " · (esta sesión)"}</span>
                <button type="button" onClick={async () => { await http.del(`/api/auth/sessions/${s.id}`); void loadSessions(); }} className="text-faint hover:text-danger shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}</ul>
          )}
        </div>
      </section>

      <Modal open={tfPwOpen} onClose={() => { setTfPwOpen(false); setTfPw(""); }} title="Confirma tu contraseña"
        footer={<><Button variant="secondary" onClick={() => { setTfPwOpen(false); setTfPw(""); }}>Cancelar</Button><Button onClick={() => void setup2fa()}>Continuar</Button></>}>
        <div className="space-y-5">
          <p className="text-sm text-muted">Para generar la clave de 2FA confirma la contraseña de tu cuenta.</p>
          <Input label="Contraseña actual" type="password" value={tfPw} onChange={(e) => setTfPw(e.target.value)} placeholder="••••••••" />
        </div>
      </Modal>

      <Modal open={!!tfSetup} onClose={() => { setTfSetup(null); setTfCode(""); }} title="Activar 2FA"
        footer={<><Button variant="secondary" onClick={() => setTfSetup(null)}>Cancelar</Button><Button onClick={() => void enable2fa()}>Verificar y activar</Button></>}>
        <div className="space-y-5">
          <p className="text-sm text-muted">Escanea el código con tu app de autenticación (Google Authenticator, Authy…) e introduce el código de 6 dígitos. Si no puedes escanear, usa esta clave:</p>
          {tfSetup?.url && (
            <QrCode value={tfSetup.url} label="Código QR para la app de autenticación" />
          )}
          <p className="font-mono text-xs bg-surface border border-border rounded-lg p-2 select-all break-all">{tfSetup?.secret}</p>
          <Input label="Código de 6 dígitos" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
        </div>
      </Modal>

      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Desactivar 2FA"
        footer={<><Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancelar</Button><Button onClick={() => void disable2fa()}>Desactivar</Button></>}>
        <Input label="Código TOTP actual" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
      </Modal>

      <Modal open={regenOpen} onClose={() => setRegenOpen(false)} title="Nuevos códigos de recuperación"
        footer={<><Button variant="secondary" onClick={() => setRegenOpen(false)}>Cancelar</Button><Button onClick={() => void regenCodes()}>Generar</Button></>}>
        <div className="space-y-5">
          <p className="text-sm text-muted">Los códigos viejos dejarán de servir. Confirma con tu app de autenticación.</p>
          <Input label="Código TOTP" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
        </div>
      </Modal>

      <Modal open={!!codes} onClose={() => setCodes(null)} title="Guarda estos códigos"
        footer={<Button onClick={() => setCodes(null)}>Ya los guardé</Button>}>
        <div className="space-y-5">
          <p className="text-sm text-muted">Cada uno vale una vez si no tienes el teléfono. No se vuelven a mostrar.</p>
          <ul className="font-mono text-sm grid grid-cols-2 gap-2">{codes?.map((c) => <li key={c} className="bg-surface border border-border rounded-lg px-2 py-1.5 select-all">{c}</li>)}</ul>
        </div>
      </Modal>

      <Modal
        open={!!quickPinMode}
        onClose={closeQuickPin}
        title={quickPinMode === "setup" ? "Configurar PIN rápido" : quickPinMode === "change" ? "Cambiar PIN rápido" : quickPinMode === "disable" ? "Desactivar PIN rápido" : "Eliminar PIN rápido"}
        description={quickPinMode === "delete" ? "El PIN dejará de estar configurado en tu cuenta." : "Usa 4 dígitos. Puedes pegar el PIN si lo tienes guardado."}
        size="sm"
        footer={<><Button variant="secondary" onClick={closeQuickPin}>Cancelar</Button><Button type="submit" form="quick-pin-form" variant={quickPinMode === "delete" ? "danger" : "primary"} disabled={quickPinBusy}>{quickPinBusy ? <Spinner /> : quickPinMode === "setup" ? "Configurar" : quickPinMode === "change" ? "Cambiar" : quickPinMode === "disable" ? "Desactivar" : "Eliminar"}</Button></>}
      >
        <form id="quick-pin-form" onSubmit={(event) => void saveQuickPin(event)} className="space-y-4">
          {quickPinMode && quickPinMode !== "setup" && (
            <Input
              label="PIN actual"
              type="password"
              value={quickPinCurrent}
              onChange={(event) => { setQuickPinCurrent(pinDigits(event.target.value)); setQuickPinCurrentError(""); }}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="current-password"
              placeholder="••••"
              error={quickPinCurrentError}
              autoFocus
            />
          )}
          {quickPinMode && (quickPinMode === "setup" || quickPinMode === "change") && (
            <>
              <Input
                label={quickPinMode === "setup" ? "Nuevo PIN" : "PIN nuevo"}
                type="password"
                value={quickPin}
                onChange={(event) => { setQuickPin(pinDigits(event.target.value)); setQuickPinError(""); }}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                autoComplete="new-password"
                placeholder="••••"
                error={quickPinError}
                autoFocus={quickPinMode === "setup"}
              />
              <Input
                label="Repite el PIN"
                type="password"
                value={quickPinConfirmation}
                onChange={(event) => { setQuickPinConfirmation(pinDigits(event.target.value)); setQuickPinConfirmationError(""); }}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                autoComplete="new-password"
                placeholder="••••"
                error={quickPinConfirmationError}
              />
            </>
          )}
        </form>
      </Modal>
    </>
  );
}

export function AccountData() {
  const { push } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [expTasks, setExpTasks] = useState(true);
  const [expEvents, setExpEvents] = useState(true);
  const [expNotes, setExpNotes] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const selectedTypes = () => {
    const types = [
      expTasks ? "tasks" : null,
      expEvents ? "events" : null,
      expNotes ? "notes" : null,
    ].filter(Boolean).join(",");
    return types || "tasks,events,notes";
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportData = async (format: "json" | "csv" | "ics") => {
    setBusy(true);
    try {
      if (import.meta.env.VITE_APP_DEMO === "1") {
        const bundle = await http.get<unknown>("/api/transfer/export", { format: "json", types: selectedTypes() });
        downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), "kalendiario-export.json");
        push("success", format === "json" ? "Exportado como JSON" : "En la demo solo se exporta JSON (sin servidor).");
        return;
      }
      const qs = new URLSearchParams({ format, types: selectedTypes() });
      const res = await fetch(`/api/transfer/export?${qs}`, { credentials: "include" });
      if (!res.ok) {
        let message = "No se pudo exportar.";
        try {
          const body = await res.json();
          message = body?.error?.message ?? message;
        } catch { /* ignore */ }
        throw new Error(message);
      }
      const blob = format === "json"
        ? new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" })
        : await res.blob();
      downloadBlob(blob, `kalendiario-export.${format}`);
      push("success", `Exportado como ${format.toUpperCase()}`);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo exportar.");
    } finally { setBusy(false); }
  };

  const importFile = async () => {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const text = await pendingFile.text();
      const r = await http.post<{ created: { tasks: number; events: number; notes: number } }>("/api/transfer/import", { format: "auto", text });
      await qc.invalidateQueries();
      setPendingFile(null);
      push("success", `Importado: ${r.created.tasks} tareas, ${r.created.events} eventos, ${r.created.notes} notas`);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo importar.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <section className="card p-5">
        <h2 className="section-title mb-4"><Database className="w-4 h-4" />Datos</h2>
        <CalendarFeedPanel />
        <p className="text-sm text-muted mb-4">Exporta una copia de tus tareas, eventos y notas, o importa un archivo JSON, CSV o ICS (calendario). Lo importado se añade a tu cuenta; no se borra lo que ya tienes. El Cofre no se exporta: el servidor no tiene esas claves en claro.</p>
        <div className="flex flex-wrap gap-4 mb-4">
          <Checkbox label="Tareas" checked={expTasks} onChange={setExpTasks} />
          <Checkbox label="Eventos" checked={expEvents} onChange={setExpEvents} />
          <Checkbox label="Notas" checked={expNotes} onChange={setExpNotes} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["json", "csv", "ics"] as const).map((fmt) => (
            <Button key={fmt} size="sm" variant="secondary" disabled={busy} onClick={() => void exportData(fmt)} className="min-h-11">
              <Download className="w-4 h-4" />{fmt.toUpperCase()}
            </Button>
          ))}
          <label className="btn-secondary btn-sm cursor-pointer">
            <Upload className="w-4 h-4" />Importar archivo
            <input type="file" accept=".json,.csv,.ics,.txt,text/calendar,text/csv,application/json" className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (f) setPendingFile(f);
            }} />
          </label>
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingFile}
        onClose={() => setPendingFile(null)}
        title="Importar datos"
        confirmLabel="Importar"
        danger={false}
        busy={busy}
        onConfirm={importFile}
        message={pendingFile ? `Se añadirán los elementos de «${pendingFile.name}» a tu cuenta. Nada existente se sobrescribe.` : ""}
      />
    </>
  );
}

function CalendarFeedPanel() {
  const { push } = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const d = await http.get<{ url: string }>("/api/calendar/feed-url");
      setUrl(d.url);
    } catch { /* ignore */ }
  };
  useEffect(() => { void load(); }, []);
  return (
    <div className="rounded-xl border border-border/70 p-4 mb-5">
      <p className="text-sm font-medium text-text flex items-center gap-2"><Link2 className="w-4 h-4" />Calendario en suscripción (ICS)</p>
      <p className="text-xs text-muted mt-1 mb-3">Enlace de solo lectura para Google Calendar, Apple o Outlook. Quien lo tenga verá tus eventos y tareas pendientes de los próximos 90 días.</p>
      <Input readOnly value={url} placeholder="Generando…" className="font-mono text-xs" />
      <div className="flex flex-wrap gap-2 mt-3">
        <Button size="sm" variant="secondary" disabled={!url} onClick={async () => {
          try { await navigator.clipboard.writeText(url); push("success", "Enlace copiado"); }
          catch { push("error", "No se pudo copiar."); }
        }}><Copy className="w-4 h-4" />Copiar</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const d = await http.post<{ url: string }>("/api/calendar/feed-url");
            setUrl(d.url);
            push("success", "Enlace renovado. El anterior deja de funcionar.");
          } catch (e: unknown) {
            push("error", e instanceof Error ? e.message : "No se pudo renovar.");
          } finally { setBusy(false); }
        }}><RefreshCw className="w-4 h-4" />Renovar enlace</Button>
      </div>
    </div>
  );
}

function PasskeysPanel() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["passkeys"], queryFn: () => http.get<{ passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[] }>("/api/auth/passkeys") });
  const passkeys = data?.passkeys ?? [];
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const opts = await http.post<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"]; challengeId: string }>("/api/auth/passkeys/register/options");
      const response = await startRegistration({ optionsJSON: opts.options });
      await http.post("/api/auth/passkeys/register", { challengeId: opts.challengeId, response, name: "Este dispositivo" });
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
      push("success", "Passkey añadida");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "No se pudo registrar la passkey.";
      if (/not allowed|abort/i.test(msg)) push("info", "Registro cancelado.");
      else push("error", msg);
    } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-border mt-4 pt-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-medium text-text flex items-center gap-2"><Fingerprint className="w-4 h-4" />Passkeys</p>
          <p className="text-xs text-muted mt-0.5">Entra con huella, Face ID o la llave de tu dispositivo. No es el Cofre.</p>
        </div>
        <Button size="sm" onClick={() => void add()} disabled={busy}>{busy ? <Spinner /> : "Añadir"}</Button>
      </div>
      {passkeys.length === 0 ? <p className="text-xs text-muted">Ninguna passkey todavía.</p> : (
        <ul className="space-y-1.5">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs gap-2">
              <span className="text-muted truncate">{p.name}</span>
              <button type="button" className="text-faint hover:text-danger shrink-0" aria-label="Quitar passkey" onClick={async () => {
                try {
                  await http.del(`/api/auth/passkeys/${p.id}`);
                  await qc.invalidateQueries({ queryKey: ["passkeys"] });
                  push("success", "Passkey eliminada");
                } catch (e: unknown) {
                  push("error", e instanceof Error ? e.message : "No se pudo quitar.");
                }
              }}><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
