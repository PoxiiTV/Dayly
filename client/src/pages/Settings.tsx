import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Sun, Monitor, Smartphone, Lock, ShieldCheck, Trash2, RefreshCw, Download, Upload, Database, Square, RectangleHorizontal, Maximize2 } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme, useThemeWave, useSkinWave } from "@/lib/theme";
import { useContentWidth } from "@/lib/contentWidth";
import { Button, Input, Select, Spinner, useToast, Modal, Checkbox, ConfirmDialog, PageHeader, Section, Toggle } from "@/components/ui";
import { enableWebPush } from "@/lib/AlertEngine";
import type { Theme } from "@/lib/types";
import { SKINS, type SkinId } from "@/lib/skins";
import { QrCode } from "@/components/QrCode";
import { MascotSettings } from "@/components/MascotSettings";
import { BriefingSettings } from "@/components/BriefingSettings";

export function Settings() {
  const { user, applyTheme, applySkin } = useAuth();
  const { theme, skin, resolved } = useTheme();
  const themeWave = useThemeWave();
  const skinWave = useSkinWave();
  const { width: contentWidth, setWidth: setContentWidth } = useContentWidth();
  const { push } = useToast();
  const qc = useQueryClient();

  const [tz, setTz] = useState(user?.timezone ?? "Europe/Madrid");
  const [lang, setLang] = useState(user?.language ?? "es");
  const [fow, setFow] = useState(user?.firstDayOfWeek ?? 1);
  const [fmt24, setFmt24] = useState(user?.timeFormat24 ?? true);
  const [notifR, setNotifR] = useState(true);
  const [notifE, setNotifE] = useState(true);
  const [notifT, setNotifT] = useState(true);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; current?: boolean; userAgent?: string; lastUsedAt: string }[]>([]);
  const [tfSetup, setTfSetup] = useState<{ secret: string; url: string } | null>(null);
  const [tfCode, setTfCode] = useState("");
  const [tfPwOpen, setTfPwOpen] = useState(false);
  const [tfPw, setTfPw] = useState("");
  const [expTasks, setExpTasks] = useState(true);
  const [expEvents, setExpEvents] = useState(true);
  const [expNotes, setExpNotes] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const savePrefs = async () => {
    setBusy(true);
    try {
      await http.patch("/api/users/me/preferences", { timezone: tz, language: lang, firstDayOfWeek: fow, timeFormat24: fmt24, notifyReminders: notifR, notifyEvents: notifE, notifyTasks: notifT });
      qc.invalidateQueries(); push("success", "Preferencias guardadas");
    } catch (e: any) { push("error", e.message); } finally { setBusy(false); }
  };

  const changeTheme = (t: Theme, e?: React.SyntheticEvent) => {
    themeWave(t, e);
    void applyTheme(t);
  };

  const changeSkin = (s: SkinId, e?: React.SyntheticEvent) => {
    skinWave(s, e);
    void applySkin(s);
  };

  const changePassword = async () => {
    setBusy(true);
    try { await http.post("/api/auth/change-password", { currentPassword: oldPw, newPassword: newPw }); push("success", "Contraseña cambiada"); setOldPw(""); setNewPw(""); } catch (e: any) { push("error", e.message); } finally { setBusy(false); }
  };

  const loadSessions = async () => { const d = await http.get<{ sessions: typeof sessions }>("/api/auth/sessions"); setSessions(d.sessions); };
  const begin2fa = () => { setTfPw(""); setTfPwOpen(true); };
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
  const enable2fa = async () => { try { const d = await http.post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code: tfCode }); setCodes(d.recoveryCodes); setTfSetup(null); setTfCode(""); qc.invalidateQueries(); } catch (e: any) { push("error", e.message); } };
  const disable2fa = async () => { try { await http.post("/api/auth/2fa/disable", { code: tfCode }); push("success", "2FA desactivada"); setTfCode(""); setDisableOpen(false); qc.invalidateQueries(); } catch (e: any) { push("error", e.message); } };
  const regenCodes = async () => { try { const d = await http.post<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery-codes", { code: tfCode }); setCodes(d.recoveryCodes); setRegenOpen(false); setTfCode(""); push("success", "Códigos nuevos. Los anteriores ya no valen."); } catch (e: any) { push("error", e.message); } };

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
        downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), "dayly-export.json");
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
      downloadBlob(blob, `dayly-export.${format}`);
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

  if (!user) return null;

  return (
    <div className="page-shell">
      <PageHeader title="Ajustes" />
      <div className="space-y-6">
      <Section icon={<Monitor className="w-4 h-4" />} title="Apariencia">
        <div className="flex gap-2">
          {([["LIGHT", "Claro", Sun], ["DARK", "Oscuro", Moon], ["SYSTEM", "Sistema", Smartphone]] as const).map(([v, l, Icon]) => (
            <button key={v} type="button" onClick={(e) => changeTheme(v, e)} className={clsx("flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border transition-all", theme === v ? "bg-accent-soft border-accent text-accent-strong" : "border-border text-muted hover:bg-surface")}>
              <Icon className="w-5 h-5" /><span className="text-xs font-medium">{l}</span>
            </button>
          ))}
        </div>
        <p className="text-xs font-medium text-muted mt-5 mb-2">Color</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SKINS.map((item) => {
            const on = skin === item.id;
            const preview = item.preview[resolved];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={(e) => changeSkin(item.id, e)}
                className={clsx(
                  "text-left rounded-xl border p-2 transition-all",
                  on ? "border-accent bg-accent-soft/60" : "border-border hover:bg-surface",
                )}
              >
                <span
                  className="block h-12 rounded-lg p-1.5 mb-2"
                  style={{ background: preview.bg }}
                >
                  <span
                    className="flex h-full items-center gap-1.5 rounded-md px-2"
                    style={{ background: preview.surface, boxShadow: `inset 0 0 0 1px ${preview.border}` }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: preview.accent }} />
                    <span className="h-1 flex-1 rounded-full opacity-70" style={{ background: preview.accent }} />
                  </span>
                </span>
                <span className="block text-xs font-medium text-text leading-tight">{item.name}</span>
                <span className="block text-[11px] text-faint">{item.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs font-medium text-muted mt-5 mb-2">Ancho del panel</p>
        <div className="flex gap-2">
          {([["normal", "Estrecho", Square], ["wide", "Normal", RectangleHorizontal], ["full", "Ancho", Maximize2]] as const).map(([v, l, Icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => setContentWidth(v)}
              className={clsx("flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border transition-all", contentWidth === v ? "bg-accent-soft border-accent text-accent-strong" : "border-border text-muted hover:bg-surface")}
            >
              <Icon className="w-5 h-5" /><span className="text-xs font-medium">{l}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Smartphone className="w-4 h-4" />} title="General">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Zona horaria" value={tz} onChange={(e) => setTz(e.target.value)}>
            {["Europe/Madrid", "Europe/London", "America/New_York", "America/Mexico_City", "UTC"].map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
          <Select label="Idioma" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es">Español</option><option value="en">English</option>
          </Select>
          <Select label="Primer día de la semana" value={fow} onChange={(e) => setFow(Number(e.target.value))}>
            <option value={1}>Lunes</option><option value={0}>Domingo</option>
          </Select>
          <Select label="Formato de hora" value={fmt24 ? "24" : "12"} onChange={(e) => setFmt24(e.target.value === "24")}>
            <option value="24">24 horas</option><option value="12">12 horas</option>
          </Select>
        </div>
        <div className="mt-4 rounded-xl border border-border/70 divide-y divide-border/70 overflow-hidden">
          <Toggle label="Recordatorios" on={notifR} set={setNotifR} />
          <Toggle label="Avisos de eventos" on={notifE} set={setNotifE} />
          <Toggle label="Tareas de hoy" on={notifT} set={setNotifT} />
        </div>
        <Button size="sm" onClick={savePrefs} disabled={busy} className="mt-4">{busy ? <Spinner /> : "Guardar preferencias"}</Button>
        <Button size="sm" variant="secondary" className="mt-3 ml-2" onClick={async () => {
          try {
            const ok = await enableWebPush();
            push(ok ? "success" : "info", ok ? "Avisos del navegador activados, también con la pestaña cerrada si el sistema lo permite." : "No hay claves push en el servidor o el navegador no lo admite.");
          } catch (e: any) { push("error", e.message ?? "No se pudo activar el push."); }
        }}>Activar avisos push</Button>
      </Section>

      <MascotSettings />

      <BriefingSettings />

      <Section icon={<Lock className="w-4 h-4" />} title="Seguridad">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Contraseña actual" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="••••••••" />
          <Input label="Nueva contraseña" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mín. 10 caracteres" />
        </div>
        <Button size="sm" onClick={changePassword} disabled={busy} className="mt-3"><Lock className="w-4 h-4" />Cambiar contraseña</Button>

        <div className="border-t border-border mt-4 pt-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-text flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-ok" />Verificación en dos pasos</p>
              <p className="text-xs text-muted mt-0.5">{user.twoFactorEnabled ? "Activa" : "Inactiva — protege tu cuenta"}</p></div>
            {!user.twoFactorEnabled ? <Button size="sm" onClick={begin2fa}>Activar</Button> :
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setTfCode(""); setRegenOpen(true); }}>Códigos</Button>
                <Button size="sm" variant="secondary" onClick={() => { setTfCode(""); setDisableOpen(true); }}>Desactivar</Button>
              </div>}
          </div>
        </div>

        <div className="border-t border-border mt-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text">Sesiones activas</p>
            <Button size="sm" variant="ghost" onClick={loadSessions}><RefreshCw className="w-4 h-4" /></Button>
          </div>
          {sessions.length === 0 ? <p className="text-xs text-muted">Pulsa el botón para ver tus sesiones.</p> : (
            <ul className="space-y-1.5">{sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-muted truncate pr-2">{s.userAgent?.slice(0, 40) ?? "Dispositivo"}{s.current && " · (esta sesión)"}</span>
                <button onClick={async () => { await http.del(`/api/auth/sessions/${s.id}`); loadSessions(); }} className="text-faint hover:text-danger shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}</ul>
          )}
        </div>
      </Section>

      <Section icon={<Database className="w-4 h-4" />} title="Datos">
        <p className="text-sm text-muted mb-4">Exporta una copia de tus tareas, eventos y notas, o importa un archivo JSON, CSV o ICS (calendario). Lo importado se añade a tu cuenta; no se borra lo que ya tienes.</p>
        <div className="flex flex-wrap gap-4 mb-4">
          <Checkbox label="Tareas" checked={expTasks} onChange={setExpTasks} />
          <Checkbox label="Eventos" checked={expEvents} onChange={setExpEvents} />
          <Checkbox label="Notas" checked={expNotes} onChange={setExpNotes} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["json", "csv", "ics"] as const).map((fmt) => (
            <Button key={fmt} size="sm" variant="secondary" disabled={busy} onClick={() => exportData(fmt)} className="min-h-11">
              <Download className="w-4 h-4" />{fmt.toUpperCase()}
            </Button>
          ))}
          <label className="btn-secondary !h-8 !px-3 !text-xs inline-flex items-center gap-2 cursor-pointer min-h-11">
            <Upload className="w-4 h-4" />Importar archivo
            <input type="file" accept=".json,.csv,.ics,.txt,text/calendar,text/csv,application/json" className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (f) setPendingFile(f);
            }} />
          </label>
        </div>
      </Section>

      <Modal open={tfPwOpen} onClose={() => { setTfPwOpen(false); setTfPw(""); }} title="Confirma tu contraseña"
        footer={<><Button variant="secondary" onClick={() => { setTfPwOpen(false); setTfPw(""); }}>Cancelar</Button><Button onClick={() => void setup2fa()}>Continuar</Button></>}>
        <p className="text-sm text-muted">Para generar la clave de 2FA confirma la contraseña de tu cuenta.</p>
        <Input label="Contraseña actual" type="password" value={tfPw} onChange={(e) => setTfPw(e.target.value)} placeholder="••••••••" />
      </Modal>

      <Modal open={!!tfSetup} onClose={() => { setTfSetup(null); setTfCode(""); }} title="Activar 2FA"
        footer={<><Button variant="secondary" onClick={() => setTfSetup(null)}>Cancelar</Button><Button onClick={enable2fa}>Verificar y activar</Button></>}>
        <p className="text-sm text-muted">Escanea el código con tu app de autenticación (Google Authenticator, Authy…) e introduce el código de 6 dígitos. Si no puedes escanear, usa esta clave:</p>
        {tfSetup?.url && (
          <QrCode value={tfSetup.url} label="Código QR para la app de autenticación" />
        )}
        <p className="font-mono text-xs bg-surface border border-border rounded-lg p-2 select-all break-all">{tfSetup?.secret}</p>
        <Input label="Código de 6 dígitos" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
      </Modal>

      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Desactivar 2FA"
        footer={<><Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancelar</Button><Button onClick={disable2fa}>Desactivar</Button></>}>
        <Input label="Código TOTP actual" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
      </Modal>

      <Modal open={regenOpen} onClose={() => setRegenOpen(false)} title="Nuevos códigos de recuperación"
        footer={<><Button variant="secondary" onClick={() => setRegenOpen(false)}>Cancelar</Button><Button onClick={regenCodes}>Generar</Button></>}>
        <p className="text-sm text-muted">Los códigos viejos dejarán de servir. Confirma con tu app de autenticación.</p>
        <Input label="Código TOTP" value={tfCode} onChange={(e) => setTfCode(e.target.value)} maxLength={6} placeholder="123456" />
      </Modal>

      <Modal open={!!codes} onClose={() => setCodes(null)} title="Guarda estos códigos"
        footer={<Button onClick={() => setCodes(null)}>Ya los guardé</Button>}>
        <p className="text-sm text-muted">Cada uno vale una vez si no tienes el teléfono. No se vuelven a mostrar.</p>
        <ul className="font-mono text-sm grid grid-cols-2 gap-2">{codes?.map((c) => <li key={c} className="bg-surface border border-border rounded-lg px-2 py-1.5 select-all">{c}</li>)}</ul>
      </Modal>

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
      </div>
    </div>
  );
}