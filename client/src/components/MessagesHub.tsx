import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, CalendarClock, Inbox, Mail, MessageCircleMore, RefreshCw } from "lucide-react";
import { InboxMail } from "@/components/InboxMail";
import { ChannelBadge, MessagingConversationReader } from "@/components/MessagingConversation";
import { MessagingSetup, type MessagingAvailability } from "@/components/MessagingSetup";
import { Button, ComingSoonBadge, EmptyState, Spinner } from "@/components/ui";
import { integrationShown, useIntegrations, type IntegrationState } from "@/lib/integrations";
import { http } from "@/lib/api";
import type { Mailbox, MailMessageListItem, MessagingConnection, MessagingConversation } from "@/lib/types";

type Channel = "all" | "email" | "WHATSAPP" | "TELEGRAM";
type View = "all" | "unread" | "scheduled" | "attention";
type ConnectionResponse = { connections: MessagingConnection[]; availability: MessagingAvailability };
type ConversationResponse = { conversations: MessagingConversation[]; nextCursor: string | null };
type EmailChoice = { mailboxId: string; uid: number };

const CHANNELS: Array<{ value: Channel; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "email", label: "Correo" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "TELEGRAM", label: "Telegram" },
];
const VIEWS: Array<{ value: View; label: string; icon: typeof Inbox }> = [
  { value: "all", label: "Todos", icon: Inbox },
  { value: "unread", label: "No leídos", icon: MessageCircleMore },
  { value: "scheduled", label: "Programados", icon: CalendarClock },
  { value: "attention", label: "Requieren atención", icon: AlertTriangle },
];

