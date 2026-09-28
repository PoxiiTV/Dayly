import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Mail, RefreshCw, Trash2, Send, ArrowLeft, Settings2, ListTodo, CalendarDays, Star } from "lucide-react";
import clsx from "clsx";
import { http, ApiError } from "@/lib/api";
import type { Mailbox, MailMessage, MailMessageListItem } from "@/lib/types";
import { MAILBOX_PRESETS, mailboxPresetById, mailboxPresetIdForHosts } from "@/lib/mailboxPresets";
import { Button, ComingSoonBadge, Input, Select, SelectControl, Textarea, EmptyState, Spinner, useToast, ConfirmDialog, Modal } from "@/components/ui";
import { integrationShown, useIntegration, type IntegrationState } from "@/lib/integrations";
import { fmtDate, fmtTime } from "@/lib/dates";

const GOOGLE_NOT_CONFIGURED = "Falta registrar Dayly en Google (una sola vez, como el resto de webs). Luego conectar es pulsar el botón y confirmar en el móvil.";

function startGmailGoogle(enabled: boolean, onMissing: () => void) {
  if (!enabled) {
    onMissing();
    return;
  }
  window.location.assign("/api/inbox/mailboxes/google/start");
}

export function InboxMail({ initialMailboxId = null, initialUid = null }: { initialMailboxId?: string | null; initialUid?: number | null } = {}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(initialMailboxId);
  const [uid, setUid] = useState<number | null>(initialUid);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [defaultBusy, setDefaultBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["inbox-mailboxes"],
    queryFn: () => http.get<{ mailboxes: Mailbox[] }>("/api/inbox/mailboxes"),
  });
  const googleState = useIntegration("gmailGoogle");
  const googleEnabled = googleState === "AVAILABLE";
  const mailboxes = data?.mailboxes ?? [];
  const mailbox = mailboxes.find((m) => m.id === selectedId) ?? mailboxes.find((m) => m.isDefault) ?? mailboxes[0] ?? null;

  useEffect(() => {
    if (!mailboxes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !mailboxes.some((m) => m.id === selectedId)) {
      setSelectedId((mailboxes.find((m) => m.isDefault) ?? mailboxes[0]).id);
    }
  }, [mailboxes, selectedId]);

  useEffect(() => {
    if (initialMailboxId) setSelectedId(initialMailboxId);
    if (initialUid != null) setUid(initialUid);
  }, [initialMailboxId, initialUid]);

  useEffect(() => {
    setUid(mailbox?.id === initialMailboxId ? initialUid : null);
  }, [initialMailboxId, initialUid, mailbox?.id]);

  const { data: listData, isFetching: loadingList, refetch: refetchList, isError: listError, error: listErr } = useQuery({
    queryKey: ["inbox-mail", mailbox?.id],
    queryFn: () => http.get<{ messages: MailMessageListItem[] }>(`/api/inbox/mailboxes/${mailbox!.id}/messages`),
    enabled: Boolean(mailbox?.id),
    staleTime: 30_000,
  });
  const messages = listData?.messages ?? [];
  const listDebug = formatImapDebug(listErr);

  const makeDefault = async () => {
    if (!mailbox || mailbox.isDefault) return;
    setDefaultBusy(true);
    try {
      await http.post(`/api/inbox/mailboxes/${mailbox.id}/default`);
      await qc.invalidateQueries({ queryKey: ["inbox-mailboxes"] });
      push("success", "Buzón predeterminado actualizado");
    } catch (error: unknown) {
      push("error", error instanceof Error ? error.message : "No se pudo cambiar el buzón predeterminado.");
    } finally { setDefaultBusy(false); }
  };

  if (isLoading) return <div className="grid place-items-center h-40 text-accent"><Spinner /></div>;

  if (mailboxes.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Mail className="w-6 h-6" />}
          title="Ningún buzón conectado"
          hint={googleEnabled
            ? "Puedes leer Gmail con Google (sin contraseña de aplicación) u otros buzones por IMAP. Las contraseñas se guardan cifradas."
            : "Conecta cualquier buzón por IMAP con su contraseña de aplicación. Las contraseñas se guardan cifradas."}
          action={
            <span className="inline-flex flex-wrap items-center justify-center gap-2">
              {integrationShown(googleState) && (
                <Button size="sm" disabled={!googleEnabled} onClick={() => startGmailGoogle(googleEnabled, () => push("error", GOOGLE_NOT_CONFIGURED))}>
                  Conectar con Google{googleState === "COMING_SOON" && <ComingSoonBadge />}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setEditorOpen(true); }}>
                <Plus className="w-4 h-4" />Otro buzón
              </Button>
            </span>
          }
        />
        <MailboxEditor open={editorOpen} mailbox={editing} googleState={googleState} onClose={() => setEditorOpen(false)} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectControl
          className="min-w-[14rem] max-w-full"
          value={mailbox?.id ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Buzón"
        >
          {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.label}{m.isDefault ? " · avisos" : ""}</option>)}
        </SelectControl>
        <Button variant="secondary" size="sm" onClick={() => void refetchList()} disabled={loadingList}>
          <RefreshCw className={clsx("w-4 h-4", loadingList && "animate-spin")} />Actualizar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setEditing(mailbox); setEditorOpen(true); }} disabled={!mailbox}>
          <Settings2 className="w-4 h-4" />Editar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void makeDefault()} disabled={!mailbox || mailbox.isDefault || defaultBusy} title="Usar este buzón para los avisos por correo">
          <Star className={clsx("w-4 h-4", mailbox?.isDefault && "fill-current text-accent")} />{mailbox?.isDefault ? "Buzón de avisos" : "Usar para avisos"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => mailbox && setConfirmId(mailbox.id)} disabled={!mailbox}>
          <Trash2 className="w-4 h-4" />Quitar
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }}>
          <Plus className="w-4 h-4" />Añadir buzón
        </Button>
      </div>

      {(mailbox?.lastError || listError) && (
        <div className="space-y-1">
          <p className="text-sm text-danger">{mailbox?.lastError || (listErr instanceof Error ? listErr.message : "No se pudo leer el buzón.")}</p>
          {listDebug && <p className="text-xs text-muted font-mono break-all">{listDebug}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[28rem]">
        <section className={clsx("lg:col-span-2 card overflow-hidden", uid != null && "hidden lg:block")}>
          {loadingList && !listData ? (
            <div className="grid place-items-center h-40 text-accent"><Spinner /></div>
          ) : messages.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted text-center">Este buzón no tiene mensajes recientes.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {messages.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => setUid(m.uid)}
                    className={clsx(
                      "w-full text-left px-4 py-3 hover:bg-surface transition-colors",
                      uid === m.uid && "bg-accent-soft/40",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={clsx("text-sm truncate", m.seen ? "text-muted" : "text-text font-medium")}>{m.from}</p>
                      <span className="text-[11px] text-faint shrink-0 tabular-nums">{shortDate(m.date)}</span>
                    </div>
                    <p className={clsx("text-sm truncate mt-0.5", m.seen ? "text-muted" : "text-text")}>{m.subject}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={clsx("lg:col-span-3 card p-5", uid == null && "hidden lg:block")}>
          {uid == null ? (
            <p className="text-sm text-muted h-full grid place-items-center">Elige un mensaje para leerlo y responder.</p>
          ) : mailbox ? (
            <MailReader mailboxId={mailbox.id} uid={uid} onBack={() => setUid(null)} />
          ) : null}
        </section>
      </div>

      <MailboxEditor open={editorOpen} mailbox={editing} googleState={googleState} onClose={() => setEditorOpen(false)} />
      <ConfirmDialog
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="Quitar buzón"
        message="Se olvidará la conexión. Los correos siguen en tu proveedor; aquí solo se deja de leerlos."
        confirmLabel="Quitar"
        onConfirm={async () => {
          if (!confirmId) return;
          try {
            await http.del(`/api/inbox/mailboxes/${confirmId}`);
            qc.invalidateQueries({ queryKey: ["inbox-mailboxes"] });
            qc.removeQueries({ queryKey: ["inbox-mail", confirmId] });
            push("success", "Buzón desconectado");
          } catch (e: unknown) {
            push("error", e instanceof Error ? e.message : "No se pudo quitar.");
          }
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function MailReader({ mailboxId, uid, onBack }: { mailboxId: string; uid: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState<"task" | "event" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["inbox-mail", mailboxId, uid],
    queryFn: () => http.get<{ message: MailMessage }>(`/api/inbox/mailboxes/${mailboxId}/messages/${uid}`),
  });
  const message = data?.message;

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await http.post(`/api/inbox/mailboxes/${mailboxId}/messages/${uid}/reply`, { text: reply.trim() });
      setReply("");
      push("success", "Respuesta enviada");
      void qc.invalidateQueries({ queryKey: ["inbox-mail", mailboxId] });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo enviar.");
    } finally {
      setBusy(false);
    }
  };

  const convert = async (kind: "task" | "event") => {
    if (!message) return;
    setConverting(kind);
    try {
      const title = (message.subject || "Correo").slice(0, 300);
      const description = [`De: ${message.from}`, message.text].filter(Boolean).join("\n\n").slice(0, 5000);
      if (kind === "task") {
        await http.post("/api/tasks", { title, description, hasTime: false });
        push("success", "Tarea creada desde el correo");
      } else {
        const start = new Date();
        start.setMinutes(0, 0, 0);
        start.setHours(start.getHours() + 1);
        await http.post("/api/events", { title, description, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString(), allDay: false });
        push("success", "Evento creado desde el correo");
      }
      void qc.invalidateQueries();
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo convertir.");
    } finally {
      setConverting(null);
    }
  };

  if (isLoading) return <div className="grid place-items-center h-40 text-accent"><Spinner /></div>;
  if (!message) return <p className="text-sm text-muted">No se pudo abrir el mensaje.</p>;

  return (
    <div className="flex flex-col gap-4 min-h-0 h-full">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="sm" className="lg:hidden -ml-2" onClick={onBack}><ArrowLeft className="w-4 h-4" />Lista</Button>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-text leading-snug">{message.subject}</h3>
          <p className="text-sm text-muted mt-1">{message.from}</p>
          <p className="text-xs text-faint mt-0.5">{fmtDate(new Date(message.date), { weekday: "short", day: "numeric", month: "short" })} · {fmtTime(message.date)}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="secondary" disabled={!!converting} onClick={() => void convert("task")}>
              <ListTodo className="w-4 h-4" />{converting === "task" ? <Spinner /> : "Crear tarea"}
            </Button>
            <Button size="sm" variant="secondary" disabled={!!converting} onClick={() => void convert("event")}>
              <CalendarDays className="w-4 h-4" />{converting === "event" ? <Spinner /> : "Crear evento"}
            </Button>
          </div>
        </div>
      </div>
      <pre className="flex-1 min-h-[10rem] whitespace-pre-wrap break-words text-sm text-text font-sans leading-relaxed border-t border-border/70 pt-4">{message.text || "(sin texto)"}</pre>
      <div className="border-t border-border/70 pt-3 space-y-2">
        <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escribe una respuesta…" />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void send()} disabled={busy || !reply.trim()}><Send className="w-4 h-4" />{busy ? <Spinner /> : "Responder"}</Button>
        </div>
      </div>
    </div>
  );
}

function MailboxEditor({ open, mailbox, googleState, onClose }: { open: boolean; mailbox: Mailbox | null; googleState: IntegrationState | undefined; onClose: () => void }) {
  const googleEnabled = googleState === "AVAILABLE";
  const qc = useQueryClient();
  const { push } = useToast();
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [manualCustom, setManualCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testDetail, setTestDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(mailbox?.label ?? "");
    setEmail(mailbox?.email ?? "");
    setImapHost(mailbox?.imapHost ?? MAILBOX_PRESETS[0].imapHost);
    setImapPort(String(mailbox?.imapPort ?? MAILBOX_PRESETS[0].imapPort));
    setSmtpHost(mailbox?.smtpHost ?? MAILBOX_PRESETS[0].smtpHost);
    setSmtpPort(String(mailbox?.smtpPort ?? MAILBOX_PRESETS[0].smtpPort));
    setUsername(mailbox?.username ?? "");
    setPassword("");
    setManualCustom(false);
    setTestDetail(null);
  }, [open, mailbox]);

  const applyPreset = (id: string) => {
    if (id === "custom") { setManualCustom(true); return; }
    const preset = mailboxPresetById(id);
    if (!preset) return;
    setManualCustom(false);
    setImapHost(preset.imapHost);
    setImapPort(String(preset.imapPort));
    setSmtpHost(preset.smtpHost);
    setSmtpPort(String(preset.smtpPort));
  };

  const presetId = manualCustom ? "custom" : mailboxPresetIdForHosts(imapHost, smtpHost);
  const presetHint = presetId === "gmail" && !googleEnabled
    ? "Usa una contraseña de aplicación: Cuenta de Google → Seguridad → Contraseñas de aplicación."
    : mailboxPresetById(presetId)?.hint;
  const isGoogle = mailbox?.authType === "google";
  const showGoogle = (presetId === "gmail" && integrationShown(googleState)) || isGoogle;
  // The server refuses to move a Google token to other hosts or accounts.
  const lockedToGoogle = isGoogle && !password;

  const connectGoogle = () => {
    startGmailGoogle(googleEnabled, () => push("error", GOOGLE_NOT_CONFIGURED));
  };

  const formPayload = (includePassword: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      label: label.trim() || undefined,
      email: email.trim(),
      imapHost: imapHost.trim(),
      imapPort: Number(imapPort),
      imapSecure: Number(imapPort) === 993,
      smtpHost: smtpHost.trim(),
      smtpPort: Number(smtpPort),
      smtpSecure: Number(smtpPort) === 465,
      username: username.trim() || email.trim(),
    };
    if (includePassword && password) payload.password = password;
    return payload;
  };

  const save = async () => {
    setBusy(true);
    setTestDetail(null);
    try {
      const payload = formPayload(true);
      if (mailbox) {
        await http.patch(`/api/inbox/mailboxes/${mailbox.id}`, payload);
        push("success", "Buzón actualizado");
      } else {
        if (!password) { push("error", "Indica la contraseña del buzón o conéctalo con Google."); setBusy(false); return; }
        await http.post("/api/inbox/mailboxes", payload);
        push("success", "Buzón conectado");
      }
      await qc.invalidateQueries({ queryKey: ["inbox-mailboxes"] });
      onClose();
    } catch (e: unknown) {
      setTestDetail(formatImapDebug(e));
      push("error", e instanceof Error ? e.message : "No se pudo guardar el buzón.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!mailbox) { push("info", "Guarda el buzón para probar la conexión."); return; }
    setBusy(true);
    setTestDetail(null);
    try {
      await http.patch(`/api/inbox/mailboxes/${mailbox.id}`, formPayload(Boolean(password)));
      await http.post(`/api/inbox/mailboxes/${mailbox.id}/test`);
      await qc.invalidateQueries({ queryKey: ["inbox-mailboxes"] });
      push("success", "Conexión correcta");
    } catch (e: unknown) {
      await qc.invalidateQueries({ queryKey: ["inbox-mailboxes"] });
      const debug = formatImapDebug(e);
      setTestDetail(debug);
      push("error", e instanceof Error ? e.message : "No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mailbox ? "Editar buzón" : "Conectar buzón"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {mailbox && <Button variant="secondary" onClick={() => void test()} disabled={busy}>Probar</Button>}
          <Button onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">El correo se lee en vivo por IMAP y las respuestas salen por SMTP. No se copian los mensajes a esta agenda.</p>
        {showGoogle && (
          <div className="space-y-2">
            <Button type="button" variant="secondary" className="w-full" onClick={connectGoogle} disabled={busy || !googleEnabled}>
              Conectar con Google{googleState === "COMING_SOON" && <ComingSoonBadge />}
            </Button>
            <p className="text-xs text-muted">{googleEnabled
              ? "Google te pedirá permiso y, si tienes el móvil, la confirmación de la cuenta. No hace falta contraseña de aplicación."
              : "La conexión directa con Google llegará pronto. Mientras, usa una contraseña de aplicación de Gmail."}</p>
          </div>
        )}
        {isGoogle && (
          <p className="text-xs text-muted">Este buzón ya entra con Google ({mailbox?.email}). Puedes volver a conectar para renovar el permiso. Servidores y cuenta quedan fijos; para cambiarlos escribe una contraseña de aplicación.</p>
        )}
        <Select label="Proveedor" value={presetId} onChange={(e) => applyPreset(e.target.value)} disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined}>
          <option value="custom">Personalizado</option>
          {MAILBOX_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </Select>
        <div className="modal-grid">
          <Input label="Nombre" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Personal, trabajo…" />
          <Input label="Correo" type="email" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
          <Input label="Usuario" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Normalmente el mismo correo" />
          <Input label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isGoogle ? "Opcional · solo si pasas a contraseña de aplicación" : mailbox?.passwordConfigured ? "Guardada · dejar vacío para conservarla" : "Contraseña de aplicación"} />
          <Input label="IMAP" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} value={imapHost} onChange={(e) => { setManualCustom(false); setImapHost(e.target.value); }} placeholder="imap.example.com" />
          <Input label="Puerto IMAP" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} type="number" min={1} max={65535} value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
          <Input label="SMTP" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} value={smtpHost} onChange={(e) => { setManualCustom(false); setSmtpHost(e.target.value); }} placeholder="smtp.example.com" />
          <Input label="Puerto SMTP" disabled={lockedToGoogle} className={lockedToGoogle ? "opacity-60 cursor-not-allowed" : undefined} type="number" min={1} max={65535} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
        </div>
        {presetHint && <p className="text-xs text-muted">{presetHint}</p>}
        {testDetail && <p className="text-xs text-muted font-mono break-all">{testDetail}</p>}
      </div>
    </Modal>
  );
}

function formatImapDebug(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return null;
  const imap = (err.details as { imap?: Record<string, unknown> }).imap;
  if (!imap) return null;
  const bits = [
    typeof imap.host === "string" ? imap.host : null,
    typeof imap.code === "string" ? imap.code : null,
    typeof imap.serverResponseCode === "string" ? imap.serverResponseCode : null,
    imap.authenticationFailed === true ? "authenticationFailed" : null,
    typeof imap.responseText === "string" ? imap.responseText : null,
    typeof imap.message === "string" ? imap.message : null,
  ].filter(Boolean);
  return bits.length ? `debug IMAP: ${bits.join(" · ")}` : null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
