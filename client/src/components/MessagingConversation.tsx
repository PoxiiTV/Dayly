import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlarmClock,
  ArrowDown,
  Bot,
  CalendarClock,
  Download,
  MessageSquareText,
  Send,
  ShieldCheck,
  Square,
  SquareCheckBig,
} from "lucide-react";
import { Button, Checkbox, Input, Modal, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { getMessagingMediaBlob, http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ChannelMessage, MessagingConversation, ScheduledReply, WhatsAppTemplate } from "@/lib/types";

type ThreadResponse = {
  conversation: { id: string; provider: string; accountLabel: string; displayName: string; lastInboundAt: string | null; replyWindowEndsAt: string | null };
  messages: ChannelMessage[];
  nextBefore: string | null;
};

export function MessagingConversationReader({ conversation, onBack }: { conversation: MessagingConversation; onBack: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"automatic" | "reminder" | null>(null);
  const [preview, setPreview] = useState<ScheduledReply | null>(null);
  const [calenOpen, setCalenOpen] = useState(false);
  const [selectedForCalen, setSelectedForCalen] = useState<string[]>([]);
  const [showLatest, setShowLatest] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const initialScrolled = useRef(false);

  const thread = useQuery({
    queryKey: ["messaging-thread", conversation.id],
    queryFn: () => http.get<ThreadResponse>(`/api/messaging/conversations/${conversation.id}/messages`),
    refetchInterval: () => document.visibilityState === "visible" ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
  const scheduled = useQuery({
    queryKey: ["messaging-scheduled", conversation.id],
    queryFn: () => http.get<{ scheduledReplies: ScheduledReply[] }>("/api/messaging/scheduled-replies", { conversationId: conversation.id }),
    refetchInterval: () => document.visibilityState === "visible" ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
  const messages = thread.data?.messages ?? [];
  const details = thread.data?.conversation;

  useEffect(() => {
    initialScrolled.current = false;
    setShowLatest(false);
    setSelectedForCalen([]);
    setDraft("");
  }, [conversation.id]);

  useEffect(() => {
    void http.post(`/api/messaging/conversations/${conversation.id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: ["messaging-conversations"] }))
      .catch(() => undefined);
  }, [conversation.id, qc]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !messages.length) return;
    if (!initialScrolled.current || nearBottom.current) {
      node.scrollTo({ top: node.scrollHeight, behavior: initialScrolled.current ? "smooth" : "auto" });
      initialScrolled.current = true;
      setShowLatest(false);
    }
  }, [messages.length]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void thread.refetch();
        void scheduled.refetch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [scheduled, thread]);

  const sendNow = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await http.post(`/api/messaging/conversations/${conversation.id}/messages`, { body: draft.trim(), idempotencyKey: crypto.randomUUID() });
      setDraft("");
      push("success", "Respuesta puesta en cola");
      await Promise.all([scheduled.refetch(), thread.refetch(), qc.invalidateQueries({ queryKey: ["messaging-conversations"] })]);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo preparar el envío.");
    } finally {
      setBusy(false);
    }
  };

  const toggleCalenMessage = (id: string) => {
    setSelectedForCalen((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-10));
  };
  const replyWindowEnd = details?.replyWindowEndsAt ?? conversation.replyWindowEndsAt;
  const canReply = conversation.canReply && Boolean(replyWindowEnd && new Date(replyWindowEnd).getTime() > Date.now());
  const activeScheduled = (scheduled.data?.scheduledReplies ?? []).filter((item) => !["SENT", "CANCELED"].includes(item.status));

  return (
    <section className="card min-h-[34rem] h-[min(72vh,48rem)] flex flex-col overflow-hidden" aria-label={`Conversación con ${conversation.displayName}`}>
      <header className="border-b border-border/70 px-3 sm:px-4 py-3 flex items-start gap-2">
        <Button variant="ghost" size="sm" className="lg:hidden -ml-1" onClick={onBack}>Volver</Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold text-text truncate">{conversation.displayName}</h2>
            <ChannelBadge provider={conversation.provider} />
          </div>
          <p className="text-xs text-muted truncate mt-0.5">Envías desde {conversation.accountLabel}</p>
        </div>
        {selectedForCalen.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setCalenOpen(true)}><Bot className="w-4 h-4" aria-hidden />Calen · {selectedForCalen.length}</Button>
        )}
      </header>

      {activeScheduled.length > 0 && (
        <div className="border-b border-border/70 px-3 sm:px-4 py-2 flex gap-2 overflow-x-auto" aria-label="Envíos pendientes">
          {activeScheduled.map((item) => (
            <button key={item.id} type="button" onClick={() => setPreview(item)} className={clsx("chip border shrink-0 focus-visible:ring-2 focus-visible:ring-accent", attentionStatus(item.status) ? "border-warning/40 text-warning" : "border-border text-muted hover:text-text")}>
              <CalendarClock className="w-3.5 h-3.5" aria-hidden />{statusLabel(item.status)} · {formatCompactDate(item.sendAt)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          setShowLatest(!nearBottom.current);
        }}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-3 scroll-pb-6"
      >
        {thread.isLoading ? (
          <div className="h-full grid place-items-center text-accent"><Spinner /></div>
        ) : thread.isError ? (
          <div className="h-full grid place-items-center text-center">
            <div><p className="text-sm text-danger">No se pudo cargar la conversación.</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => void thread.refetch()}>Reintentar</Button></div>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted text-center py-12">Los mensajes aparecerán aquí desde el momento de la conexión.</p>
        ) : messages.map((message) => (
          <MessageBubble key={message.id} message={message} selected={selectedForCalen.includes(message.id)} onToggle={() => toggleCalenMessage(message.id)} onMedia={async () => {
            try {
              const blob = await getMessagingMediaBlob(message.id);
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank", "noopener,noreferrer");
              window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch (error) {
              push("error", error instanceof Error ? error.message : "El archivo ya no está disponible.");
            }
          }} />
        ))}
        {showLatest && (
          <Button icon size="sm" className="sticky bottom-2 ml-auto" aria-label="Ir al mensaje más reciente" onClick={() => { nearBottom.current = true; setShowLatest(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown className="w-4 h-4" /></Button>
        )}
      </div>

      <footer className="border-t border-border/70 p-3 sm:p-4 bg-surface/50 space-y-2">
        {!canReply && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[12rem]">
              La ventana de respuesta libre está cerrada. El texto no se enviará; puedes conservarlo y crear un recordatorio.
              {conversation.provider === "WHATSAPP" && " También puedes retomar la conversación con una plantilla aprobada por Meta."}
            </span>
            {conversation.provider === "WHATSAPP" && (
              <Button size="xs" variant="secondary" onClick={() => setTemplateOpen(true)}><MessageSquareText className="w-3.5 h-3.5" aria-hidden />Enviar plantilla</Button>
            )}
          </div>
        )}
        <Textarea
          dense
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={4000}
          label="Respuesta"
          placeholder="Escribe una respuesta…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setScheduleMode("reminder")} disabled={!draft.trim()}><AlarmClock className="w-4 h-4" aria-hidden />Recordarme responder</Button>
          <Button size="sm" variant="secondary" onClick={() => setScheduleMode("automatic")} disabled={!draft.trim()}><CalendarClock className="w-4 h-4" aria-hidden />Enviar automáticamente</Button>
          <span className="flex-1" />
          {canReply && <Button size="sm" onClick={() => void sendNow()} disabled={busy || !draft.trim()}><Send className="w-4 h-4" aria-hidden />{busy ? <Spinner /> : "Enviar ahora"}</Button>}
        </div>
      </footer>

      <ScheduleDraftDialog
        open={scheduleMode !== null}
        mode={scheduleMode ?? "automatic"}
        conversation={conversation}
        body={draft}
        timezone={user?.timezone ?? "Europe/Madrid"}
        quotedMessageId={selectedForCalen.at(-1) ?? null}
        onClose={() => setScheduleMode(null)}
        onPrepared={(item) => { setScheduleMode(null); setPreview(item); void scheduled.refetch(); }}
        onReminderCreated={() => { setScheduleMode(null); setDraft(""); void scheduled.refetch(); }}
      />
      <ScheduledReplyDialog
        reply={preview}
        conversation={conversation}
        onClose={() => setPreview(null)}
        onChange={(item) => { setPreview(item); void scheduled.refetch(); void qc.invalidateQueries({ queryKey: ["messaging-conversations"] }); }}
      />
      <WhatsAppTemplateDialog
        open={templateOpen}
        conversation={conversation}
        onClose={() => setTemplateOpen(false)}
        onQueued={() => {
          setTemplateOpen(false);
          void Promise.all([scheduled.refetch(), thread.refetch(), qc.invalidateQueries({ queryKey: ["messaging-conversations"] })]);
        }}
      />
      <MessagingCalenDialog
        open={calenOpen}
        conversation={conversation}
        selectedMessageIds={selectedForCalen}
        onClose={() => setCalenOpen(false)}
        onPrepared={(item) => { setCalenOpen(false); setPreview(item); void scheduled.refetch(); }}
      />
    </section>
  );
}

function WhatsAppTemplateDialog(props: { open: boolean; conversation: MessagingConversation; onClose: () => void; onQueued: () => void }) {
  const { push } = useToast();
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const templates = useQuery({
    queryKey: ["messaging-templates", props.conversation.id],
    queryFn: () => http.get<{ templates: WhatsAppTemplate[] }>(`/api/messaging/conversations/${props.conversation.id}/templates`),
    enabled: props.open,
    staleTime: 60_000,
  });
  const list = templates.data?.templates ?? [];
  const template = list.find((item) => templateKey(item) === selected) ?? null;

  useEffect(() => {
    if (!props.open) { setSelected(""); setValues([]); }
  }, [props.open]);
  useEffect(() => {
    setValues(Array.from({ length: template?.parameterCount ?? 0 }, () => ""));
  }, [template?.name, template?.language, template?.parameterCount]);

  const preview = template
    ? [template.header, template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, index: string) => values[Number(index) - 1]?.trim() || `{{${index}}}`), template.footer].filter(Boolean).join("\n\n")
    : "";
  const ready = Boolean(template && values.every((value) => value.trim()));

  const send = async () => {
    if (!template) return;
    setBusy(true);
    try {
      await http.post(`/api/messaging/conversations/${props.conversation.id}/template`, {
        name: template.name,
        language: template.language,
        parameters: values.map((value) => value.trim()),
        idempotencyKey: crypto.randomUUID(),
      });
      push("success", "Plantilla puesta en cola");
      props.onQueued();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo enviar la plantilla.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Enviar plantilla de WhatsApp"
      footer={<><Button variant="secondary" onClick={props.onClose}>Cancelar</Button><Button onClick={() => void send()} disabled={busy || !ready}>{busy ? <Spinner /> : "Enviar ahora"}</Button></>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Solo aparecen las plantillas aprobadas en tu cuenta de WhatsApp Business que no necesitan imágenes ni botones con variables. Meta puede cobrar cada conversación iniciada con plantilla.</p>
        {templates.isLoading ? (
          <div className="grid place-items-center py-6 text-accent"><Spinner /></div>
        ) : templates.isError ? (
          <p className="text-sm text-danger">{templates.error instanceof Error ? templates.error.message : "No se pudieron cargar las plantillas."}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">No hay plantillas compatibles. Créalas y espera su aprobación en el Administrador de WhatsApp de Meta.</p>
        ) : (
          <>
            <Select label="Plantilla" value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Elige una plantilla…</option>
              {list.map((item) => <option key={templateKey(item)} value={templateKey(item)}>{item.name} · {item.language}</option>)}
            </Select>
            {values.map((value, index) => (
              <Input
                key={index}
                label={`Valor {{${index + 1}}}`}
                value={value}
                maxLength={1024}
                onChange={(event) => setValues((current) => current.map((item, i) => i === index ? event.target.value.replace(/[\r\n\t]/g, " ") : item))}
              />
            ))}
            {template && <p className="rounded-xl border border-border bg-bg px-3 py-2 text-sm whitespace-pre-wrap break-words">{preview}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

function templateKey(item: WhatsAppTemplate): string {
  return `${item.name}:${item.language}`;
}

function MessageBubble({ message, selected, onToggle, onMedia }: { message: ChannelMessage; selected: boolean; onToggle: () => void; onMedia: () => void }) {
  const outgoing = message.direction === "OUTBOUND";
  return (
    <article className={clsx("group flex gap-2 max-w-[92%] sm:max-w-[78%]", outgoing ? "ml-auto flex-row-reverse" : "mr-auto")}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`${selected ? "Quitar" : "Seleccionar"} mensaje para Calen`}
        className="w-11 h-11 shrink-0 grid place-items-center rounded-xl text-faint hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
      >
        {selected ? <SquareCheckBig className="w-4 h-4" aria-hidden /> : <Square className="w-4 h-4" aria-hidden />}
      </button>
      <div className={clsx("rounded-2xl px-3.5 py-2.5 min-w-0", outgoing ? "bg-accent text-white rounded-br-md" : "bg-bg border border-border rounded-bl-md text-text")}>
        {message.deletedAt ? <p className="text-sm italic opacity-80">Mensaje eliminado</p> : <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>}
        {message.hasMedia && (
          <Button size="xs" variant={outgoing ? "secondary" : "ghost"} className="mt-2" onClick={onMedia}><Download className="w-3.5 h-3.5" aria-hidden />Abrir {mediaKind(message.kind)}</Button>
        )}
        <div className={clsx("mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums", outgoing ? "text-white/75" : "text-faint")}>
          {message.editedAt && <span>editado · </span>}
          <span>{formatTime(message.providerSentAt)}</span>
          {outgoing && <span aria-label={deliveryLabel(message.deliveryStatus)}>{message.deliveryStatus === "READ" ? "✓✓" : message.deliveryStatus === "FAILED" ? "!" : "✓"}</span>}
        </div>
      </div>
    </article>
  );
}

function ScheduleDraftDialog(props: {
  open: boolean;
  mode: "automatic" | "reminder";
  conversation: MessagingConversation;
  body: string;
  timezone: string;
  quotedMessageId: string | null;
  onClose: () => void;
  onPrepared: (reply: ScheduledReply) => void;
  onReminderCreated: () => void;
}) {
  const { push } = useToast();
  const [body, setBody] = useState(props.body);
  const [sendAt, setSendAt] = useState(toLocalInput(defaultFutureDate(props.conversation.replyWindowEndsAt)));
  const [pauseOnActivity, setPauseOnActivity] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setBody(props.body);
    setSendAt(toLocalInput(defaultFutureDate(props.conversation.replyWindowEndsAt)));
    setPauseOnActivity(true);
  }, [props.body, props.conversation.replyWindowEndsAt, props.open, props.mode]);

  const submit = async () => {
    const date = new Date(sendAt);
    if (!body.trim() || Number.isNaN(date.getTime())) return;
    setBusy(true);
    try {
      const result = await http.post<{ scheduledReply: ScheduledReply }>("/api/messaging/scheduled-replies", {
        conversationId: props.conversation.id,
        body: body.trim(),
        sendAt: date.toISOString(),
        timezone: props.timezone,
        quotedMessageId: props.quotedMessageId,
        pauseOnActivity,
      });
      if (props.mode === "reminder") {
        await http.post(`/api/messaging/conversations/${props.conversation.id}/reminders`, {
          title: `Responder a ${props.conversation.displayName}`,
          remindAt: date.toISOString(),
          messageId: props.quotedMessageId,
        });
        push("success", "Borrador guardado y recordatorio creado");
        props.onReminderCreated();
      } else {
        props.onPrepared(result.scheduledReply);
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo guardar el borrador.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.mode === "automatic" ? "Preparar envío automático" : "Recordarme responder"}
      description={props.mode === "automatic" ? "Primero guardarás una vista previa; el envío no quedará autorizado hasta pulsar Confirmar programación." : "El texto quedará como borrador y el recordatorio podrá fijarse para cualquier fecha."}
      footer={<><Button variant="secondary" onClick={props.onClose}>Cancelar</Button><Button onClick={() => void submit()} disabled={busy || !body.trim() || !sendAt}>{busy ? <Spinner /> : props.mode === "automatic" ? "Revisar programación" : "Guardar y recordar"}</Button></>}
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-bg border border-border p-3 text-sm"><p className="font-medium text-text">{props.conversation.displayName}</p><p className="text-xs text-muted mt-1">{props.conversation.provider} · desde {props.conversation.accountLabel}</p></div>
        <Textarea label="Texto exacto" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={5} />
        <Input label={props.mode === "automatic" ? "Fecha y hora de envío" : "Fecha y hora del recordatorio"} type="datetime-local" value={sendAt} onChange={(event) => setSendAt(event.target.value)} />
        <p className="text-xs text-muted">Zona horaria: {props.timezone}</p>
        {props.mode === "automatic" && <Checkbox checked={pauseOnActivity} onChange={setPauseOnActivity} label="Pausar si llega otro mensaje, cambia el mensaje citado o respondo desde el móvil" />}
      </div>
    </Modal>
  );
}

function ScheduledReplyDialog({ reply, conversation, onClose, onChange }: { reply: ScheduledReply | null; conversation: MessagingConversation; onClose: () => void; onChange: (reply: ScheduledReply) => void }) {
  const { push } = useToast();
  const [body, setBody] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [pause, setPause] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!reply) return;
    setBody(reply.body);
    setSendAt(toLocalInput(new Date(reply.sendAt)));
    setPause(reply.pauseOnActivity);
  }, [reply]);
  if (!reply) return null;
  const sendAtIso = validIso(sendAt);
  const dirty = body !== reply.body || sendAtIso !== reply.sendAt || pause !== reply.pauseOnActivity;

  const save = async (force = false) => {
    if (!sendAtIso || !body.trim()) {
      push("error", "Indica un texto y una fecha válidos.");
      return;
    }
    setBusy(true);
    try {
      const result = await http.patch<{ scheduledReply: ScheduledReply }>(`/api/messaging/scheduled-replies/${reply.id}`, {
        body,
        sendAt: sendAtIso,
        pauseOnActivity: pause,
      });
      onChange(result.scheduledReply);
      push("success", force ? "Vista previa renovada; confirma la nueva versión" : "Cambios guardados; confirma la nueva versión");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo guardar.");
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const result = await http.post<{ scheduledReply: ScheduledReply }>(`/api/messaging/scheduled-replies/${reply.id}/confirm`, { expectedVersion: reply.draftVersion, idempotencyKey: crypto.randomUUID() });
      onChange(result.scheduledReply);
      push("success", "Programación confirmada");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo confirmar.");
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      const result = await http.post<{ scheduledReply: ScheduledReply }>(`/api/messaging/scheduled-replies/${reply.id}/cancel`);
      onChange(result.scheduledReply);
      push("success", "Envío cancelado");
    } catch (error) { push("error", error instanceof Error ? error.message : "No se pudo cancelar."); }
    finally { setBusy(false); }
  };
  const needsReview = attentionStatus(reply.status);
  const editable = !reply.isTemplate && !["SENT", "PROCESSING", "CANCELED"].includes(reply.status);
  return (
    <Modal
      open
      onClose={onClose}
      title="Confirmar programación"
      description="La confirmación autoriza únicamente esta versión exacta. Cualquier cambio obliga a confirmar otra vez."
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {editable && reply.status !== "AWAITING_CONFIRMATION" && <Button variant="secondary" onClick={() => void save(true)} disabled={busy || !sendAtIso || !body.trim()}>Revisar y volver a confirmar</Button>}
        {editable && dirty && <Button variant="secondary" onClick={() => void save()} disabled={busy || !sendAtIso || !body.trim()}>Guardar cambios</Button>}
        {reply.status === "AWAITING_CONFIRMATION" && <Button onClick={() => void confirm()} disabled={busy || dirty || !reply.canConfirm}>{busy ? <Spinner /> : "Confirmar programación"}</Button>}
        {["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION", "FAILED"].includes(reply.status) && <Button variant="danger" onClick={() => void cancel()} disabled={busy}>Cancelar envío</Button>}
      </>}
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3 rounded-xl bg-bg border border-border p-3 text-sm">
          <div><span className="text-xs text-muted block">Destinatario</span><strong className="text-text">{reply.recipient || conversation.displayName}</strong></div>
          <div><span className="text-xs text-muted block">Cuenta emisora</span><strong className="text-text">{reply.accountLabel || conversation.accountLabel}</strong></div>
          <div><span className="text-xs text-muted block">Canal</span><strong className="text-text">{reply.provider || conversation.provider}</strong></div>
          <div><span className="text-xs text-muted block">Estado</span><strong className={needsReview ? "text-warning" : "text-text"}>{statusLabel(reply.status)}</strong></div>
        </div>
        {reply.error && <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-text"><p>{reply.error}</p>{reply.errorCode === "OUTSIDE_REPLY_WINDOW" && <p className="text-xs text-muted mt-1">El texto sigue guardado. Crea un recordatorio y responde cuando exista una ventana válida.</p>}</div>}
        <Textarea label="Texto exacto" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={6} disabled={!editable} />
        <Input label="Fecha y hora" type="datetime-local" value={sendAt} onChange={(event) => setSendAt(event.target.value)} disabled={!editable} />
        <p className="text-xs text-muted">Zona horaria: {reply.timezone}</p>
        <Checkbox checked={pause} onChange={setPause} className={!editable ? "pointer-events-none opacity-70" : ""} label="Pausar si hay actividad nueva antes del envío" />
        {dirty && <p className="text-xs text-warning">Hay cambios sin guardar. Guarda y revisa la nueva versión antes de confirmar.</p>}
      </div>
    </Modal>
  );
}

function MessagingCalenDialog(props: { open: boolean; conversation: MessagingConversation; selectedMessageIds: string[]; onClose: () => void; onPrepared: (reply: ScheduledReply) => void }) {
  const { push } = useToast();
  const [instruction, setInstruction] = useState("");
  const [recentCount, setRecentCount] = useState("0");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState<string | null>(null);
  useEffect(() => { if (props.open) { setInstruction(""); setRecentCount("0"); setConfirmed(false); setReplyText(null); } }, [props.open]);
  const ask = async () => {
    if (!instruction.trim() || !confirmed || !props.selectedMessageIds.length) return;
    setBusy(true);
    try {
      const result = await http.post<{ reply: string; preparedReplyId?: string }>("/api/mascot/chat", {
        messages: [{ role: "user", content: instruction.trim() }],
        stream: false,
        sessionId: `messages-${crypto.randomUUID()}`,
        messagingContext: {
          conversationId: props.conversation.id,
          selectedMessageIds: props.selectedMessageIds,
          recentCount: Number(recentCount),
          dataProcessingConfirmed: true,
        },
      });
      setReplyText(result.reply);
      if (result.preparedReplyId) {
        const list = await http.get<{ scheduledReplies: ScheduledReply[] }>("/api/messaging/scheduled-replies", { conversationId: props.conversation.id });
        const prepared = list.scheduledReplies.find((item) => item.id === result.preparedReplyId);
        if (prepared) props.onPrepared(prepared);
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Calen no pudo preparar la respuesta.");
    } finally { setBusy(false); }
  };
  return (
    <Modal open={props.open} onClose={props.onClose} title="Preparar con Calen" description="Este contexto es independiente del chat general y no se guarda en localStorage." footer={<><Button variant="secondary" onClick={props.onClose}>Cancelar</Button><Button onClick={() => void ask()} disabled={busy || !instruction.trim() || !confirmed}>{busy ? <Spinner /> : "Pedir borrador"}</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-bg p-3 flex gap-3"><ShieldCheck className="w-5 h-5 text-accent shrink-0" aria-hidden /><p className="text-xs text-muted leading-relaxed">Se compartirán los {props.selectedMessageIds.length} mensajes elegidos y, solo si lo autorizas abajo, hasta 10 mensajes recientes. Verifica que tu proveedor de IA admite datos empresariales y no los usa para entrenamiento.</p></div>
        <Textarea label="Qué debe responder y cuándo" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Responde de forma cordial mañana a las 10:00…" rows={4} maxLength={2000} />
        <Select label="Contexto reciente adicional" value={recentCount} onChange={(event) => setRecentCount(event.target.value)}><option value="0">Ninguno</option><option value="5">Hasta 5 mensajes</option><option value="10">Hasta 10 mensajes</option></Select>
        <Checkbox checked={confirmed} onChange={setConfirmed} label="Confirmo que mi proveedor de IA es compatible con este tratamiento empresarial" />
        {replyText && <div role="status" className="rounded-xl border border-border p-3 text-sm text-text whitespace-pre-wrap"><MessageSquareText className="w-4 h-4 inline mr-2 text-accent" aria-hidden />{replyText}</div>}
      </div>
    </Modal>
  );
}

export function ChannelBadge({ provider }: { provider: "TELEGRAM" | "WHATSAPP" }) {
  return <span className={clsx("chip shrink-0", provider === "WHATSAPP" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>{provider === "WHATSAPP" ? "WhatsApp" : "Telegram"}</span>;
}

function defaultFutureDate(windowEnd: string | null) {
  const now = new Date();
  const candidate = new Date(now.getTime() + 60 * 60_000);
  if (windowEnd && candidate.getTime() < new Date(windowEnd).getTime()) return candidate;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); return tomorrow;
}
function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function validIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function formatTime(iso: string) { return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
function formatCompactDate(iso: string) { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function statusLabel(status: ScheduledReply["status"]) { return ({ AWAITING_CONFIRMATION: "Sin confirmar", SCHEDULED: "Programado", PROCESSING: "Enviando", SENT: "Enviado", PAUSED: "Pausado", REQUIRES_ATTENTION: "Requiere atención", FAILED: "Fallido", CANCELED: "Cancelado" } as const)[status]; }
function attentionStatus(status: ScheduledReply["status"]) { return ["PAUSED", "REQUIRES_ATTENTION", "FAILED"].includes(status); }
function mediaKind(kind: ChannelMessage["kind"]) { return ({ IMAGE: "imagen", AUDIO: "audio", VIDEO: "vídeo", DOCUMENT: "documento", STICKER: "sticker" } as Partial<Record<ChannelMessage["kind"], string>>)[kind] || "archivo"; }
function deliveryLabel(status: ChannelMessage["deliveryStatus"]) { return ({ RECEIVED: "Recibido", PENDING: "Pendiente", SENT: "Enviado", DELIVERED: "Entregado", READ: "Leído", FAILED: "Fallido", UNKNOWN: "Estado desconocido" } as const)[status]; }