export function MessagesHub() {
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const initialConversation = search.get("conversation");
  const initialView = search.get("view");
  const [channel, setChannel] = useState<Channel>("all");
  const [view, setView] = useState<View>(initialView === "attention" || initialView === "scheduled" || initialView === "unread" ? initialView : "all");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversation);
  const [emailChoice, setEmailChoice] = useState<EmailChoice | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const integrations = useIntegrations();
  const channelStates: Partial<Record<Channel, IntegrationState>> = { WHATSAPP: integrations.whatsapp, TELEGRAM: integrations.telegram };
  const hiddenProviders = new Set((["WHATSAPP", "TELEGRAM"] as const).filter((provider) => !integrationShown(channelStates[provider])));

  const connections = useQuery({
    queryKey: ["messaging-connections"],
    queryFn: () => http.get<ConnectionResponse>("/api/messaging/connections"),
    refetchInterval: () => document.visibilityState === "visible" ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  const conversations = useQuery({
    queryKey: ["messaging-conversations", channel, view],
    queryFn: () => http.get<ConversationResponse>("/api/messaging/conversations", {
      provider: channel === "WHATSAPP" || channel === "TELEGRAM" ? channel : undefined,
      view,
    }),
    enabled: channel !== "email",
    refetchInterval: () => document.visibilityState === "visible" ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
  const mailboxes = useQuery({
    queryKey: ["inbox-mailboxes"],
    queryFn: () => http.get<{ mailboxes: Mailbox[] }>("/api/inbox/mailboxes"),
    enabled: channel === "all",
  });
  const mailboxRows = mailboxes.data?.mailboxes ?? [];
  const mailQueries = useQueries({
    queries: mailboxRows.map((mailbox) => ({
      queryKey: ["inbox-mail", mailbox.id],
      queryFn: () => http.get<{ messages: MailMessageListItem[] }>(`/api/inbox/mailboxes/${mailbox.id}/messages`),
      enabled: channel === "all" && (view === "all" || view === "unread"),
      staleTime: 30_000,
    })),
  });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void conversations.refetch();
        void connections.refetch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [connections, conversations]);

  // A channel the admin hides disappears from the whole inbox, not just its tab.
  const businessRows = (conversations.data?.conversations ?? []).filter((item) => !hiddenProviders.has(item.provider));
  const selectedConversation = businessRows.find((item) => item.id === selectedConversationId) ?? null;
  const emailRows = useMemo(() => mailboxRows.flatMap((mailbox, index) => (
    (mailQueries[index]?.data?.messages ?? [])
      .filter((message) => view !== "unread" || !message.seen)
      .map((message) => ({ mailbox, message }))
  )), [mailQueries, mailboxRows, view]);
  const combined = useMemo(() => [
    ...businessRows.map((conversation) => ({ type: "business" as const, at: conversation.lastMessageAt ?? "", conversation })),
    ...(view === "all" || view === "unread" ? emailRows.map(({ mailbox, message }) => ({ type: "email" as const, at: message.date, mailbox, message })) : []),
  ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()), [businessRows, emailRows, view]);

  const chooseConversation = (id: string) => {
    setSelectedConversationId(id);
    const next = new URLSearchParams(search);
    next.set("conversation", id);
    next.set("view", view);
    setSearch(next, { replace: true });
  };
  const clearConversation = () => {
    setSelectedConversationId(null);
    const next = new URLSearchParams(search);
    next.delete("conversation");
    setSearch(next, { replace: true });
  };
  const selectChannel = (nextChannel: Channel) => {
    setChannel(nextChannel);
    setEmailChoice(null);
    clearConversation();
  };

  if (channel === "email") {
    return (
      <div className="space-y-4">
        <ChannelTabs value={channel} onChange={selectChannel} states={channelStates} />
        <InboxMail initialMailboxId={emailChoice?.mailboxId ?? null} initialUid={emailChoice?.uid ?? null} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChannelTabs value={channel} onChange={selectChannel} states={channelStates} />
      {connections.data && hiddenProviders.size < 2 && (
        <MessagingSetup
          connections={connections.data.connections.filter((item) => !hiddenProviders.has(item.provider))}
          availability={connections.data.availability}
          states={{ telegram: integrations.telegram, whatsapp: integrations.whatsapp }}
        />
      )}
      {connections.isError && (
        <div className="card p-4 flex items-center gap-3 text-sm text-danger"><span className="flex-1">No se pudo comprobar el estado de los canales.</span><Button size="sm" variant="secondary" onClick={() => void connections.refetch()}>Reintentar</Button></div>
      )}
      <ViewTabs value={view} onChange={(next) => { setView(next); clearConversation(); }} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[34rem]">
        <section ref={listRef} className={clsx("lg:col-span-2 card overflow-hidden min-h-[34rem]", selectedConversation && "hidden lg:block")} aria-label="Lista de mensajes">
          <div className="h-12 border-b border-border/70 px-4 flex items-center gap-2">
            <h2 className="font-medium text-sm text-text flex-1">{viewLabel(view)}</h2>
            <Button icon size="sm" variant="ghost" aria-label="Actualizar mensajes" onClick={() => { void conversations.refetch(); void qc.invalidateQueries({ queryKey: ["inbox-mail"] }); }}>
              <RefreshCw className={clsx("w-4 h-4", conversations.isFetching && "animate-spin")} aria-hidden />
            </Button>
          </div>
          {conversations.isLoading || (channel === "all" && mailboxes.isLoading) ? (
            <div className="h-48 grid place-items-center text-accent"><Spinner /></div>
          ) : conversations.isError ? (
            <EmptyState icon={<AlertTriangle className="w-6 h-6" />} title="No se pudieron cargar los mensajes" hint="Comprueba la conexión y vuelve a intentarlo." action={<Button size="sm" onClick={() => void conversations.refetch()}>Reintentar</Button>} />
          ) : combined.length === 0 ? (
            <EmptyState icon={<MessageCircleMore className="w-6 h-6" />} title="No hay conversaciones en esta vista" hint={view !== "all" ? "Prueba otra vista o actualiza los canales." : hiddenProviders.size === 2 ? "Conecta un buzón de correo en la pestaña Correo." : "Conecta un canal; el historial empezará desde ese momento."} />
          ) : (
            <ul className="divide-y divide-border/60">
              {combined.map((row) => row.type === "business" ? (
                <li key={`business-${row.conversation.id}`}>
                  <button
                    type="button"
                    onClick={() => chooseConversation(row.conversation.id)}
                    className={clsx("w-full min-h-[4.75rem] text-left px-4 py-3 hover:bg-surface transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent", selectedConversationId === row.conversation.id && "bg-accent-soft/40")}
                  >
                    <div className="flex items-center gap-2">
                      <p className={clsx("text-sm truncate flex-1", row.conversation.unreadCount ? "font-semibold text-text" : "text-text")}>{row.conversation.displayName}</p>
                      <ChannelBadge provider={row.conversation.provider} />
                      <span className="text-[11px] text-faint tabular-nums shrink-0">{shortDate(row.at)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted truncate flex-1">{row.conversation.lastDirection === "OUTBOUND" ? "Tú: " : ""}{row.conversation.preview}</p>
                      {row.conversation.attentionCount > 0 && <span className="chip bg-warning/15 text-warning">Revisar</span>}
                      {row.conversation.scheduledCount > 0 && <span className="text-[11px] text-muted">{row.conversation.scheduledCount} programado</span>}
                      {row.conversation.unreadCount > 0 && <span className="min-w-5 h-5 rounded-full px-1 bg-accent text-white text-[11px] grid place-items-center" aria-label={`${row.conversation.unreadCount} sin leer`}>{row.conversation.unreadCount}</span>}
                    </div>
                    <p className="text-[11px] text-faint truncate mt-1">Desde {row.conversation.accountLabel}</p>
                  </button>
                </li>
              ) : (
                <li key={`email-${row.mailbox.id}-${row.message.uid}`}>
                  <button
                    type="button"
                    onClick={() => { setEmailChoice({ mailboxId: row.mailbox.id, uid: row.message.uid }); setChannel("email"); clearConversation(); }}
                    className="w-full min-h-[4.75rem] text-left px-4 py-3 hover:bg-surface transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <div className="flex items-center gap-2"><p className={clsx("text-sm truncate flex-1", !row.message.seen && "font-semibold")}>{row.message.from}</p><span className="chip bg-bg text-muted"><Mail className="w-3 h-3" aria-hidden />Correo</span><span className="text-[11px] text-faint shrink-0">{shortDate(row.message.date)}</span></div>
                    <p className="text-xs text-text truncate mt-1">{row.message.subject}</p>
                    <p className="text-[11px] text-faint truncate mt-1">En {row.mailbox.label}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={clsx("lg:col-span-3", !selectedConversation && "hidden lg:block")}>
          {selectedConversation ? (
            <MessagingConversationReader conversation={selectedConversation} onBack={clearConversation} />
          ) : (
            <div className="card min-h-[34rem] grid place-items-center p-8 text-center"><div><MessageCircleMore className="w-8 h-8 text-faint mx-auto" aria-hidden /><p className="text-sm text-muted mt-3">Elige una conversación para leerla y responder.</p><p className="text-xs text-faint mt-1">{hiddenProviders.size === 2
                  ? "El correo se lee en vivo; no se copia a la agenda."
                  : `Correo permanece en vivo; ${(["WHATSAPP", "TELEGRAM"] as const).filter((item) => !hiddenProviders.has(item)).map((item) => item === "WHATSAPP" ? "WhatsApp" : "Telegram").join(" y ")} se conserva${hiddenProviders.size === 0 ? "n" : ""} cifrado${hiddenProviders.size === 0 ? "s" : ""} durante 90 días.`}</p></div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelTabs({ value, onChange, states }: { value: Channel; onChange: (value: Channel) => void; states: Partial<Record<Channel, IntegrationState>> }) {
  const channels = CHANNELS.filter((item) => item.value === "all" || item.value === "email" || integrationShown(states[item.value]));
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Canal de mensajes">
      {channels.map((item) => <button key={item.value} type="button" aria-pressed={value === item.value} onClick={() => onChange(item.value)} className={clsx("chip border min-h-11 shrink-0 focus-visible:ring-2 focus-visible:ring-accent", value === item.value ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted hover:text-text")}>{item.label}{states[item.value] === "COMING_SOON" && <ComingSoonBadge className="ml-1" />}</button>)}
    </div>
  );
}

function ViewTabs({ value, onChange }: { value: View; onChange: (value: View) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Vista de mensajes">
      {VIEWS.map((item) => { const Icon = item.icon; return <button key={item.value} type="button" aria-pressed={value === item.value} onClick={() => onChange(item.value)} className={clsx("chip border min-h-11 shrink-0 focus-visible:ring-2 focus-visible:ring-accent", value === item.value ? "bg-accent text-white border-accent" : "border-border text-muted hover:text-text")}><Icon className="w-3.5 h-3.5" aria-hidden />{item.label}</button>; })}
    </div>
  );
}

function viewLabel(view: View) { return ({ all: "Mensajes recientes", unread: "Mensajes no leídos", scheduled: "Conversaciones programadas", attention: "Requieren atención" } as const)[view]; }
function shortDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
