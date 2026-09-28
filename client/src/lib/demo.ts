/**
 * DAYLY DEMO MODE — frontend-only mock of the API.
 *
 * When VITE_APP_DEMO=1 the client never touches the real backend: every
 * request is answered by this in-memory store. The store lives ONLY in the
 * JS module, so EVERY PAGE RELOAD re-seeds it and wipes any changes — i.e.
 * "no data is real and reloading restores the demo data". Great for a public
 * GitHub Pages showcase.
 */
import type { Task, EventItem, Note, Project, Habit, Goal, Reminder, NotificationItem, InboxItem, Tag, Priority, TaskStatus, Mailbox, MailMessage, PublicUser, MessagingConnection, MessagingConversation, ChannelMessage, ScheduledReply, PaymentMethod, Subscription, SubscriptionCharge, SubscriptionTag } from "./types";
import { maxFilesFor, parseTrashType, resolveAllowedMime, sanitizeFilename } from "@attachment-policy";
import { APP_NAME, SHELL_VERSION } from "@brand";
import { matchRadioStation } from "./radioStations";

/* ------------------------------------------------------------------ */
/* Seeded demo data (local calendar dates => deterministic across days) */
/* ------------------------------------------------------------------ */
function today(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d: Date, n: number) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function at(d: Date, h: number, m = 0) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); }
function iso(d: Date) { return d.toISOString(); }
function keyOf(d: Date) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

const T0 = today();
let seq = 0;
const nid = (p: string) => `${p}${++seq}${Math.floor(Math.random() * 1e6).toString(36)}`;
const uid = () => "u-demo";
const demoFiles = new Map<string, { mimeType: string; data: string; parentId: string }>();

function demoFail(status: number, message = "Error en la demo."): never {
  const e = new Error(message);
  (e as { status?: number }).status = status;
  throw e;
}

async function postedDemoFiles(body: unknown): Promise<{ filename: string; buf: Uint8Array }[]> {
  if (!(body instanceof FormData)) return [];
  const out: { filename: string; buf: Uint8Array }[] = [];
  for (const v of body.getAll("files")) {
    if (v instanceof File) out.push({ filename: v.name || "archivo", buf: new Uint8Array(await v.arrayBuffer()) });
  }
  return out;
}

function bytesToB64(buf: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function dropDemoFiles(parentId: string) {
  for (const [id, f] of [...demoFiles.entries()]) {
    if (f.parentId === parentId) demoFiles.delete(id);
  }
}

function saveDemoAttachments(kind: "task" | "note" | "reminder", parentId: string, existingCount: number, files: { filename: string; buf: Uint8Array }[]) {
  if (!files.length) demoFail(400);
  if (existingCount + files.length > maxFilesFor(kind)) demoFail(400);
  return files.map((f) => {
    const filename = sanitizeFilename(f.filename);
    const mime = resolveAllowedMime(f.buf, filename, kind);
    if (!mime) demoFail(400);
    const att = { id: nid("att"), filename, mimeType: mime, sizeBytes: f.buf.length };
    demoFiles.set(att.id, { mimeType: mime, data: bytesToB64(f.buf), parentId });
    return att;
  });
}

const tagSeed = [
  { id: nid("tag"), name: "Trabajo", color: "#6366f1" },
  { id: nid("tag"), name: "Personal", color: "#10b981" },
  { id: nid("tag"), name: "DJ", color: "#ec4899" },
  { id: nid("tag"), name: "Estudio", color: "#f59e0b" },
];
const projectSeed: Project[] = [
  { id: nid("prj"), name: "Web del estudio", description: "Renovar la web del DJ", color: "#6366f1", status: "ACTIVE", startDate: iso(T0), dueDate: iso(addDays(T0, 30)) },
  { id: nid("prj"), name: "Set de verano", description: "Ideas y tracklist para la temporada", color: "#f59e0b", status: "PLANNING" },
  { id: nid("prj"), name: "Estudio casero", description: "Acústica y cableado", color: "#10b981", status: "PAUSED" },
];

const taskSeed: Task[] = [
  { id: nid("tsk"), title: "Preparar set para el fin de semana", description: "Seleccionar tracklist de latin tech house", dueDate: iso(T0), hasTime: true, priority: "HIGH", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), projectId: projectSeed[0].id, color: "#6366f1", subtasks: [], tags: [tagSeed[1]], goals: [] },
  { id: nid("tsk"), title: "Responder emails de booking", dueDate: iso(T0), hasTime: true, priority: "URGENT", status: "IN_PROGRESS", notifyTelegram: true, timeSpentMinutes: 15, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[0]], goals: [] },
  { id: nid("tsk"), title: "Confirmar rider técnico", dueDate: iso(addDays(T0, -2)), hasTime: true, priority: "HIGH", status: "PENDING", notifyTelegram: true, timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[0]], goals: [] },
  { id: nid("tsk"), title: "Comprar cables de audio", priority: "LOW", status: "PENDING", dueDate: iso(addDays(T0, 1)), hasTime: false, timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[1]], goals: [] },
  { id: nid("tsk"), title: "Estudiar técnicas de mezcla", dueDate: iso(T0), hasTime: true, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[3]], goals: [] },
  { id: nid("tsk"), title: "Diseñar página de contacto", description: "Sección con formulario y redes", dueDate: iso(addDays(T0, 2)), hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), projectId: projectSeed[0].id, color: "#6366f1", subtasks: [
      { id: nid("sub"), title: "Crear estructura", done: true, sortOrder: 0 },
      { id: nid("sub"), title: "Diseñar interfaz", done: false, sortOrder: 1 },
      { id: nid("sub"), title: "Programar backend", done: false, sortOrder: 2 },
    ], tags: [tagSeed[0]], goals: [] },
  { id: nid("tsk"), title: "Llamar a la sala para confirmar fecha", dueDate: undefined as unknown as string, hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(T0), updatedAt: iso(T0), subtasks: [], tags: [tagSeed[2]], goals: [] },
];

const eventSeed: EventItem[] = [
  { id: nid("evt"), title: "Reunión de booking", startAt: iso(at(T0, 9, 0)), endAt: iso(at(T0, 9, 45)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#ef4444", category: "Reunión", location: "Videollamada", tags: [], },
  { id: nid("evt"), title: "Diseñar página de contacto", startAt: iso(at(T0, 10, 30)), endAt: iso(at(T0, 12, 0)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#6366f1", projectId: projectSeed[0].id, tags: [] },
  { id: nid("evt"), title: "Almuerzo", startAt: iso(at(T0, 12, 0)), endAt: iso(at(T0, 12, 45)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#f59e0b", tags: [] },
  { id: nid("evt"), title: "Ensayo técnica de mezcla", startAt: iso(at(T0, 15, 0)), endAt: iso(at(T0, 16, 30)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#10b981", tags: [] },
  { id: nid("evt"), title: "Reunión semanal", startAt: iso(at(addDays(T0, 1), 9, 0)), endAt: iso(at(addDays(T0, 1), 9, 30)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#ef4444", tags: [], recurrence: { frequency: "WEEKLY" } },
];

const noteSeed: Note[] = [
  { id: nid("nte"), title: "Ideas para el nuevo EP", content: "# Ideas\n\n- **Sabor a Playa** remix\n- Colaboración con vocalista\n- Publicar en verano", pinned: true, archived: false, favorite: true, color: "#ec4899", createdAt: iso(T0), updatedAt: iso(T0), tags: [tagSeed[2]] },
  { id: nid("nte"), title: "Lista de la compra", content: "- Cables RCA\n- Monitor pequeño\n- Auriculares nuevos", pinned: false, archived: false, favorite: false, createdAt: iso(T0), updatedAt: iso(T0), tags: [tagSeed[1]] },
];

const habitSeed: Habit[] = [
  { id: nid("hbt"), name: "Beber agua", color: "#3b82f6", scheduleDayBits: 127, reminderMinuteOfDay: 9 * 60 },
  { id: nid("hbt"), name: "Leer 20 min", color: "#10b981", scheduleDayBits: 127, reminderMinuteOfDay: 22 * 60 + 30 },
  { id: nid("hbt"), name: "Entrenar", color: "#f59e0b", scheduleDayBits: 62, reminderMinuteOfDay: null },
  { id: nid("hbt"), name: "Estudiar música", color: "#ec4899", scheduleDayBits: 127, reminderMinuteOfDay: 19 * 60 },
];
// habit logs for the last 6 days (some gaps to show streaks)
const habitLogSeed: Record<string, string[]> = {};

const goalSeed: Goal[] = [
  { id: nid("goal"), title: "Lanzar mi nueva web", description: "Web profesional lista para producción", dueDate: iso(addDays(T0, 30)), manualProgress: -1, status: "PENDING", projectId: projectSeed[0].id, tasks: [{ id: taskSeed[4].id, title: taskSeed[4].title, status: taskSeed[4].status }] },
  { id: nid("goal"), title: "Publicar EP en verano", description: "Terminar el tracklist y masterizar", dueDate: iso(addDays(T0, 60)), manualProgress: 40, status: "PENDING", tasks: [] },
];

const inboxSeed: InboxItem[] = [
  { id: nid("inb"), content: "Revisar factura del hosting", archived: false, createdAt: iso(T0) },
  { id: nid("inb"), content: "Comprar regalo de cumpleaños", archived: false, createdAt: iso(T0) },
];

const mailboxSeed: Mailbox[] = [
  {
    id: nid("mbx"), label: "Personal", email: "alex@example.com",
    imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecure: false,
    username: "alex@example.com", authType: "password", passwordConfigured: true, lastError: null, lastCheckedAt: iso(T0), isDefault: true,
  },
];
const mailMessageSeed: MailMessage[] = [
  {
    uid: 2, from: "Booking <booking@sala.example>", fromAddress: "booking@sala.example",
    to: "Alex Demo <alex@example.com>", subject: "Confirmación de fecha",
    date: iso(at(T0, 9, 12)), seen: false, snippet: "Te confirmamos el sábado a las 22:00.",
    text: "Hola Alex,\n\nTe confirmamos el sábado a las 22:00. ¿Nos envías rider y canal de entrada?\n\nGracias.",
    messageId: "<demo-2@example.com>",
  },
  {
    uid: 1, from: "Facturación <facturas@hosting.example>", fromAddress: "facturas@hosting.example",
    to: "Alex Demo <alex@example.com>", subject: "Tu factura de agosto",
    date: iso(at(addDays(T0, -1), 18, 40)), seen: true, snippet: "Adjuntamos la factura del hosting.",
    text: "Hola,\n\nAdjuntamos la factura del hosting de agosto. El cargo se realizará en 5 días.\n\nUn saludo.",
    messageId: "<demo-1@example.com>",
  },
];

const reminderSeed: Reminder[] = [];

const notificationSeed: NotificationItem[] = [
  { id: nid("not"), type: "TASK", title: "Tienes 2 tareas para hoy", body: "Preparar set y responder emails", read: false, createdAt: iso(T0) },
  { id: nid("not"), type: "EVENT", title: "Reunión de booking a las 9:00", body: "Videollamada · 45 min", read: true, createdAt: iso(T0) },
];

const demoMessageNow = new Date();
const demoWhatsappConnectionId = nid("msg-conn");
const demoTelegramConnectionId = nid("msg-conn");
const demoWhatsappConversationId = nid("msg-conv");
const demoTelegramConversationId = nid("msg-conv");
const demoWhatsappMessages: ChannelMessage[] = [
  { id: nid("msg"), direction: "INBOUND", origin: "CUSTOMER", kind: "TEXT", body: "¿Podemos confirmar la fecha del evento?", attachment: null, hasMedia: false, deliveryStatus: "RECEIVED", providerSentAt: iso(new Date(demoMessageNow.getTime() - 18 * 60_000)), editedAt: null, deletedAt: null, replyToMessageId: null },
  { id: nid("msg"), direction: "OUTBOUND", origin: "OWNER_DEVICE", kind: "TEXT", body: "Sí, la tengo bloqueada para el sábado.", attachment: null, hasMedia: false, deliveryStatus: "READ", providerSentAt: iso(new Date(demoMessageNow.getTime() - 12 * 60_000)), editedAt: null, deletedAt: null, replyToMessageId: null },
];
const demoTelegramMessages: ChannelMessage[] = [
  { id: nid("msg"), direction: "INBOUND", origin: "CUSTOMER", kind: "TEXT", body: "Te envío el rider actualizado en un rato.", attachment: null, hasMedia: false, deliveryStatus: "RECEIVED", providerSentAt: iso(new Date(demoMessageNow.getTime() - 42 * 60_000)), editedAt: null, deletedAt: null, replyToMessageId: null },
];
const demoMessagingConnections: MessagingConnection[] = [
  { id: demoWhatsappConnectionId, provider: "WHATSAPP", status: "ACTIVE", label: "WhatsApp Business · +34 600 123 456", lastError: null, capabilities: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 }, connectedAt: iso(new Date(demoMessageNow.getTime() - 7 * 24 * 60 * 60_000)), revokedAt: null, lastWebhookAt: iso(demoMessageNow) },
  { id: demoTelegramConnectionId, provider: "TELEGRAM", status: "ACTIVE", label: "Telegram Business · @demo", lastError: null, capabilities: { sendText: true, receiveMedia: true, sendMedia: false, readReceipts: false, replyWindowHours: 24 }, connectedAt: iso(new Date(demoMessageNow.getTime() - 4 * 24 * 60 * 60_000)), revokedAt: null, lastWebhookAt: iso(demoMessageNow) },
];
const demoMessagingConversations: MessagingConversation[] = [
  { id: demoWhatsappConversationId, provider: "WHATSAPP", accountLabel: "WhatsApp Business · +34 600 123 456", displayName: "Sala Ámbar", lastMessageAt: demoWhatsappMessages.at(-1)!.providerSentAt, lastInboundAt: demoWhatsappMessages[0].providerSentAt, replyWindowEndsAt: iso(new Date(new Date(demoWhatsappMessages[0].providerSentAt).getTime() + 24 * 60 * 60_000)), canReply: true, unreadCount: 1, preview: "Sí, la tengo bloqueada para el sábado.", lastDirection: "OUTBOUND", scheduledCount: 1, attentionCount: 0 },
  { id: demoTelegramConversationId, provider: "TELEGRAM", accountLabel: "Telegram Business · @demo", displayName: "Lucía Producciones", lastMessageAt: demoTelegramMessages[0].providerSentAt, lastInboundAt: demoTelegramMessages[0].providerSentAt, replyWindowEndsAt: iso(new Date(new Date(demoTelegramMessages[0].providerSentAt).getTime() + 24 * 60 * 60_000)), canReply: true, unreadCount: 1, preview: demoTelegramMessages[0].body, lastDirection: "INBOUND", scheduledCount: 0, attentionCount: 0 },
];
const demoMessagingScheduled: ScheduledReply[] = [{
  id: nid("msg-draft"), conversationId: demoWhatsappConversationId, quotedMessageId: demoWhatsappMessages[0].id, body: "Perfecto, te confirmo los detalles esta tarde.", sendAt: iso(new Date(demoMessageNow.getTime() + 90 * 60_000)), timezone: "Europe/Madrid", status: "AWAITING_CONFIRMATION", draftVersion: 1, confirmedVersion: null, pauseOnActivity: true, provider: "WHATSAPP", recipient: "Sala Ámbar", accountLabel: "WhatsApp Business · +34 600 123 456", replyWindowEndsAt: demoMessagingConversations[0].replyWindowEndsAt, canConfirm: true, errorCode: null, error: null, createdAt: iso(demoMessageNow), updatedAt: iso(demoMessageNow),
}];

/* ---------- Subscriptions ---------- */
// Same rule as the server: charge days are plain YYYY-MM-DD and the anchor day
// clamps to the last day of short months without being rewritten.
function demoYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function demoAddMonths(ymd: string, months: number, anchorDay: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(anchorDay, last)).padStart(2, "0")}`;
}

const subscriptionTagSeed: SubscriptionTag[] = [
  { id: nid("stg"), name: "Ocio", color: "#ec4899" },
  { id: nid("stg"), name: "Hogar y seguros", color: "#10b981" },
  { id: nid("stg"), name: "IA", color: "#6366f1" },
];

const paymentMethodSeed: PaymentMethod[] = [
  { id: nid("pmt"), alias: "Visa nómina", kind: "CARD", last4: "4242", archivedAt: null },
  { id: nid("pmt"), alias: "Cuenta conjunta", kind: "ACCOUNT", last4: "8891", archivedAt: null },
];

function demoSub(over: Partial<Subscription> & { name: string; amountCents: number; anchorDay: number }): Subscription {
  const anchor = over.anchorDay;
  const base = demoYmd(new Date(T0.getFullYear(), T0.getMonth(), Math.min(anchor, 28)));
  return {
    id: nid("sub"), vendor: null, notes: null, currency: "EUR", cycleMonths: 1,
    status: "ACTIVE", nextChargeDate: base >= demoYmd(T0) ? base : demoAddMonths(base, 1, anchor),
    paymentMethodId: paymentMethodSeed[0].id, paymentMethod: paymentMethodSeed[0],
    alertHour: 9, notifyInApp: true, notifyTelegram: false, notifyEmail: false,
    alertDaysBefore: [7, 1, 0], tags: [], ...over,
  };
}

const subscriptionSeed: Subscription[] = [
  demoSub({ name: "Netflix", vendor: "Netflix Intl.", amountCents: 1399, anchorDay: 5, tags: [subscriptionTagSeed[0]] }),
  demoSub({ name: "Spotify Premium", amountCents: 1199, anchorDay: 12, tags: [subscriptionTagSeed[0]] }),
  demoSub({ name: "ChatGPT Plus", amountCents: 2300, anchorDay: 20, tags: [subscriptionTagSeed[2]], paymentMethodId: paymentMethodSeed[0].id, paymentMethod: paymentMethodSeed[0] }),
  demoSub({ name: "Seguro del hogar", amountCents: 28400, anchorDay: 31, cycleMonths: 12, tags: [subscriptionTagSeed[1]], paymentMethodId: paymentMethodSeed[1].id, paymentMethod: paymentMethodSeed[1] }),
];

const subscriptionChargeSeed: SubscriptionCharge[] = [
  { id: nid("chg"), subscriptionId: subscriptionSeed[0].id, dueDate: demoAddMonths(subscriptionSeed[0].nextChargeDate, -1, 5), paidAt: iso(addDays(T0, -30)), amountCents: 1399, status: "PAID", methodLabel: "Visa nómina ····4242" },
  { id: nid("chg"), subscriptionId: subscriptionSeed[1].id, dueDate: demoAddMonths(subscriptionSeed[1].nextChargeDate, -1, 12), paidAt: iso(addDays(T0, -22)), amountCents: 1199, status: "PAID", methodLabel: "Visa nómina ····4242" },
];

/* ------------------------------------------------------------------ */
/* In-memory store — reset on every reload (module re-eval)            */
/* ------------------------------------------------------------------ */
interface DemoState {
  tasks: Task[]; events: EventItem[]; notes: Note[]; projects: Project[]; tags: Tag[];
  habits: Habit[]; habitLogs: Record<string, string[]>; goals: Goal[]; inbox: InboxItem[];
  mailboxes: Mailbox[]; mails: Record<string, MailMessage[]>;
  reminders: Reminder[]; notifications: NotificationItem[]; timeRunning: string | null; timeStart: number | null;
  messagingConnections: MessagingConnection[]; messagingConversations: MessagingConversation[]; messagingMessages: Record<string, ChannelMessage[]>; messagingScheduled: ScheduledReply[];
  paymentMethods: PaymentMethod[]; subscriptions: Subscription[]; subscriptionCharges: SubscriptionCharge[]; subscriptionTags: SubscriptionTag[];
}
const S: DemoState = {
  tasks: JSON.parse(JSON.stringify(taskSeed)),
  events: JSON.parse(JSON.stringify(eventSeed)),
  notes: JSON.parse(JSON.stringify(noteSeed)),
  projects: JSON.parse(JSON.stringify(projectSeed)),
  tags: JSON.parse(JSON.stringify(tagSeed)),
  habits: JSON.parse(JSON.stringify(habitSeed)),
  habitLogs: habitLogSeed,
  goals: JSON.parse(JSON.stringify(goalSeed)),
  inbox: JSON.parse(JSON.stringify(inboxSeed)),
  mailboxes: JSON.parse(JSON.stringify(mailboxSeed)),
  mails: { [mailboxSeed[0].id]: JSON.parse(JSON.stringify(mailMessageSeed)) },
  reminders: JSON.parse(JSON.stringify(reminderSeed)),
  notifications: JSON.parse(JSON.stringify(notificationSeed)),
  messagingConnections: JSON.parse(JSON.stringify(demoMessagingConnections)),
  messagingConversations: JSON.parse(JSON.stringify(demoMessagingConversations)),
  messagingMessages: { [demoWhatsappConversationId]: JSON.parse(JSON.stringify(demoWhatsappMessages)), [demoTelegramConversationId]: JSON.parse(JSON.stringify(demoTelegramMessages)) },
  messagingScheduled: JSON.parse(JSON.stringify(demoMessagingScheduled)),
  paymentMethods: JSON.parse(JSON.stringify(paymentMethodSeed)),
  subscriptionTags: JSON.parse(JSON.stringify(subscriptionTagSeed)),
  subscriptions: JSON.parse(JSON.stringify(subscriptionSeed)),
  subscriptionCharges: JSON.parse(JSON.stringify(subscriptionChargeSeed)),
  timeRunning: null, timeStart: null,
};

const emptyKeys = () => ({
  opencode: { hasKey: true, valid: true },
  openrouter: { hasKey: false, valid: false },
  custom: { hasKey: false, valid: false },
});

const mascot = {
  enabled: true,
  character: "calen" as "calen" | "tashi" | "nubo" | "foco" | "posti" | "orbi",
  provider: "opencode",
  model: "auto-free",
  baseUrl: null as string | null,
  modelsUrl: null as string | null,
  hasFootballKey: false,
  keys: emptyKeys(),
};

function mascotPublic() {
  const k = mascot.keys[mascot.provider as keyof typeof mascot.keys] ?? { hasKey: false, valid: false };
  return {
    enabled: mascot.enabled,
    character: mascot.character,
    provider: mascot.provider,
    model: mascot.model,
    baseUrl: mascot.baseUrl,
    modelsUrl: mascot.modelsUrl,
    hasKey: k.hasKey,
    keyValid: k.valid,
    keys: mascot.keys,
    hasFootballKey: mascot.hasFootballKey,
  };
}

type DemoRadioAction = {
  type: "radio";
  action: "play" | "pause" | "set_station";
  stationId?: string;
};

function demoRadioAction(text: string): { reply: string; action: DemoRadioAction } | null {
  const q = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(pausa|pausar|para|deten|silencia)/.test(q) && /radio|emisora|musica/.test(q)) {
    return { reply: "Hecho, he pausado la radio. 🔇", action: { type: "radio", action: "pause" } };
  }
  const station = matchRadioStation(text);
  if (station && /\b(pon|cambia|cambiar|sintoniza|escucha|reproduce|reproducir)\b/.test(q)) {
    return {
      reply: `Hecho, reproduzco ${station.name}. 🎶`,
      action: { type: "radio", action: "play", stationId: station.id },
    };
  }
  if (/\b(reproduce|reproducir|reanuda|enciende)\b/.test(q) && /radio|emisora|musica/.test(q)) {
    return { reply: "Hecho, reproduzco la emisora seleccionada. 🎶", action: { type: "radio", action: "play" } };
  }
  return null;
}

function demoMascotReply(text: string): string {
  const q = text.toLowerCase();
  if (/cofre|keepass|1password|contraseñas?|claves? de (acceso|sitio)|password vault/.test(q) && !/tarea|recordatorio/.test(q)) {
    return "Kontraseñas está en APP's. Yo no puedo abrir ni listar esas claves.";
  }
  if (/\btelegram\b/.test(q) && /(aviso|avisos|notific|tarea)/.test(q)) {
    const disable = /desactiv|quita|apaga|sin aviso|no avises/.test(q);
    const open = S.tasks.filter((t) => !t.deletedAt && t.status !== "COMPLETED");
    const hit = open.find((t) => t.title && q.includes(t.title.toLowerCase())) ?? open[open.length - 1];
    if (!hit) return "No encuentro una tarea para cambiar el aviso de Telegram.";
    hit.notifyTelegram = !disable;
    return disable
      ? `Hecho: he desactivado el aviso de Telegram de «${hit.title}».`
      : `Hecho: he activado el aviso de Telegram de «${hit.title}».`;
  }
  if (/tarea|task/.test(q)) {
    const title = text.replace(/^(crea(me|rme)?|añade|pon)\s*(una\s*)?(tarea\s*)?/i, "").trim() || "Tarea de la mascota";
    const dueDay = /hoy|today/.test(q) ? today() : addDays(today(), 1);
    const due = iso(dueDay);
    const t: Task = {
      id: nid("tsk"), title: title.slice(0, 80), dueDate: due, hasTime: false, priority: "NORMAL", status: "PENDING",
      timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), subtasks: [], tags: [], goals: [], attachments: [],
    };
    S.tasks.push(t);
    return `Listo: he creado la tarea «${t.title}» para mañana.`;
  }
  if (/recordatorio|aviso|recuerd/.test(q)) {
    const title = text.replace(/^(crea(me|rme)?|añade|pon)\s*(un\s*)?(recordatorio\s*)?/i, "").trim() || "Recordatorio";
    const when = iso(at(addDays(T0, 1), 21, 0));
    S.reminders.push({ id: nid("rem"), title: title.slice(0, 80), remindAt: when, scheduleDaily: false, targetType: "NONE" });
    return `Hecho: te avisaré mañana a las 21:00 de «${title.slice(0, 80)}».`;
  }
  if (/c[oó]digo|program[ae]|javascript|python|noticia|pol[ií]tica/.test(q) && !/tarea|recordatorio|receta|ejercicio/.test(q)) {
    return "Solo te ayudo con la agenda, el clima, recetas, ejercicio básico y el fútbol. ¿Qué hay en tu día?";
  }
  if (/receta|men[uú]|cena|desayuno|comida/.test(q)) {
    return "En la demo no consulto recetas reales. En local te propongo menús o busco una receta.";
  }
  if (/ejercicio|estiramiento|sentadilla|flexiones|forma f[ií]sica/.test(q)) {
    return "En la demo: 10 sentadillas, 8 flexiones y 20 s de plancha. En local te armo una rutina corta.";
  }
  if (/(clima|temperatura|llueve|llover|lluvia|pron[oó]stico|qu[eé]\s+tiempo|el\s+tiempo|hace\s+calor|hace\s+fr[ií]o)/.test(q) && !/tarea|recordatorio/.test(q)) {
    return "Ahora (demo): Madrid 24 °C, mayormente despejado, sensación 23 °C, viento 10 km/h. Mañana: 19–31 °C, poco nublado. En local consulto Open-Meteo de verdad.";
  }
  if (/mañana|tomorrow/.test(q)) {
    const day = keyOf(addDays(T0, 1));
    const list = S.tasks.filter((t) => t.dueDate && keyOf(new Date(t.dueDate)) === day && t.status !== "COMPLETED");
    if (!list.length) return "Mañana no tienes tareas pendientes. ¿Quieres que te cree alguna?";
    return `Mañana tienes:\n${list.map((t) => `• ${t.title}`).join("\n")}`;
  }
  if (/partido|bar[cç]a|barcelona|marcador|resultado/.test(q)) {
    return "Próximo (demo): Barça vs Athletic · jueves 21:00. En local consulto football-data.org de verdad.";
  }
  return "En la demo no hay un modelo real, pero puedo crear tareas y recordatorios si me lo pides. ¡Prueba a decirme «crea una tarea»!";
}

const DEMO_AVATAR_KEY = "dayly.demo.avatar";

function readStoredAvatar(): string | null {
  try {
    const v = localStorage.getItem(DEMO_AVATAR_KEY);
    return v && v.startsWith("data:image/") ? v : null;
  } catch {
    return null;
  }
}

const demoUser: PublicUser = {
  id: "u-demo", email: "demo@example.com", name: "Alex Demo", roleId: "user", roleName: "USER",
  nick: "·°¤*(¯`★´¯)*¤°· ALEXIS ·°¤*(¯`★´¯)*¤°·", nickColor: "#ec4899", nickBold: true,
  nickSegments: null,
  subnick: "Escuchando: latin tech house · sesión el sábado",
  emailVerifiedAt: iso(T0), twoFactorEnabled: true, timezone: "Europe/Madrid", weatherCity: null, language: "es",
  firstDayOfWeek: 1, timeFormat24: true, theme: "LIGHT", themeScheduleEnabled: false, themeDarkStartMin: 1200, themeDarkEndMin: 360, skin: "ink", density: "comfortable",
  calendarStartHour: 8, calendarEndHour: 20, avatarUrl: readStoredAvatar(), wallpaper: "none", notifySound: "bell", notifySoundEnabled: true, mustChangePassword: false,
  quickPinEnabled: false, quickPinConfigured: false,
  notifyReminders: true, notifyEvents: true, notifyTasks: true, notifyEmail: false,
};
let demoQuickPin: string | null = null;

const DEMO_PLAIN_KEYS = new Set([
  "password", "pass", "passwd", "username", "user", "login", "title", "secret",
  "notes", "note", "url", "totp", "otp", "content", "plaintext", "item", "name",
  "credential", "clave", "contraseña", "contrasena", "otpsecret", "otp_secret",
  "folder", "folders", "tag", "tags", "etiqueta",
  "passwordhistory", "password_history", "passwordchangedat", "changedat", "history",
  "kind", "fields", "cardnumber", "card_number", "cvv", "ssid", "wifi",
]);

type DemoVaultItem = { id: string; nonce: string; ciphertext: string; version: number; createdAt: string; updatedAt: string };
const demoVault: {
  exists: boolean;
  unlocked: boolean;
  pendingEmail: boolean;
  kdf: string;
  kdfIterations: number;
  salt: string;
  checkNonce: string;
  checkCipher: string;
  items: DemoVaultItem[];
} = {
  exists: false, unlocked: false, pendingEmail: false, kdf: "pbkdf2-sha256", kdfIterations: 600_000,
  salt: "", checkNonce: "", checkCipher: "", items: [],
};

function demoRejectPlain(body: unknown) {
  if (!body || typeof body !== "object") return;
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (DEMO_PLAIN_KEYS.has(key.toLowerCase())) demoFail(400);
  }
}

function demoRequireTotp(code: unknown) {
  if (!demoUser.twoFactorEnabled) demoFail(403, "Activa la verificación en dos pasos antes de usar el Cofre.");
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) demoFail(403, "Código de verificación no válido.");
}

function projectById(id?: string | null) { return S.projects.find((p) => p.id === id); }

function resolveTaskTags(ids: unknown): Tag[] {
  if (!Array.isArray(ids)) return [];
  const out: Tag[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const tag = S.tags.find((t) => t.id === id);
    if (tag) out.push(tag);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers to compute expected response shapes                         */
/* ------------------------------------------------------------------ */
function decorateTask(t: Task): Task {
  return {
    ...t,
    project: t.projectId ? { id: t.projectId, name: projectById(t.projectId)?.name ?? "—", color: projectById(t.projectId)?.color ?? null } : undefined,
    tags: t.tags ?? [],
    subtasks: t.subtasks ?? [],
    attachments: t.attachments ?? [],
  };
}
function dashboard() {
  const start = today(); const end = addDays(start, 1);
  const now = new Date();
  const pending = S.tasks.filter((t) => t.status !== "COMPLETED").length;
  const completed = S.tasks.filter((t) => t.status === "COMPLETED" && t.completedAt).length;
  const overdue = S.tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < now).length;
  const events = S.events.filter((e) => new Date(e.startAt) >= start && new Date(e.startAt) < end);
  const todaysTasks = S.tasks.filter((t) => t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end && t.status !== "COMPLETED");
  return { pending, completed, overdue, activeProjects: 1, activeGoals: S.goals.filter((g) => g.status !== "COMPLETED").length, events, todaysTasks, habitCompletionsToday: 6, timeTodaySeconds: 54 * 60 + 12, startOfDay: iso(start) };
}
function myDay(dateKey?: string) {
  const base = dateKey ? new Date(dateKey + "T12:00:00") : today();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = addDays(start, 1);
  const now = new Date();
  type Item = { id: string; title: string; kind: "event" | "task"; at: string; end?: string; color?: string | null };
  const events = S.events.filter((e) => new Date(e.startAt) >= start && new Date(e.startAt) < end);
  const tasks = S.tasks.filter((t) => t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end && t.status !== "CANCELLED");
  const eItems: Item[] = events.map((e) => ({ id: e.id, title: e.title, kind: "event", at: e.startAt, end: e.endAt, color: e.color }));
  const tItems: Item[] = tasks.map((t) => ({ id: t.id, title: t.title, kind: "task", at: t.dueDate!, color: t.color }));
  const all = [...eItems, ...tItems];
  const nowItems = all.filter((i) => now >= new Date(i.at) && (!i.end || now <= new Date(i.end)));
  const next = all.filter((i) => now < new Date(i.at)).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 8);
  const done = tasks.filter((t) => t.status === "COMPLETED");
  const ovd = tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < now);
  const total = tasks.length; const progress = total ? Math.round((done.length / total) * 100) : 0;
  return { date: iso(start), now: nowItems, next, done, overdue: ovd, progress, counts: { total, done: done.length, overdue: ovd.length } };
}
function stats() {
  const mk = (completed: number, timeSeconds: number, habit: number) => ({ completed, created: 14, completionRate: Math.round((completed / 16) * 100), completedProjects: 1, timeSeconds, habitCompletions: habit, overdue: 1 });
  return { today: mk(4, 54 * 60, 3), week: mk(18, 6 * 3600 + 42 * 60, 21), month: mk(62, 26 * 3600, 84), pendingByPriority: [{ priority: "URGENT", _count: { _all: 1 } }, { priority: "HIGH", _count: { _all: 2 } }, { priority: "NORMAL", _count: { _all: 3 } }, { priority: "LOW", _count: { _all: 1 } }] };
}
function search(q: string) {
  const lq = q.toLowerCase();
  const f = (s: string) => s.toLowerCase().includes(lq);
  return {
    tasks: S.tasks.filter((t) => f(t.title)).slice(0, 8).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, color: t.color })),
    events: S.events.filter((e) => f(e.title)).slice(0, 8).map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, color: e.color })),
    notes: S.notes.filter((n) => f(n.title)).slice(0, 8).map((n) => ({ id: n.id, title: n.title, pinned: n.pinned })),
    projects: S.projects.filter((p) => f(p.name)).slice(0, 8).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    goals: S.goals.filter((g) => f(g.title)).slice(0, 8).map((g) => ({ id: g.id, title: g.title })),
    habits: S.habits.filter((h) => f(h.name)).slice(0, 8).map((h) => ({ id: h.id, name: h.name, color: h.color })),
  };
}
function habitsList() {
  const todayK = keyOf(T0);
  return S.habits.map((h) => {
    const logs = S.habitLogs[h.id] ?? [];
    let current = 0; let cursor = todayK; let c = new Date();
    const has = (k: string) => logs.includes(k);
    if (!has(todayK)) { cursor = keyOf(addDays(c, -1)); }
    while (has(cursor)) { current++; c = addDays(c, -1); cursor = keyOf(c); }
    const doneKeys = logs;
    return { ...h, current, longest: cacheLongest(h.id), logs: doneKeys.map((k) => ({ date: k + "T12:00:00.000Z", done: true })) };
  });
}
const longestCache: Record<string, number> = {};
function cacheLongest(id: string) { return longestCache[id] ?? 6; }

/* ------------------------------------------------------------------ */
/* Chat (demo)                                                        */
/* ------------------------------------------------------------------ */
type DemoChatLink = {
  linkId: string;
  user: { id: string; name: string; avatarUrl: string | null; status?: string; nick?: string | null; nickColor?: string | null; nickBold?: boolean; subnick?: string | null };
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
  unreadCount: number;
  lastMessageAt: string | null;
  otherBuzzAt: string | null;
  wallpaper: string | null;
  lastMessage: string | null;
  lastMessageMine: boolean | null;
  otherReadAt: string | null;
  muted: boolean;
  blockedByMe: boolean;
  requestedByMe: boolean;
  createdAt: string;
};

type DemoChatMessage = { id: string; senderId: string; kind: "TEXT" | "BUZZ" | "GIF"; body: string | null; createdAt: string };

type DemoChatGroupMember = { id: string; name: string; avatarUrl: string | null; status?: string; isOwner?: boolean };
type DemoChatGroup = {
  groupId: string;
  name: string;
  avatarUrl?: string | null;
  ownerId: string;
  isOwner: boolean;
  members: DemoChatGroupMember[];
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastMessageMine: boolean | null;
  muted: boolean;
  wallpaper: string | null;
  createdAt: string;
};

function demoLink(id: string, name: string, unread: number, flair?: { nick?: string; nickColor?: string; nickBold?: boolean; subnick?: string }): DemoChatLink {
  return {
    linkId: id,
    user: {
      id: `usr-${id}`, name, avatarUrl: null, status: unread > 0 ? "ONLINE" : "AWAY",
      nick: flair?.nick ?? null, nickColor: flair?.nickColor ?? null,
      nickBold: Boolean(flair?.nickBold), subnick: flair?.subnick ?? null,
    },
    status: "ACCEPTED",
    wallpaper: null,
    lastMessage: null,
    lastMessageMine: null,
    otherReadAt: iso(new Date()),
    muted: false,
    unreadCount: unread,
    lastMessageAt: iso(new Date()),
    otherBuzzAt: null,
    blockedByMe: false,
    requestedByMe: false,
    createdAt: iso(new Date()),
  };
}

type DemoBrowserMark = { id: string; url: string; title: string | null; at: string; visits?: number };

const browserDemo = {
  settings: { historyEnabled: true, homeUrl: null as string | null },
  bookmarks: [
    { id: "bm-demo", url: "https://tu-dominio.example", title: "Dayly", at: iso(new Date()) },
  ] as DemoBrowserMark[],
  visits: [] as DemoBrowserMark[],
};

const chatDemo = {
  tick: 0,
  identity: { friendCode: "CALEN-D3M01", discoverableByEmail: true, buzzEnabled: true, sound: "soundchat", status: "ONLINE", gifsAvailable: false },
  friends: [
    { ...demoLink("lnk-ana", "Ana Ruiz", 2, { nick: "╰☆╮ AnItA ╰☆╮", nickColor: "#8b5cf6", nickBold: true, subnick: "cuenta atrás para el finde ✈" }), lastMessage: "Hay sesión a las 20:30", lastMessageMine: false },
    demoLink("lnk-leo", "Leo Márquez", 0, { nick: "𝕷𝖊𝖔", subnick: "Escuchando: Daft Punk - Digital Love" }),
  ],
  incoming: [{ ...demoLink("lnk-sofia", "Sofía Peña", 0), status: "PENDING" as const }],
  outgoing: [] as DemoChatLink[],
  groups: [
    {
      groupId: "grp-cena",
      name: "Cena del sábado",
      ownerId: demoUser.id,
      isOwner: true,
      members: [
        { id: demoUser.id, name: demoUser.name, avatarUrl: null, status: "ONLINE", isOwner: true },
        { id: "usr-lnk-ana", name: "Ana Ruiz", avatarUrl: null, status: "ONLINE" },
        { id: "usr-lnk-leo", name: "Leo Márquez", avatarUrl: null, status: "AWAY" },
        { id: "usr-mara", name: "Mara Sol", avatarUrl: null, status: "ONLINE" },
      ],
      unreadCount: 1,
      lastMessageAt: iso(new Date()),
      lastMessage: "¿A las nueve entonces?",
      lastMessageMine: false,
      muted: false,
      wallpaper: null,
      createdAt: iso(new Date()),
    },
  ] as DemoChatGroup[],
  messages: {
    "lnk-ana": [
      { id: "m1", senderId: "usr-lnk-ana", kind: "TEXT", body: "¿Vamos al cine el viernes?", createdAt: iso(new Date(Date.now() - 3_600_000)) },
      { id: "m2", senderId: "usr-lnk-ana", kind: "TEXT", body: "Hay sesión a las 20:30", createdAt: iso(new Date(Date.now() - 3_500_000)) },
    ],
    "lnk-leo": [],
    "grp-cena": [
      { id: "g1", senderId: "usr-lnk-ana", kind: "TEXT", body: "He reservado para cuatro", createdAt: iso(new Date(Date.now() - 5_400_000)) },
      { id: "g2", senderId: "usr-lnk-leo", kind: "TEXT", body: "Perfecto, llevo el postre", createdAt: iso(new Date(Date.now() - 3_600_000)) },
      { id: "g3", senderId: "usr-lnk-ana", kind: "TEXT", body: "¿A las nueve entonces?", createdAt: iso(new Date(Date.now() - 600_000)) },
    ],
  } as Record<string, DemoChatMessage[]>,
  /** Keeps the list preview in step with the thread. */
  note(linkId: string, text: string, mine: boolean) {
    const friend = this.friends.find((f) => f.linkId === linkId);
    if (!friend) return;
    friend.lastMessage = text;
    friend.lastMessageMine = mine;
    friend.lastMessageAt = iso(new Date());
  },
  /** A canned answer, so the poll visibly does something in the demo. */
  replyLater(linkId: string) {
    const friend = this.friends.find((f) => f.linkId === linkId);
    if (!friend) return;
    setTimeout(() => {
      (this.messages[linkId] ??= []).push({
        id: nid("msg"), senderId: friend.user.id, kind: "TEXT",
        body: "Esto es una demo: el mensaje no sale de tu navegador.", createdAt: iso(new Date()),
      });
      this.note(linkId, "Esto es una demo: el mensaje no sale de tu navegador.", false);
      this.tick += 1;
    }, 1500);
  },
  /** Buzz back once, so the shake can actually be seen. */
  buzzBack(linkId: string) {
    const friend = this.friends.find((f) => f.linkId === linkId);
    if (!friend) return;
    setTimeout(() => {
      friend.otherBuzzAt = iso(new Date());
      this.note(linkId, "Zumbido", false);
      (this.messages[linkId] ??= []).push({
        id: nid("msg"), senderId: friend.user.id, kind: "BUZZ", body: null, createdAt: iso(new Date()),
      });
      this.tick += 1;
    }, 1800);
  },
};

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */
export async function demoHandle(method: string, urlPath: string, body: unknown, query: Record<string, string>): Promise<unknown> {
  const p = urlPath.replace(/^\/api/, "");
  const send = (code: number, data: unknown) => { if (code >= 400) { const e = new Error("demo error"); (e as any).status = code; throw e; } return data; };
  const ok = (d: unknown) => send(200, d);


  // ---------- Auth ----------
  if (method === "GET" && p === "/auth/me") return ok({ user: demoUser, sessionId: "demo" });
  if (method === "GET" && p === "/app/installers") return ok({ shellVersion: SHELL_VERSION, windows: null, android: null });
  if (method === "GET" && p === "/spotify/config") return ok({ enabled: true, configured: true, available: true, operational: true, connected: false, connection: null });
  if (method === "POST" && p === "/spotify/oauth/start") demoFail(400, "Spotify real no se conecta en la demo.");
  if (method === "GET" && p === "/admin/spotify") return ok({ spotify: { enabled: true, configured: true, operational: true, clientId: "demo-spotify" } });
  if (method === "PATCH" && p === "/admin/spotify") return ok({ spotify: { enabled: true, configured: true, operational: true, clientId: "demo-spotify" } });
  if (method === "GET" && p === "/radio/stream-info") return ok({ kbps: 128, codec: "mp3" });
  if (method === "POST" && p === "/auth/login") return ok({ token: "demo", user: demoUser });
  if (method === "POST" && p === "/auth/register") return ok({ token: "demo", user: demoUser });
  if (method === "POST" && p === "/auth/logout") {
    demoVault.unlocked = false;
    demoVault.pendingEmail = false;
    return ok({ ok: true });
  }
  if (method === "POST" && p === "/auth/forgot-password") return ok({ ok: true });
  if (method === "POST" && p === "/auth/reset-password") return ok({ ok: true });
  if (method === "POST" && p === "/auth/quick-pin/verify") {
    const b = body as { pin?: string } | undefined;
    if (!demoUser.quickPinEnabled || !demoQuickPin) demoFail(400, "El PIN rápido no está activado.");
    if (b?.pin !== demoQuickPin) demoFail(403, "PIN incorrecto.");
    return ok({ ok: true });
  }
  if (method === "POST" && p === "/auth/quick-pin") {
    const b = body as { pin?: string; currentPin?: string } | undefined;
    if (!/^\d{4}$/.test(b?.pin ?? "")) demoFail(422, "El PIN debe tener exactamente 4 dígitos.");
    if (demoQuickPin && b?.currentPin !== demoQuickPin) demoFail(403, "El PIN actual no es correcto.");
    demoQuickPin = b!.pin!;
    demoUser.quickPinConfigured = true;
    demoUser.quickPinEnabled = true;
    return ok({ ok: true });
  }
  if (method === "PATCH" && p === "/auth/quick-pin") {
    const b = body as { enabled?: boolean; currentPin?: string } | undefined;
    if (b?.enabled && !demoQuickPin) demoFail(400, "Configura primero un PIN rápido.");
    if (!b?.enabled && demoQuickPin && b?.currentPin !== demoQuickPin) demoFail(403, "El PIN actual no es correcto.");
    demoUser.quickPinEnabled = b?.enabled === true;
    return ok({ ok: true });
  }
  if (method === "DELETE" && p === "/auth/quick-pin") {
    const b = body as { currentPin?: string } | undefined;
    if (demoQuickPin && b?.currentPin !== demoQuickPin) demoFail(403, "El PIN actual no es correcto.");
    demoQuickPin = null;
    demoUser.quickPinEnabled = false;
    demoUser.quickPinConfigured = false;
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/auth/passkeys") return ok({ passkeys: [] });
  if (method === "POST" && p === "/auth/passkeys/register/options") demoFail(400, "Las passkeys no están disponibles en la demo.");
  if (method === "POST" && p === "/auth/passkeys/login/options") demoFail(400, "Las passkeys no están disponibles en la demo.");
  if (method === "POST" && p === "/auth/passkeys/login") demoFail(400, "Las passkeys no están disponibles en la demo.");

  // ---------- User / prefs ----------
  if (method === "PATCH" && p === "/users/me/preferences") {
    if (body && typeof body === "object") Object.assign(demoUser, body);
    return ok({ user: demoUser });
  }
  if (method === "PATCH" && p === "/users/me") {
    // Same allowlist as the real endpoint: the mock must not let you assign
    // yourself a role either, or the demo would teach the wrong thing.
    const b = (body ?? {}) as Record<string, unknown>;
    for (const k of ["name", "avatarUrl", "nick", "nickColor", "nickBold", "subnick", "nickSegments"] as const) {
      if (b[k] !== undefined) (demoUser as unknown as Record<string, unknown>)[k] = b[k];
    }
    try {
      if (demoUser.avatarUrl) localStorage.setItem(DEMO_AVATAR_KEY, demoUser.avatarUrl);
      else localStorage.removeItem(DEMO_AVATAR_KEY);
    } catch { /* quota */ }
    return ok({ user: demoUser });
  }
  if (method === "GET" && p === "/users/me") return ok({ user: demoUser });
  if (method === "POST" && p === "/users/me/wallpaper") {
    const file = body instanceof FormData ? body.get("file") : null;
    if (!(file instanceof Blob)) demoFail(400, "Sube una foto.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("No se pudo leer la foto."));
      reader.readAsDataURL(file);
    });
    try { localStorage.setItem("dayly.demo.wallpaper", dataUrl); } catch { /* quota */ }
    demoUser.wallpaper = "custom";
    return ok({ user: demoUser });
  }
  if (method === "DELETE" && p === "/users/me/wallpaper") {
    try { localStorage.removeItem("dayly.demo.wallpaper"); } catch { /* quota */ }
    demoUser.wallpaper = "none";
    return ok({ user: demoUser });
  }

  // ---------- Dashboard / calendar ----------
  if (method === "GET" && p === "/calendar/dashboard") return ok(dashboard());
  if (method === "GET" && p === "/calendar/my-day") return ok(myDay(query.date));
  if (method === "GET" && p === "/calendar") {
    const ev = S.events.filter((e) => !query.from || new Date(e.endAt) >= new Date(query.from)).filter((e) => !query.to || new Date(e.startAt) <= new Date(query.to));
    const tk = S.tasks.filter((t) => {
      if (!t.dueDate || t.status === "COMPLETED") return false;
      const start = new Date(t.dueDate);
      const end = new Date(t.dueEndDate ?? t.dueDate);
      if (query.from && end < new Date(query.from)) return false;
      if (query.to && start > new Date(query.to)) return false;
      return true;
    });
    return ok({ events: ev, tasks: tk });
  }
  if (method === "GET" && p === "/calendar/feed-url") return ok({ token: "demo", url: `${typeof window !== "undefined" ? window.location.origin : ""}/api/calendar/feed/demo.ics` });
  if (method === "POST" && p === "/calendar/feed-url") return ok({ token: "demo", url: `${typeof window !== "undefined" ? window.location.origin : ""}/api/calendar/feed/demo.ics` });

  // ---------- Tasks ----------
  if (method === "GET" && p === "/tasks") {
    let list = S.tasks.filter((t) => !t.deletedAt);
    if (query.due === "today" || query.view === "today") list = list.filter((t) => t.dueDate && keyOf(new Date(t.dueDate)) === keyOf(T0));
    if (query.due === "overdue" || query.view === "overdue") list = list.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < new Date());
    if (query.due === "upcoming" || query.view === "upcoming") list = list.filter((t) => t.dueDate && new Date(t.dueDate) > new Date());
    if (query.due === "nominal" || query.view === "unscheduled") list = list.filter((t) => !t.dueDate);
    if (query.priority) list = list.filter((t) => t.priority === query.priority);
    if (query.projectId) list = list.filter((t) => t.projectId === query.projectId);
    if (query.q) list = list.filter((t) => t.title.toLowerCase().includes((query.q as string).toLowerCase()));
    if (query.includeCompleted !== "true") list = list.filter((t) => t.status !== "COMPLETED");
    return ok({ tasks: list.map(decorateTask) });
  }
  if (method === "GET" && p === "/tasks/smart") {
    const now = new Date();
    const start = today(); const end = addDays(start, 1);
    const base = (t: Task) => t.status !== "COMPLETED";
    const overdue = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) < now).length;
    const todayL = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) < end);
    const upcoming = S.tasks.filter((t) => base(t) && t.dueDate && new Date(t.dueDate) >= end).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()).slice(0, 12);
    const important = S.tasks.filter((t) => base(t) && (t.priority === "HIGH" || t.priority === "URGENT"));
    const unscheduled = S.tasks.filter((t) => base(t) && !t.dueDate).length;
    return ok({ count: { overdue, today: todayL.length, unscheduled }, today: todayL.map(decorateTask), upcoming: upcoming.map(decorateTask), important: important.map(decorateTask) });
  }
  let m: RegExpMatchArray | null;

  // ---------- Chat ----------
  // The published demo intercepts every API call, so a section without mocks
  // would simply crash there.
  if (method === "GET" && p === "/chat/me") return ok(chatDemo.identity);
  if (method === "POST" && p === "/chat/friend-code/rotate") {
    chatDemo.identity.friendCode = `${nid("K").slice(0, 5).toUpperCase()}-DEM01`;
    return ok({ friendCode: chatDemo.identity.friendCode });
  }
  if (method === "PATCH" && p === "/chat/settings") {
    Object.assign(chatDemo.identity, body as object);
    return ok({ settings: chatDemo.identity });
  }
  if (method === "GET" && p === "/chat/gifs/favorites") return ok({ favorites: [] });
  if (method === "GET" && p === "/chat/gifs") return ok({ results: [], blockedHosts: false });
  if (method === "GET" && p === "/chat/friends") {
    return ok({
      friends: chatDemo.friends,
      requests: { incoming: chatDemo.incoming, outgoing: chatDemo.outgoing },
    });
  }
  if (method === "POST" && p === "/chat/requests") return ok({ ok: true, message: "Solicitud enviada (demo)." });
  if (method === "POST" && (m = p.match(/^\/chat\/requests\/([^/]+)\/(accept|decline|cancel)$/))) {
    const request = chatDemo.incoming.find((r) => r.linkId === m![1]);
    chatDemo.incoming = chatDemo.incoming.filter((r) => r.linkId !== m![1]);
    if (m[2] === "accept" && request) {
      chatDemo.friends.push({ ...request, status: "ACCEPTED", unreadCount: 0 });
      chatDemo.messages[request.linkId] = [];
    }
    return ok({ ok: true });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/friends\/([^/]+)\/(block|unblock)$/))) {
    const friend = chatDemo.friends.find((f) => f.linkId === m![1]);
    if (friend) {
      friend.blockedByMe = m[2] === "block";
      friend.status = m[2] === "block" ? "BLOCKED" : "ACCEPTED";
    }
    return ok({ link: friend });
  }
  if (method === "PATCH" && (m = p.match(/^\/chat\/friends\/([^/]+)\/prefs$/))) {
    const friend = chatDemo.friends.find((f) => f.linkId === m![1]);
    const muted = Boolean((body as { muted?: boolean } | undefined)?.muted);
    if (friend) friend.muted = muted;
    return ok({ muted });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/friends\/([^/]+)\/clear$/))) {
    const linkId = m![1];
    chatDemo.messages[linkId] = [];
    const friend = chatDemo.friends.find((f) => f.linkId === linkId);
    if (friend) { friend.lastMessage = null; friend.lastMessageMine = null; friend.unreadCount = 0; }
    return ok({ clearedAt: iso(new Date()) });
  }
  if (method === "PATCH" && (m = p.match(/^\/chat\/friends\/([^/]+)\/wallpaper$/))) {
    const friend = chatDemo.friends.find((f) => f.linkId === m![1]);
    const wallpaper = (body as { wallpaper?: string | null } | undefined)?.wallpaper ?? null;
    if (friend) friend.wallpaper = wallpaper;
    return ok({ wallpaper });
  }
  if (method === "DELETE" && (m = p.match(/^\/chat\/friends\/([^/]+)$/))) {
    chatDemo.friends = chatDemo.friends.filter((f) => f.linkId !== m![1]);
    return ok({ ok: true });
  }
  if (method === "GET" && (m = p.match(/^\/chat\/threads\/([^/]+)\/messages$/))) {
    return ok({ messages: chatDemo.messages[m![1]] ?? [], nextBefore: null });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/threads\/([^/]+)\/messages$/))) {
    const linkId = m![1];
    const message = { id: nid("msg"), senderId: demoUser.id, kind: "TEXT" as const, body: (body as any).body, createdAt: iso(new Date()) };
    (chatDemo.messages[linkId] ??= []).push(message);
    chatDemo.note(linkId, message.body as string, true);
    chatDemo.replyLater(linkId);
    return send(201, { message });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/buzz$/))) {
    // Same two-minute-per-person cooldown as the API, so the demo shows the
    // limit rather than letting you rattle the group forever.
    const groupId = m![1];
    const last = demoGroupBuzz.get(groupId) ?? 0;
    if (Date.now() - last < 2 * 60_000) demoFail(429, "Ya has zumbado al grupo hace poco. Espera un par de minutos.");
    demoGroupBuzz.set(groupId, Date.now());
    (chatDemo.messages[groupId] ??= []).push({ id: nid("msg"), senderId: demoUser.id, kind: "BUZZ" as const, body: null, createdAt: iso(new Date()) });
    return send(201, { message: { id: nid("msg"), senderId: demoUser.id, kind: "BUZZ", body: null, createdAt: iso(new Date()) } });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/threads\/([^/]+)\/buzz$/))) {
    const linkId = m![1];
    (chatDemo.messages[linkId] ??= []).push({ id: nid("msg"), senderId: demoUser.id, kind: "BUZZ" as const, body: null, createdAt: iso(new Date()) });
    chatDemo.note(linkId, "Zumbido", true);
    chatDemo.buzzBack(linkId);
    return send(201, { message: { id: nid("msg"), senderId: demoUser.id, kind: "BUZZ", body: null, createdAt: iso(new Date()) } });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/threads\/([^/]+)\/read$/))) {
    const friend = chatDemo.friends.find((f) => f.linkId === m![1]);
    if (friend) friend.unreadCount = 0;
    return ok({ ok: true });
  }
  // ---- Built-in browser (the panel itself only exists in the desktop app) --
  if (method === "GET" && p === "/browser/settings") return ok({ settings: browserDemo.settings });
  if (method === "PATCH" && p === "/browser/settings") {
    Object.assign(browserDemo.settings, body as object);
    return ok({ settings: browserDemo.settings });
  }
  if (method === "GET" && p === "/browser/bookmarks") return ok({ bookmarks: browserDemo.bookmarks });
  if (method === "POST" && p === "/browser/bookmarks") {
    const payload = body as { url: string; title?: string };
    const bookmark = { id: nid("bm"), url: payload.url, title: payload.title ?? null, at: iso(new Date()) };
    browserDemo.bookmarks.unshift(bookmark);
    return send(201, { bookmark });
  }
  if (method === "DELETE" && (m = p.match(/^\/browser\/bookmarks\/([^/]+)$/))) {
    browserDemo.bookmarks = browserDemo.bookmarks.filter((b) => b.id !== m![1]);
    return ok({ ok: true });
  }
  if (method === "PATCH" && (m = p.match(/^\/browser\/bookmarks\/([^/]+)$/))) {
    const bookmark = browserDemo.bookmarks.find((b) => b.id === m![1]);
    if (bookmark) bookmark.title = (body as { title: string }).title;
    return ok({ ok: true });
  }
  if (method === "GET" && p.startsWith("/browser/history")) return ok({ visits: browserDemo.visits });
  if (method === "POST" && p === "/browser/history") {
    if (!browserDemo.settings.historyEnabled) return ok({ recorded: false });
    const payload = body as { url: string; title?: string };
    const seen = browserDemo.visits.find((v) => v.url === payload.url);
    if (seen) { seen.visits = (seen.visits ?? 1) + 1; seen.at = iso(new Date()); }
    else browserDemo.visits.unshift({ id: nid("bv"), url: payload.url, title: payload.title ?? null, at: iso(new Date()), visits: 1 });
    return ok({ recorded: true });
  }
  if (method === "DELETE" && (m = p.match(/^\/browser\/history\/([^/]+)$/))) {
    browserDemo.visits = browserDemo.visits.filter((v) => v.id !== m![1]);
    return ok({ ok: true });
  }
  if (method === "DELETE" && p === "/browser/history") {
    const removed = browserDemo.visits.length;
    browserDemo.visits = [];
    return ok({ ok: true, removed });
  }

  if (method === "GET" && p === "/chat/groups") return ok({ groups: chatDemo.groups });
  if (method === "POST" && p === "/chat/groups") {
    const payload = body as { name: string; memberIds: string[] };
    const picked = chatDemo.friends.filter((f) => payload.memberIds.includes(f.user.id));
    const group = {
      groupId: nid("grp"),
      name: payload.name,
      ownerId: demoUser.id,
      isOwner: true,
      members: [
        { id: demoUser.id, name: demoUser.name, avatarUrl: null, status: "ONLINE", isOwner: true },
        ...picked.map((f) => ({ id: f.user.id, name: f.user.name, avatarUrl: f.user.avatarUrl, status: f.user.status })),
      ],
      unreadCount: 0,
      lastMessageAt: null,
      lastMessage: null,
      lastMessageMine: null,
      muted: false,
      wallpaper: null,
      createdAt: iso(new Date()),
    } satisfies DemoChatGroup;
    chatDemo.groups.unshift(group);
    chatDemo.messages[group.groupId] = [];
    return send(201, { group });
  }
  if (method === "PATCH" && (m = p.match(/^\/chat\/groups\/([^/]+)$/))) {
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    if (group) group.name = (body as { name: string }).name;
    return ok({ group });
  }
  if (method === "PATCH" && (m = p.match(/^\/chat\/groups\/([^/]+)\/photo$/))) {
    // No owner check on purpose: any participant can change the group photo.
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    if (!group) demoFail(404, "El grupo no existe.");
    group.avatarUrl = (body as { avatarUrl?: string | null }).avatarUrl ?? null;
    return ok({ group });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/members$/))) {
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    const ids = (body as { userIds: string[] }).userIds;
    if (group) {
      for (const friend of chatDemo.friends.filter((f) => ids.includes(f.user.id))) {
        group.members.push({ id: friend.user.id, name: friend.user.name, avatarUrl: friend.user.avatarUrl, status: friend.user.status });
      }
    }
    return ok({ group });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/friend-requests$/))) {
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    const targetId = (body as { userId?: string } | undefined)?.userId;
    const member = group?.members.find((candidate) => candidate.id === targetId);
    if (!group || !member || member.id === demoUser.id) demoFail(404, "Esa persona no está en el grupo.");

    const existing = [...chatDemo.friends, ...chatDemo.incoming, ...chatDemo.outgoing]
      .find((link) => link.user.id === member.id);
    if (existing?.status === "ACCEPTED") return ok({ autoAccepted: false });
    if (existing?.status === "PENDING") {
      if (!existing.requestedByMe) {
        chatDemo.incoming = chatDemo.incoming.filter((link) => link.linkId !== existing.linkId);
        chatDemo.friends.push({ ...existing, status: "ACCEPTED", unreadCount: 0 });
        return ok({ autoAccepted: true });
      }
      return ok({ autoAccepted: false });
    }

    const seed = demoLink(nid("lnk"), member.name, 0);
    chatDemo.outgoing.push({
      ...seed,
      user: { ...seed.user, id: member.id, status: member.status },
      status: "PENDING",
      requestedByMe: true,
    });
    return send(201, { autoAccepted: false });
  }
  if (method === "DELETE" && (m = p.match(/^\/chat\/groups\/([^/]+)\/members\/([^/]+)$/))) {
    const groupId = m![1];
    const memberId = m![2];
    if (memberId === demoUser.id) {
      chatDemo.groups = chatDemo.groups.filter((g) => g.groupId !== groupId);
    } else {
      const group = chatDemo.groups.find((g) => g.groupId === groupId);
      if (group) group.members = group.members.filter((member) => member.id !== memberId);
    }
    return ok({ ok: true });
  }
  if (method === "PATCH" && (m = p.match(/^\/chat\/groups\/([^/]+)\/(prefs|wallpaper)$/))) {
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    if (group) Object.assign(group, body as object);
    return ok({ ok: true });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/clear$/))) {
    chatDemo.messages[m![1]] = [];
    return ok({ ok: true });
  }
  if (method === "GET" && (m = p.match(/^\/chat\/groups\/([^/]+)\/messages$/))) {
    return ok({ messages: chatDemo.messages[m![1]] ?? [], nextBefore: null });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/messages$/))) {
    const groupId = m![1];
    const message = { id: nid("msg"), senderId: demoUser.id, kind: "TEXT" as const, body: (body as any).body, createdAt: iso(new Date()) };
    (chatDemo.messages[groupId] ??= []).push(message);
    const group = chatDemo.groups.find((g) => g.groupId === groupId);
    if (group) {
      group.lastMessage = message.body as string;
      group.lastMessageMine = true;
      group.lastMessageAt = message.createdAt;
    }
    return send(201, { message });
  }
  if (method === "POST" && (m = p.match(/^\/chat\/groups\/([^/]+)\/read$/))) {
    const group = chatDemo.groups.find((g) => g.groupId === m![1]);
    if (group) group.unreadCount = 0;
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/chat/sync") {
    const threads = chatDemo.friends.map((f) => ({
      linkId: f.linkId, lastMessageAt: f.lastMessageAt, unreadCount: f.unreadCount, otherBuzzAt: f.otherBuzzAt,
    }));
    const groups = chatDemo.groups.map((g) => ({
      groupId: g.groupId, lastMessageAt: g.lastMessageAt, unreadCount: g.unreadCount,
    }));
    const unreadTotal = [...threads, ...groups].reduce((total, t) => total + t.unreadCount, 0);
    return ok({
      version: `${unreadTotal}.${chatDemo.incoming.length}.${chatDemo.tick}`,
      unreadTotal,
      pendingIncoming: chatDemo.incoming.length,
      threads,
      groups,
    });
  }

  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/complete$/))) { const t = own(S.tasks, m![1]); t.status = "COMPLETED"; t.completedAt = iso(new Date()); return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/postpone$/))) { const t = own(S.tasks, m![1]); t.dueDate = iso(addDays(t.dueDate ? new Date(t.dueDate) : T0, (body as any)?.days ?? 1)); t.status = t.status === "COMPLETED" ? "PENDING" : "POSTPONED"; return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/snooze$/))) { const t = own(S.tasks, m![1]); if (!t.dueDate || !t.hasTime) demoFail(400, "Solo se pueden posponer tareas con hora de inicio."); const minutes = (body as any)?.minutes; if (minutes !== 10) demoFail(422, "El aplazamiento debe ser de 10 minutos."); t.dueDate = iso(new Date(new Date(t.dueDate).getTime() + 10 * 60_000)); if (t.dueEndDate) t.dueEndDate = iso(new Date(new Date(t.dueEndDate).getTime() + 10 * 60_000)); return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/skip-occurrence$/))) { own(S.tasks, m![1]); return ok({ ok: true }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/subtasks$/))) { const t = own(S.tasks, m![1]); const sub = { id: nid("sub"), title: (body as { title: string }).title, done: false, sortOrder: (t.subtasks?.length ?? 0) }; t.subtasks = [...(t.subtasks ?? []), sub]; return ok({ subtask: sub }); }
  if (method === "POST" && (m = p.match(/^\/tasks\/(.+)\/attachments$/))) {
    const t = own(S.tasks, m[1]);
    const files = await postedDemoFiles(body);
    const atts = saveDemoAttachments("task", t.id, t.attachments?.length ?? 0, files);
    t.attachments = [...(t.attachments ?? []), ...atts];
    return ok({ attachments: atts });
  }
  if (method === "GET" && (m = p.match(/^\/tasks\/(.+)\/attachments\/(.+)$/))) {
    const t = own(S.tasks, m![1]);
    const file = demoFiles.get(m![2]);
    if (!file || file.parentId !== m![1] || !(t.attachments ?? []).some((a) => a.id === m![2])) demoFail(404);
    return ok({ mimeType: file.mimeType, data: file.data });
  }
  if (method === "DELETE" && (m = p.match(/^\/tasks\/(.+)\/attachments\/(.+)$/))) {
    const t = own(S.tasks, m![1]);
    t.attachments = (t.attachments ?? []).filter((a) => a.id !== m![2]);
    demoFiles.delete(m![2]);
    return ok({ ok: true });
  }
  if (method === "PUT" && p === "/tasks/board-order") { const b = body as { ids?: string[]; positions?: number[] }; (b.ids ?? []).forEach((id, i) => { const t = S.tasks.find((x) => x.id === id); if (t) (t as any).boardOrder = b.positions?.[i] ?? i; }); return ok({ ok: true }); }
  if (method === "DELETE" && p === "/tasks/board-order") { for (const t of S.tasks) (t as any).boardOrder = null; return ok({ ok: true }); }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/subtasks\/(.+)$/))) { for (const t of S.tasks) { const sub = (t.subtasks ?? []).find((s) => s.id === m![1]); if (sub) { sub.done = (body as any).done ?? sub.done; return ok({ subtask: sub }); } } return ok({ ok: true }); }
  if (method === "GET" && (m = p.match(/^\/tasks\/(.+)$/))) return ok({ task: decorateTask(own(S.tasks, m![1])) });
  if (method === "POST" && p === "/tasks") {
    const b = body as any;
    const siblings = S.tasks.filter((x) => (x.projectId ?? null) === (b.projectId ?? null));
    const sortOrder = Math.max(-1, ...siblings.map((x) => x.sortOrder ?? 0)) + 1;
    const t: Task = { id: nid("tsk"), title: b.title, description: b.description ?? null, dueDate: b.dueDate ?? null, dueEndDate: b.dueEndDate ?? null, hasTime: b.hasTime ?? !!b.dueDate, priority: b.priority ?? "NORMAL", status: b.status ?? "PENDING", notifyTelegram: b.notifyTelegram ?? false, timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), projectId: b.projectId ?? null, color: b.color ?? null, sortOrder, subtasks: (b.subtasks ?? []).map((s: { title: string }, i: number) => ({ id: nid("sub"), title: s.title, done: false, sortOrder: i })), tags: resolveTaskTags(b.tagIds), goals: [], attachments: [] };
    S.tasks.push(t); return ok({ task: decorateTask(t) });
  }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/(.+)\/move$/))) { const t = own(S.tasks, m![1]); t.dueDate = (body as any).dueDate ?? t.dueDate; return ok({ task: decorateTask(t) }); }
  if (method === "PATCH" && (m = p.match(/^\/tasks\/(.+)$/))) { const t = own(S.tasks, m![1]); const b = body as any; Object.assign(t, { title: b.title ?? t.title, description: b.description ?? t.description, priority: b.priority ?? t.priority, status: b.status ?? t.status, projectId: b.projectId ?? t.projectId, dueDate: b.dueDate ?? t.dueDate, dueEndDate: b.dueEndDate ?? t.dueEndDate, notifyTelegram: typeof b.notifyTelegram === "boolean" ? b.notifyTelegram : t.notifyTelegram, cardFill: b.cardFill !== undefined ? b.cardFill : t.cardFill }); if (Array.isArray(b.tagIds)) t.tags = resolveTaskTags(b.tagIds); if (b.status === "COMPLETED") t.completedAt = iso(new Date()); return ok({ task: decorateTask(t) }); }
  if (method === "DELETE" && (m = p.match(/^\/tasks\/(.+)\/permanent$/))) { dropDemoFiles(m![1]); S.tasks = S.tasks.filter((t) => t.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/tasks\/(.+)$/))) { const t = own(S.tasks, m![1]); t.deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Events ----------
  if (method === "GET" && (m = p.match(/^\/events\/([^/]+)$/))) return ok({ event: own(S.events, m[1]) });
  if (method === "POST" && p === "/events") { const b = body as any; const e: EventItem = { id: nid("evt"), title: b.title, description: b.description ?? null, startAt: b.startAt, endAt: b.endAt, allDay: b.allDay ?? false, priority: b.priority ?? "NORMAL", status: "PENDING", color: b.color ?? "#1d4ed8", category: b.category ?? null, location: b.location ?? null, tags: [] }; S.events.push(e); return ok({ event: e }); }
  if (method === "PATCH" && (m = p.match(/^\/events\/(.+)\/move$/))) { const e = own(S.events, m![1]); e.startAt = (body as any).startAt ?? e.startAt; e.endAt = (body as any).endAt ?? e.endAt; return ok({ event: e }); }
  if (method === "POST" && (m = p.match(/^\/events\/(.+)\/to-task$/))) { const e = own(S.events, m![1]); const t: Task = { id: nid("tsk"), title: e.title, description: e.description, dueDate: e.startAt, hasTime: true, priority: e.priority, status: "PENDING", timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), color: e.color, projectId: e.projectId ?? null, subtasks: [], tags: [], goals: [] }; S.tasks.push(t); return ok({ task: decorateTask(t) }); }
  if (method === "POST" && (m = p.match(/^\/events\/(.+)\/skip-occurrence$/))) { own(S.events, m![1]); return ok({ ok: true }); }
  if (method === "PATCH" && (m = p.match(/^\/events\/(.+)$/))) { const e = own(S.events, m![1]); const b = body as any; Object.assign(e, { title: b.title ?? e.title, startAt: b.startAt ?? e.startAt, endAt: b.endAt ?? e.endAt, color: b.color ?? e.color, allDay: b.allDay ?? e.allDay }); return ok({ event: e }); }
  if (method === "DELETE" && (m = p.match(/^\/events\/(.+)\/permanent$/))) { S.events = S.events.filter((e) => e.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/events\/(.+)$/))) { const e = own(S.events, m![1]); e.deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Notes ----------
  if (method === "GET" && p === "/notes") {
    const archived = query.archived === "true";
    return ok({
      notes: S.notes
        .filter((n) => !n.deletedAt && n.archived === archived)
        .map((n) => ({ ...n, tags: n.tags ?? [], attachments: n.attachments ?? [] })),
    });
  }
  if (method === "POST" && p === "/notes") { const n: Note = { id: nid("nte"), title: (body as any).title ?? "Sin título", content: (body as any).content ?? "", pinned: false, archived: false, favorite: false, createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: [], attachments: [] }; S.notes.unshift(n); return ok({ note: n }); }
  if (method === "PATCH" && (m = p.match(/^\/notes\/(.+)\/autosave$/))) { const n = own(S.notes, m![1]); n.content = (body as any).content ?? n.content; n.title = (body as any).title ?? n.title; n.updatedAt = iso(new Date()); return ok({ note: n }); }
  if (method === "PATCH" && (m = p.match(/^\/notes\/(.+)$/))) { const n = own(S.notes, m![1]); Object.assign(n, { title: (body as any).title ?? n.title, content: (body as any).content ?? n.content, pinned: (body as any).pinned ?? n.pinned, archived: (body as any).archived ?? n.archived, favorite: (body as any).favorite ?? n.favorite }); return ok({ note: n }); }
  if (method === "POST" && (m = p.match(/^\/notes\/(.+)\/duplicate$/))) { const src = own(S.notes, m![1]); const n = { ...JSON.parse(JSON.stringify(src)), id: nid("nte"), title: src.title + " (copia)", attachments: [] }; S.notes.unshift(n); return ok({ note: n }); }
  if (method === "POST" && (m = p.match(/^\/notes\/(.+)\/attachments$/))) {
    const n = own(S.notes, m[1]);
    const files = await postedDemoFiles(body);
    const atts = saveDemoAttachments("note", n.id, n.attachments?.length ?? 0, files);
    n.attachments = [...(n.attachments ?? []), ...atts];
    return ok({ attachments: atts });
  }
  if (method === "GET" && (m = p.match(/^\/notes\/(.+)\/attachments\/(.+)$/))) {
    const n = own(S.notes, m![1]);
    const file = demoFiles.get(m![2]);
    if (!file || file.parentId !== m![1] || !(n.attachments ?? []).some((a) => a.id === m![2])) demoFail(404);
    return ok({ mimeType: file.mimeType, data: file.data });
  }
  if (method === "DELETE" && (m = p.match(/^\/notes\/(.+)\/attachments\/(.+)$/))) {
    const n = own(S.notes, m![1]);
    n.attachments = (n.attachments ?? []).filter((a) => a.id !== m![2]);
    demoFiles.delete(m![2]);
    return ok({ ok: true });
  }
  if (method === "DELETE" && (m = p.match(/^\/notes\/(.+)\/permanent$/))) { dropDemoFiles(m![1]); S.notes = S.notes.filter((n) => n.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/notes\/(.+)$/))) { const n = own(S.notes, m![1]); n.deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Projects ----------
  if (method === "GET" && p === "/projects") {
    const list = S.projects.filter((pr) => {
      if ((pr as { deletedAt?: string }).deletedAt) return false;
      if (query.status) return pr.status === query.status;
      return pr.status !== "ARCHIVED";
    });
    return ok({ projects: list.map(projectListItem) });
  }
  if (method === "PATCH" && (m = p.match(/^\/projects\/(.+)\/tasks\/reorder$/))) {
    const ids = ((body as { ids?: string[] }).ids ?? []);
    ids.forEach((tid, i) => { const t = S.tasks.find((x) => x.id === tid && x.projectId === m![1]); if (t) t.sortOrder = i; });
    return ok({ ok: true });
  }
  if (method === "GET" && (m = p.match(/^\/projects\/(.+)\/tasks$/))) return ok({ tasks: S.tasks.filter((t) => t.projectId === m![1]).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(decorateTask), hasMore: false });
  if (method === "GET" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); const tasks = S.tasks.filter((t) => t.projectId === pr.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(decorateTask); return ok({ project: { ...pr, tasks, progress: projectProgress(pr.id) } }); }
  if (method === "POST" && p === "/projects") { const pr: Project = { id: nid("prj"), name: (body as any).name, description: (body as any).description ?? null, color: (body as any).color ?? "#6366f1", status: "PLANNING" }; S.projects.push(pr); return ok({ project: { ...pr, _count: { tasks: 0 } } }); }
  if (method === "PATCH" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); Object.assign(pr, { name: (body as any).name ?? pr.name, color: (body as any).color ?? pr.color, description: (body as any).description ?? pr.description, status: (body as any).status ?? pr.status }); return ok({ project: { ...pr, _count: { tasks: S.tasks.filter((t) => t.projectId === pr.id).length } } }); }
  if (method === "DELETE" && (m = p.match(/^\/projects\/(.+)\/permanent$/))) { S.projects = S.projects.filter((x) => x.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/projects\/(.+)$/))) { const pr = own(S.projects, m![1]); (pr as any).deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Tags / Habits / Goals ----------
  if (method === "GET" && p === "/tags") return ok({ tags: S.tags });
  if (method === "POST" && p === "/tags") {
    const name = String((body as { name?: string } | null)?.name ?? "").trim();
    if (!name) demoFail(400, "Escribe un nombre.");
    if (S.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) demoFail(409, "Ya existe una etiqueta con ese nombre.");
    const t = { id: nid("tag"), name, color: (body as { color?: string } | null)?.color ?? "#6366f1" };
    S.tags.push(t);
    return ok({ tag: t });
  }
  if (method === "PATCH" && (m = p.match(/^\/tags\/(.+)$/))) {
    const tag = own(S.tags, m[1]);
    const patch = body as { name?: string; color?: string };
    const name = patch.name?.trim().replace(/^#/, "");
    if (name && S.tags.some((item) => item.id !== tag.id && item.name.toLowerCase() === name.toLowerCase())) {
      demoFail(409, "Ya existe una etiqueta con ese nombre.");
    }
    if (name) tag.name = name;
    if (patch.color) tag.color = patch.color;
    return ok({ tag });
  }
  if (method === "DELETE" && (m = p.match(/^\/tags\/(.+)$/))) {
    own(S.tags, m[1]);
    const id = m[1];
    S.tags = S.tags.filter((tag) => tag.id !== id);
    for (const item of [...S.tasks, ...S.events, ...S.notes]) {
      item.tags = item.tags?.filter((tag) => tag.id !== id) ?? [];
    }
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/habits") return ok({ habits: habitsList() });
  if (method === "POST" && p === "/habits") { const h: Habit = { id: nid("hbt"), name: (body as any).name, color: (body as any).color ?? "#6366f1", scheduleDayBits: (body as any).scheduleDayBits ?? 127, reminderMinuteOfDay: (body as any).reminderMinuteOfDay ?? null }; S.habits.push(h); return ok({ habit: h }); }
  if (method === "PATCH" && (m = p.match(/^\/habits\/(.+)$/))) { const h = own(S.habits, m![1]); Object.assign(h, { name: (body as any).name ?? h.name, color: (body as any).color ?? h.color, scheduleDayBits: (body as any).scheduleDayBits ?? h.scheduleDayBits, reminderMinuteOfDay: (body as any).reminderMinuteOfDay !== undefined ? (body as any).reminderMinuteOfDay : h.reminderMinuteOfDay }); return ok({ habit: h }); }
  if (method === "POST" && (m = p.match(/^\/habits\/(.+)\/log$/))) { const id = m![1]; const date = (body as any).date as string; S.habitLogs[id] = S.habitLogs[id] ?? []; const toggled = !S.habitLogs[id].includes(date); if (toggled) S.habitLogs[id].push(date); else S.habitLogs[id] = S.habitLogs[id].filter((k) => k !== date); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/habits\/(.+)$/))) { S.habits = S.habits.filter((h) => h.id !== m![1]); return ok({ ok: true }); }
  if (method === "GET" && p === "/goals") return ok({ goals: S.goals.map((g) => ({ ...g, progress: goalProgress(g) })) });
  if (method === "POST" && p === "/goals") {
    const b = body as any;
    const g: Goal = { id: nid("goal"), title: b.title, description: b.description ?? null, dueDate: b.dueDate ?? null, manualProgress: -1, status: b.status ?? "PENDING", projectId: b.projectId ?? null, tasks: S.tasks.filter((t) => (b.taskIds ?? []).includes(t.id)).map((t) => ({ id: t.id, title: t.title, status: t.status })) };
    S.goals.push(g);
    return ok({ goal: { ...g, progress: goalProgress(g) } });
  }
  if (method === "PATCH" && (m = p.match(/^\/goals\/(.+)$/))) {
    const g = own(S.goals, m![1]); const b = body as any;
    Object.assign(g, { title: b.title ?? g.title, description: b.description ?? g.description, dueDate: b.dueDate ?? g.dueDate, projectId: b.projectId ?? g.projectId, status: b.status ?? g.status });
    if (Array.isArray(b.taskIds)) g.tasks = S.tasks.filter((t) => b.taskIds.includes(t.id)).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return ok({ goal: { ...g, progress: goalProgress(g) } });
  }
  if (method === "DELETE" && (m = p.match(/^\/goals\/(.+)\/permanent$/))) { S.goals = S.goals.filter((g) => g.id !== m![1]); return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/goals\/(.+)$/))) { const g = own(S.goals, m![1]); (g as any).deletedAt = iso(new Date()); return ok({ ok: true }); }

  // ---------- Business messaging (frontend-only demo) ----------
  if (method === "GET" && p === "/messaging/connections") {
    return ok({
      connections: S.messagingConnections,
      availability: {
        telegram: { enabled: true, linkedToCalen: true, username: "demo_user" },
        whatsapp: { enabled: true, configured: true, appId: "demo-app", configId: "demo-config", graphVersion: "v25.0" },
      },
    });
  }
  if (method === "POST" && p === "/telegram/link") return ok({ deepLink: "https://t.me/dayly_demo?start=demo-token", botUsername: "dayly_demo", expiresAt: iso(new Date(Date.now() + 10 * 60_000)) });
  if (method === "GET" && p === "/telegram/status") return ok({ platformEnabled: true, configured: true, linked: true, username: "demo_user", linkedAt: iso(T0), notifyTelegramReminders: true, bot: { username: "dayly_demo", firstName: "Calen", status: "ACTIVE", businessCapable: true, webhookVerifiedAt: iso(T0), lastError: null } });
  if (method === "PUT" && p === "/telegram/bot") return ok({ bot: { username: "dayly_demo", firstName: "Calen", status: "PENDING", businessCapable: true, webhookVerifiedAt: null, lastError: null } });
  if (method === "POST" && p === "/telegram/bot/webhook") return ok({ ok: true });
  if (method === "POST" && p === "/telegram/unlink") return ok({ ok: true });
  if (method === "DELETE" && p === "/telegram/bot") return ok({ ok: true });
  if (method === "POST" && p === "/messaging/whatsapp/connect") {
    let connection = S.messagingConnections.find((item) => item.provider === "WHATSAPP");
    if (!connection) {
      connection = { ...demoMessagingConnections[0], id: nid("msg-conn"), status: "ACTIVE" };
      S.messagingConnections.push(connection);
    } else {
      connection.status = "ACTIVE";
      connection.revokedAt = null;
    }
    return send(201, { connection });
  }
  if (method === "POST" && (m = p.match(/^\/messaging\/connections\/([^/]+)\/disconnect$/))) {
    const connection = own(S.messagingConnections, m[1]);
    connection.status = "REVOKED";
    connection.revokedAt = iso(new Date());
    S.messagingScheduled.filter((item) => item.provider === connection.provider && ["AWAITING_CONFIRMATION", "SCHEDULED", "PAUSED", "REQUIRES_ATTENTION"].includes(item.status)).forEach((item) => { item.status = "CANCELED"; item.errorCode = "CONNECTION_REVOKED"; });
    return ok({ ok: true });
  }
  if (method === "DELETE" && (m = p.match(/^\/messaging\/connections\/([^/]+)\/data$/))) {
    if ((body as { confirmation?: string } | undefined)?.confirmation !== "BORRAR") demoFail(400, "Confirma con BORRAR.");
    const connection = own(S.messagingConnections, m[1]);
    if (connection.status === "ACTIVE") demoFail(409, "Desconecta el canal antes de borrar su copia local.");
    const ids = new Set(S.messagingConversations.filter((item) => item.provider === connection.provider).map((item) => item.id));
    S.messagingConversations = S.messagingConversations.filter((item) => !ids.has(item.id));
    ids.forEach((id) => delete S.messagingMessages[id]);
    S.messagingScheduled = S.messagingScheduled.filter((item) => !ids.has(item.conversationId));
    S.messagingConnections = S.messagingConnections.filter((item) => item.id !== connection.id);
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/messaging/conversations") {
    const provider = query.provider;
    const view = query.view ?? "all";
    const rows = S.messagingConversations.filter((item) => {
      if (provider && item.provider !== provider) return false;
      if (view === "unread" && item.unreadCount < 1) return false;
      if (view === "scheduled" && item.scheduledCount < 1) return false;
      if (view === "attention" && item.attentionCount < 1) return false;
      return true;
    });
    return ok({ conversations: rows, nextCursor: null });
  }
  if (method === "GET" && (m = p.match(/^\/messaging\/conversations\/([^/]+)\/messages$/))) {
    const conversation = own(S.messagingConversations, m[1]);
    return ok({ conversation, messages: S.messagingMessages[conversation.id] ?? [], nextBefore: null });
  }
  if (method === "POST" && (m = p.match(/^\/messaging\/conversations\/([^/]+)\/read$/))) {
    own(S.messagingConversations, m[1]).unreadCount = 0;
    return ok({ ok: true, providerReceiptSent: false });
  }
  if (method === "POST" && (m = p.match(/^\/messaging\/conversations\/([^/]+)\/messages$/))) {
    const conversation = own(S.messagingConversations, m[1]);
    if (!conversation.canReply) demoFail(409, "La ventana de respuesta está cerrada.");
    const b = body as { body?: string };
    const text = String(b.body ?? "").trim();
    if (!text) demoFail(400, "Escribe un mensaje.");
    const sentAt = iso(new Date());
    const message: ChannelMessage = { id: nid("msg"), direction: "OUTBOUND", origin: "API", kind: "TEXT", body: text, attachment: null, hasMedia: false, deliveryStatus: "SENT", providerSentAt: sentAt, editedAt: null, deletedAt: null, replyToMessageId: null };
    (S.messagingMessages[conversation.id] ??= []).push(message);
    conversation.lastMessageAt = sentAt;
    conversation.lastDirection = "OUTBOUND";
    conversation.preview = text;
    return send(202, { scheduledReply: demoReply({ conversation, body: text, status: "SENT", sendAt: sentAt, confirmedVersion: 1 }) });
  }
  if (method === "GET" && p === "/messaging/scheduled-replies") {
    const rows = S.messagingScheduled.filter((item) => !query.conversationId || item.conversationId === query.conversationId);
    return ok({ scheduledReplies: rows });
  }
  if (method === "POST" && p === "/messaging/scheduled-replies") {
    const b = body as { conversationId?: string; body?: string; sendAt?: string; timezone?: string; quotedMessageId?: string | null; pauseOnActivity?: boolean };
    const conversation = own(S.messagingConversations, String(b.conversationId));
    const sendAt = new Date(String(b.sendAt));
    const text = String(b.body ?? "").trim();
    if (!text || Number.isNaN(sendAt.getTime())) demoFail(400, "Indica un texto y una fecha válidos.");
    const windowEnd = conversation.replyWindowEndsAt ? new Date(conversation.replyWindowEndsAt) : null;
    const canConfirm = Boolean(windowEnd && sendAt.getTime() < windowEnd.getTime());
    const row = demoReply({ conversation, body: text, sendAt: sendAt.toISOString(), quotedMessageId: b.quotedMessageId ?? null, pauseOnActivity: b.pauseOnActivity ?? true, errorCode: canConfirm ? null : "OUTSIDE_REPLY_WINDOW", error: canConfirm ? null : "La fecha queda fuera de la ventana conocida de respuesta." });
    S.messagingScheduled.push(row);
    conversation.scheduledCount += 1;
    return send(201, { scheduledReply: row });
  }
  if (method === "PATCH" && (m = p.match(/^\/messaging\/scheduled-replies\/([^/]+)$/))) {
    const row = own(S.messagingScheduled, m[1]);
    if (["PROCESSING", "SENT", "CANCELED"].includes(row.status)) demoFail(409, "Este envío ya no se puede editar.");
    const b = body as { body?: string; sendAt?: string; pauseOnActivity?: boolean };
    if (b.body !== undefined) row.body = String(b.body).trim();
    if (b.sendAt) row.sendAt = new Date(b.sendAt).toISOString();
    if (b.pauseOnActivity !== undefined) row.pauseOnActivity = b.pauseOnActivity;
    row.draftVersion += 1;
    row.confirmedVersion = null;
    row.status = "AWAITING_CONFIRMATION";
    row.updatedAt = iso(new Date());
    const conversation = own(S.messagingConversations, row.conversationId);
    row.replyWindowEndsAt = conversation.replyWindowEndsAt;
    row.canConfirm = Boolean(row.replyWindowEndsAt && new Date(row.sendAt).getTime() < new Date(row.replyWindowEndsAt).getTime());
    row.errorCode = row.canConfirm ? null : "OUTSIDE_REPLY_WINDOW";
    row.error = row.canConfirm ? null : "La fecha queda fuera de la ventana conocida de respuesta.";
    return ok({ scheduledReply: row });
  }
  if (method === "POST" && (m = p.match(/^\/messaging\/scheduled-replies\/([^/]+)\/confirm$/))) {
    const row = own(S.messagingScheduled, m[1]);
    const b = body as { expectedVersion?: number };
    if (row.status !== "AWAITING_CONFIRMATION" || row.draftVersion !== b.expectedVersion) demoFail(409, "El borrador cambió. Revísalo antes de confirmar.");
    if (!row.canConfirm) demoFail(409, "La ventana de respuesta está cerrada. Conserva el texto y crea un recordatorio.");
    row.status = "SCHEDULED";
    row.confirmedVersion = row.draftVersion;
    row.errorCode = null;
    row.error = null;
    row.updatedAt = iso(new Date());
    return ok({ scheduledReply: row });
  }
  if (method === "POST" && (m = p.match(/^\/messaging\/scheduled-replies\/([^/]+)\/cancel$/))) {
    const row = own(S.messagingScheduled, m[1]);
    row.status = "CANCELED";
    row.updatedAt = iso(new Date());
    return ok({ scheduledReply: row });
  }
  if (method === "GET" && (m = p.match(/^\/messaging\/messages\/([^/]+)\/media$/))) demoFail(404, "El archivo ya no está disponible.");
  if (method === "POST" && (m = p.match(/^\/messaging\/conversations\/([^/]+)\/reminders$/))) {
    const conversation = own(S.messagingConversations, m[1]);
    const b = body as { title?: string; remindAt?: string };
    const reminder: Reminder = { id: nid("rem"), title: b.title ?? `Responder a ${conversation.displayName}`, remindAt: String(b.remindAt), endAt: null, scheduleDaily: false, notifyTelegram: false, targetType: "CONVERSATION", targetId: conversation.id, attachments: [] };
    S.reminders.push(reminder);
    return send(201, { reminder });
  }

  // ---------- Inbox mailboxes ----------
  if (method === "GET" && p === "/inbox/mailboxes/google/config") return ok({ enabled: false });
  if (method === "GET" && p === "/inbox/mailboxes") return ok({ mailboxes: S.mailboxes });
  if (method === "POST" && p === "/inbox/mailboxes") {
    const b = body as Record<string, unknown>;
    const mb: Mailbox = {
      id: nid("mbx"),
      label: String(b.label || b.email),
      email: String(b.email),
      imapHost: String(b.imapHost),
      imapPort: Number(b.imapPort ?? 993),
      imapSecure: Boolean(b.imapSecure ?? true),
      smtpHost: String(b.smtpHost),
      smtpPort: Number(b.smtpPort ?? 587),
      smtpSecure: Boolean(b.smtpSecure ?? false),
      username: String(b.username || b.email),
      authType: "password",
      passwordConfigured: true,
      lastError: null,
      lastCheckedAt: iso(new Date()),
      isDefault: S.mailboxes.length === 0,
    };
    S.mailboxes.push(mb);
    S.mails[mb.id] = [];
    return ok({ mailbox: mb });
  }
  if (method === "PATCH" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)$/))) {
    const mb = own(S.mailboxes, m![1]);
    const b = body as Record<string, unknown>;
    Object.assign(mb, {
      label: b.label ?? mb.label,
      email: b.email ?? mb.email,
      imapHost: b.imapHost ?? mb.imapHost,
      imapPort: b.imapPort ?? mb.imapPort,
      imapSecure: b.imapSecure ?? mb.imapSecure,
      smtpHost: b.smtpHost ?? mb.smtpHost,
      smtpPort: b.smtpPort ?? mb.smtpPort,
      smtpSecure: b.smtpSecure ?? mb.smtpSecure,
      username: b.username ?? mb.username,
      passwordConfigured: mb.passwordConfigured || Boolean(b.password),
    });
    return ok({ mailbox: mb });
  }
  if (method === "POST" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)\/default$/))) {
    own(S.mailboxes, m![1]);
    S.mailboxes.forEach((item) => { item.isDefault = item.id === m![1]; });
    return ok({ ok: true, defaultMailboxId: m![1] });
  }
  if (method === "DELETE" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)$/))) {
    const wasDefault = S.mailboxes.find((item) => item.id === m![1])?.isDefault;
    S.mailboxes = S.mailboxes.filter((x) => x.id !== m![1]);
    if (wasDefault && S.mailboxes[0]) S.mailboxes[0].isDefault = true;
    delete S.mails[m![1]];
    return ok({ ok: true });
  }
  if (method === "POST" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)\/test$/))) {
    own(S.mailboxes, m![1]).lastError = null;
    own(S.mailboxes, m![1]).lastCheckedAt = iso(new Date());
    return ok({ ok: true });
  }
  if (method === "GET" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)\/messages\/(\d+)$/))) {
    const list = S.mails[m![1]] ?? [];
    const msg = list.find((x) => x.uid === Number(m![2]));
    if (!msg) demoFail(404);
    msg.seen = true;
    return ok({ message: msg });
  }
  if (method === "GET" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)\/messages$/))) {
    own(S.mailboxes, m![1]);
    const messages = (S.mails[m![1]] ?? []).map(({ text: _text, ...rest }) => rest);
    return ok({ messages });
  }
  if (method === "POST" && (m = p.match(/^\/inbox\/mailboxes\/([^/]+)\/messages\/(\d+)\/reply$/))) {
    own(S.mailboxes, m![1]);
    const msg = (S.mails[m![1]] ?? []).find((x) => x.uid === Number(m![2]));
    if (!msg) demoFail(404);
    return ok({ ok: true });
  }

  // ---------- Inbox ----------
  if (method === "GET" && p === "/inbox") return ok({ items: S.inbox });
  if (method === "POST" && p === "/inbox") { const it = { id: nid("inb"), content: (body as any).content, archived: false, createdAt: iso(new Date()) }; S.inbox.unshift(it); return ok({ item: it }); }
  if (method === "POST" && (m = p.match(/^\/inbox\/(.+)\/archive$/))) { const it = own(S.inbox, m![1]); it.archived = true; return ok({ ok: true }); }
  if (method === "DELETE" && (m = p.match(/^\/inbox\/(.+)$/))) { S.inbox = S.inbox.filter((i) => i.id !== m![1]); return ok({ ok: true }); }
  if (method === "POST" && (m = p.match(/^\/inbox\/(.+)\/convert$/))) { const it = own(S.inbox, m![1]); const type = (body as any).type; it.archived = true; const title = (body as any).title ?? it.content; if (type === "TASK") { const t: Task = { id: nid("tsk"), title, dueDate: (body as any).dueDate ?? null, hasTime: false, priority: "NORMAL", status: "PENDING", timeSpentMinutes: 0, createdAt: iso(new Date()), updatedAt: iso(new Date()), subtasks: [], tags: [], goals: [] }; S.tasks.push(t); return ok({ task: decorateTask(t) }); } if (type === "EVENT") { const st = (body as any).startAt ? new Date((body as any).startAt) : new Date(); const e: EventItem = { id: nid("evt"), title, startAt: iso(st), endAt: iso(new Date(st.getTime() + 3600000)), allDay: false, priority: "NORMAL", status: "PENDING", color: "#1d4ed8", tags: [] }; S.events.push(e); return ok({ event: e }); } const n: Note = { id: nid("nte"), title, content: title, pinned: false, archived: false, favorite: false, createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: [] }; S.notes.unshift(n); return ok({ note: n }); }

  // ---------- Stats / Time / Notifications / Reminders / Search ----------
  if (method === "GET" && p === "/stats") return ok(stats());
  if (method === "GET" && p === "/time/stats") return ok({ todaySeconds: 54 * 60, weekSeconds: 6 * 3600, byProject: [], byTask: [] });
  if (method === "GET" && p === "/time/running") return ok({ entries: [] });
  if (method === "POST" && p === "/time/start") { S.timeRunning = (body as any).taskId ?? "none"; S.timeStart = Date.now(); return ok({ entry: { id: nid("time"), taskId: S.timeRunning, running: true, startedAt: iso(new Date()), durationSec: 0 } }); }
  if (method === "POST" && p === "/time/stop") { const dur = S.timeStart ? Math.max(1, Math.round((Date.now() - S.timeStart) / 1000)) : 30; const task = S.tasks.find((t) => t.id === S.timeRunning); if (task) task.timeSpentMinutes += Math.ceil(dur / 60); S.timeStart = null; S.timeRunning = null; return ok({ entry: { id: nid("time"), running: false, startedAt: iso(T0), durationSec: dur } }); }
  if (method === "POST" && p === "/time/manual") {
    const b = body as { taskId?: string; minutes?: number };
    const mins = Number(b.minutes ?? 0);
    const task = b.taskId ? S.tasks.find((t) => t.id === b.taskId) : undefined;
    if (task && mins > 0) task.timeSpentMinutes += mins;
    return ok({ entry: { id: nid("time"), taskId: b.taskId ?? null, running: false, durationSec: Math.max(0, mins) * 60 } });
  }
  if (method === "GET" && p === "/transfer/export") {
    const types = String(query.types ?? "tasks,events,notes").split(",");
    return ok({
      version: 1,
      exportedAt: iso(new Date()),
      tasks: types.includes("tasks") ? S.tasks.filter((t) => !t.deletedAt) : [],
      events: types.includes("events") ? S.events.filter((e) => !e.deletedAt) : [],
      notes: types.includes("notes") ? S.notes.filter((n) => !n.archived) : [],
    });
  }
  if (method === "POST" && p === "/transfer/import") {
    const text = String((body as { text?: string })?.text ?? "");
    const created = { tasks: 0, events: 0, notes: 0 };
    try {
      const data = JSON.parse(text) as { tasks?: Task[]; events?: EventItem[]; notes?: Note[] };
      for (const t of data.tasks ?? []) {
        S.tasks.push({
          ...t,
          id: nid("tsk"),
          createdAt: iso(new Date()),
          updatedAt: iso(new Date()),
          subtasks: t.subtasks ?? [],
          tags: t.tags ?? [],
          goals: t.goals ?? [],
        });
        created.tasks += 1;
      }
      for (const e of data.events ?? []) {
        S.events.push({ ...e, id: nid("evt"), tags: e.tags ?? [] });
        created.events += 1;
      }
      for (const n of data.notes ?? []) {
        S.notes.unshift({ ...n, id: nid("nte"), createdAt: iso(new Date()), updatedAt: iso(new Date()), tags: n.tags ?? [] });
        created.notes += 1;
      }
    } catch { /* demo: JSON only */ }
    return ok({ created });
  }
  if (method === "GET" && p === "/notifications") return ok({ notifications: S.notifications, unreadCount: S.notifications.filter((n) => !n.read).length });
  if (method === "POST" && p === "/notifications/read") { S.notifications.forEach((n) => (n.read = true)); return ok({ ok: true }); }
  if (method === "GET" && p === "/reminders") {
    const reminders = S.reminders
      .filter((r) => {
        const start = new Date(r.remindAt);
        const end = new Date(r.endAt ?? r.remindAt);
        if (query.from && end < new Date(query.from)) return false;
        if (query.to && start > new Date(query.to)) return false;
        return true;
      });
    return ok({ reminders });
  }
  if (method === "POST" && p === "/reminders") {
    const b = body as { title?: string | null; remindAt: string; endAt?: string | null; scheduleDaily?: boolean; notifyTelegram?: boolean };
    const r: Reminder = {
      id: nid("rem"),
      title: b.title ?? null,
      remindAt: b.remindAt,
      endAt: b.endAt ?? null,
      scheduleDaily: b.scheduleDaily ?? false,
      notifyTelegram: b.notifyTelegram ?? false,
      targetType: "NONE",
      attachments: [],
    };
    S.reminders.push(r);
    return ok({ reminder: r });
  }
  if (method === "PATCH" && (m = p.match(/^\/reminders\/(.+)$/))) {
    const r = own(S.reminders, m[1]);
    const b = body as { title?: string | null; remindAt?: string; endAt?: string | null; scheduleDaily?: boolean; notifyTelegram?: boolean };
    if (b.title !== undefined) r.title = b.title;
    if (b.remindAt) r.remindAt = b.remindAt;
    if (b.endAt !== undefined) r.endAt = b.endAt;
    if (typeof b.scheduleDaily === "boolean") r.scheduleDaily = b.scheduleDaily;
    if (typeof b.notifyTelegram === "boolean") r.notifyTelegram = b.notifyTelegram;
    if (b.remindAt) r.sentAt = undefined;
    return ok({ reminder: r });
  }
  if (method === "DELETE" && (m = p.match(/^\/reminders\/(.+)$/))) {
    const id = m[1];
    dropDemoFiles(id);
    S.reminders = S.reminders.filter((r) => r.id !== id);
    return ok({ ok: true });
  }
  if (method === "POST" && (m = p.match(/^\/reminders\/(.+)\/attachments$/))) {
    const r = own(S.reminders, m[1]);
    const files = await postedDemoFiles(body);
    const atts = saveDemoAttachments("reminder", r.id, r.attachments?.length ?? 0, files);
    r.attachments = [...(r.attachments ?? []), ...atts];
    return ok({ attachments: atts });
  }
  if (method === "GET" && (m = p.match(/^\/reminders\/(.+)\/attachments\/(.+)$/))) {
    const remId = m[1];
    const attId = m[2];
    const r = own(S.reminders, remId);
    const file = demoFiles.get(attId);
    if (!file || file.parentId !== remId || !(r.attachments ?? []).some((a) => a.id === attId)) demoFail(404);
    return ok({ mimeType: file.mimeType, data: file.data });
  }
  if (method === "DELETE" && (m = p.match(/^\/reminders\/(.+)\/attachments\/(.+)$/))) {
    const r = own(S.reminders, m[1]);
    const attId = m[2];
    r.attachments = (r.attachments ?? []).filter((a) => a.id !== attId);
    demoFiles.delete(attId);
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/search") return ok(search(String(query.q ?? "")));

  // ---------- Trash ----------
  if (method === "GET" && p === "/trash") {
    return ok({
      tasks: S.tasks.filter((t) => t.deletedAt).map((t) => ({ id: t.id, title: t.title, deletedAt: t.deletedAt })),
      events: S.events.filter((e) => e.deletedAt).map((e) => ({ id: e.id, title: e.title, deletedAt: e.deletedAt })),
      notes: S.notes.filter((n) => n.deletedAt).map((n) => ({ id: n.id, title: n.title, deletedAt: n.deletedAt })),
      projects: S.projects.filter((p) => (p as { deletedAt?: string }).deletedAt).map((p) => ({ id: p.id, name: p.name, deletedAt: (p as { deletedAt?: string }).deletedAt })),
      goals: S.goals.filter((g) => (g as { deletedAt?: string }).deletedAt).map((g) => ({ id: g.id, title: g.title, deletedAt: (g as { deletedAt?: string }).deletedAt })),
    });
  }
  if (method === "POST" && p === "/trash/restore") {
    const type = parseTrashType((body as { type?: string })?.type);
    const id = (body as { id?: string })?.id;
    if (!type || !id) demoFail(400);
    if (type === "task") own(S.tasks, id).deletedAt = undefined;
    if (type === "event") own(S.events, id).deletedAt = undefined;
    if (type === "note") own(S.notes, id).deletedAt = undefined;
    if (type === "project") (own(S.projects, id) as { deletedAt?: string }).deletedAt = undefined;
    if (type === "goal") (own(S.goals, id) as { deletedAt?: string }).deletedAt = undefined;
    return ok({ ok: true });
  }
  if (method === "DELETE" && p === "/trash/permanent") {
    const type = parseTrashType((body as { type?: string })?.type);
    const id = (body as { id?: string })?.id;
    if (!type || !id) demoFail(400);
    if (type === "task") { dropDemoFiles(id); S.tasks = S.tasks.filter((t) => t.id !== id); }
    if (type === "event") S.events = S.events.filter((e) => e.id !== id);
    if (type === "note") { dropDemoFiles(id); S.notes = S.notes.filter((n) => n.id !== id); }
    if (type === "project") S.projects = S.projects.filter((p) => p.id !== id);
    if (type === "goal") S.goals = S.goals.filter((g) => g.id !== id);
    return ok({ ok: true });
  }
  if (method === "DELETE" && p === "/trash") {
    for (const t of S.tasks.filter((x) => x.deletedAt)) dropDemoFiles(t.id);
    for (const n of S.notes.filter((x) => x.deletedAt)) dropDemoFiles(n.id);
    S.tasks = S.tasks.filter((t) => !t.deletedAt);
    S.events = S.events.filter((e) => !e.deletedAt);
    S.notes = S.notes.filter((n) => !n.deletedAt);
    S.projects = S.projects.filter((p) => !(p as { deletedAt?: string }).deletedAt);
    S.goals = S.goals.filter((g) => !(g as { deletedAt?: string }).deletedAt);
    return ok({ ok: true });
  }

  if (method === "POST" && p === "/alerts/tick") {
    return ok({ fired: [] });
  }
  if (method === "GET" && p === "/push/vapid") return ok({ publicKey: null });
  if (method === "POST" && p === "/push/subscribe") return ok({ ok: true });
  if (method === "POST" && p === "/push/unsubscribe") return ok({ ok: true });
  if (method === "POST" && p === "/push/test") return ok({ ok: true });
  if (method === "POST" && p === "/auth/2fa/setup") {
    const b = body as { currentPassword?: string; code?: string } | undefined;
    if (demoUser.twoFactorEnabled) {
      if (!b?.code) demoFail(401);
    } else if (!b?.currentPassword) {
      demoFail(401);
    }
    const secret = "JBSWY3DPEHPK3PXP";
    const url = `otpauth://totp/${encodeURIComponent(APP_NAME)}:demo@example.com?secret=${secret}&issuer=${encodeURIComponent(APP_NAME)}`;
    return ok({ secret, url });
  }
  if (method === "POST" && p === "/auth/2fa/enable") {
    demoUser.twoFactorEnabled = true;
    return ok({ ok: true, recoveryCodes: ["DEMO1CODE0", "DEMO2CODE0", "DEMO3CODE0", "DEMO4CODE0"] });
  }
  if (method === "POST" && p === "/auth/2fa/disable") {
    demoUser.twoFactorEnabled = false;
    return ok({ ok: true });
  }
  if (method === "POST" && p === "/auth/2fa/recovery-codes") return ok({ ok: true, recoveryCodes: ["DEMO1CODE0", "DEMO2CODE0"] });
  if (method === "GET" && p === "/auth/verify-email") return ok({ ok: true, emailConfirmed: true });

  // ---------- Cofre (blobs only; client encrypts) ----------
  if (method === "GET" && p === "/vault") {
    const session = demoVault.unlocked;
    return ok({
      exists: demoVault.exists,
      unlocked: session,
      twoFactorEnabled: demoUser.twoFactorEnabled,
      emailOtpRequired: true,
      ...(session ? {
        kdf: demoVault.kdf,
        kdfIterations: demoVault.kdfIterations,
        salt: demoVault.salt,
        checkNonce: demoVault.checkNonce,
        checkCipher: demoVault.checkCipher,
      } : {}),
    });
  }
  if (method === "POST" && p === "/vault/setup") {
    const b = body as { twoFactorCode?: string; kdf?: string; kdfIterations?: number; salt?: string; checkNonce?: string; checkCipher?: string };
    demoRejectPlain(body);
    demoRequireTotp(b.twoFactorCode);
    if (demoVault.exists) demoFail(409);
    if (b.kdf !== "pbkdf2-sha256") demoFail(400);
    demoVault.exists = true;
    demoVault.unlocked = true;
    demoVault.pendingEmail = false;
    demoVault.kdf = b.kdf;
    demoVault.kdfIterations = b.kdfIterations ?? 600_000;
    demoVault.salt = b.salt ?? "";
    demoVault.checkNonce = b.checkNonce ?? "";
    demoVault.checkCipher = b.checkCipher ?? "";
    demoVault.items = [];
    return send(201, { ok: true, kdf: demoVault.kdf, kdfIterations: demoVault.kdfIterations, salt: demoVault.salt, checkNonce: demoVault.checkNonce, checkCipher: demoVault.checkCipher });
  }
  if (method === "POST" && p === "/vault/unlock") {
    const b = body as { twoFactorCode?: string };
    demoRejectPlain(body);
    demoRequireTotp(b.twoFactorCode);
    if (!demoVault.exists) demoFail(404);
    demoVault.unlocked = false;
    demoVault.pendingEmail = true;
    return ok({ ok: true, needsEmailOtp: true });
  }
  if (method === "POST" && p === "/vault/unlock/email") {
    const b = body as { emailCode?: string };
    if (!demoVault.pendingEmail || b.emailCode !== "654321") {
      demoFail(403, "El código del correo no es válido o ha caducado.");
    }
    demoVault.pendingEmail = false;
    demoVault.unlocked = true;
    return ok({ ok: true, needsEmailOtp: false, kdf: demoVault.kdf, kdfIterations: demoVault.kdfIterations, salt: demoVault.salt, checkNonce: demoVault.checkNonce, checkCipher: demoVault.checkCipher });
  }
  if (method === "POST" && p === "/vault/lock") {
    demoVault.unlocked = false;
    demoVault.pendingEmail = false;
    return ok({ ok: true });
  }
  if (method === "POST" && p === "/vault/rekey") {
    const b = body as { twoFactorCode?: string; kdf?: string; kdfIterations?: number; salt?: string; checkNonce?: string; checkCipher?: string; items?: Array<DemoVaultItem & { id?: string }> };
    demoRejectPlain(body);
    demoRequireTotp(b.twoFactorCode);
    if (!demoVault.exists || !demoVault.unlocked) demoFail(403);
    if (b.kdf !== "pbkdf2-sha256") demoFail(400);
    const incoming = b.items ?? [];
    if (incoming.length !== demoVault.items.length) demoFail(400);
    const byId = new Map(demoVault.items.map((it) => [it.id, it]));
    const now = iso(new Date());
    for (const row of incoming) {
      const item = row.id ? byId.get(row.id) : undefined;
      if (!item || !row.nonce || !row.ciphertext) demoFail(400);
      item.nonce = row.nonce;
      item.ciphertext = row.ciphertext;
      item.version = row.version ?? item.version;
      item.updatedAt = now;
    }
    demoVault.kdf = b.kdf;
    demoVault.kdfIterations = b.kdfIterations ?? 600_000;
    demoVault.salt = b.salt ?? "";
    demoVault.checkNonce = b.checkNonce ?? "";
    demoVault.checkCipher = b.checkCipher ?? "";
    return ok({ ok: true, kdf: demoVault.kdf, kdfIterations: demoVault.kdfIterations, salt: demoVault.salt, checkNonce: demoVault.checkNonce, checkCipher: demoVault.checkCipher });
  }
  if (method === "GET" && p === "/vault/backup") {
    if (!demoVault.unlocked) demoFail(403);
    return ok({
      version: 1,
      kind: "dayly-cofre",
      exportedAt: iso(new Date()),
      kdf: demoVault.kdf,
      kdfIterations: demoVault.kdfIterations,
      salt: demoVault.salt,
      checkNonce: demoVault.checkNonce,
      checkCipher: demoVault.checkCipher,
      items: demoVault.items.map((it) => ({ nonce: it.nonce, ciphertext: it.ciphertext, version: it.version })),
    });
  }
  if (method === "POST" && p === "/vault/import") {
    const b = body as { twoFactorCode?: string; kdf?: string; kdfIterations?: number; salt?: string; checkNonce?: string; checkCipher?: string; items?: DemoVaultItem[] };
    demoRejectPlain(body);
    demoRequireTotp(b.twoFactorCode);
    if (demoVault.exists) demoFail(409);
    demoVault.exists = true;
    demoVault.unlocked = true;
    demoVault.pendingEmail = false;
    demoVault.kdf = b.kdf ?? "pbkdf2-sha256";
    demoVault.kdfIterations = b.kdfIterations ?? 600_000;
    demoVault.salt = b.salt ?? "";
    demoVault.checkNonce = b.checkNonce ?? "";
    demoVault.checkCipher = b.checkCipher ?? "";
    const now = iso(new Date());
    demoVault.items = (b.items ?? []).map((it) => ({
      id: nid("vlt"), nonce: it.nonce, ciphertext: it.ciphertext, version: it.version ?? 1, createdAt: now, updatedAt: now,
    }));
    return send(201, { ok: true, imported: demoVault.items.length, kdf: demoVault.kdf, kdfIterations: demoVault.kdfIterations, salt: demoVault.salt, checkNonce: demoVault.checkNonce, checkCipher: demoVault.checkCipher });
  }
  if (method === "POST" && p === "/vault/destroy") {
    const b = body as { twoFactorCode?: string };
    demoRejectPlain(body);
    demoRequireTotp(b.twoFactorCode);
    if (!demoVault.exists) demoFail(404);
    demoVault.exists = false;
    demoVault.unlocked = false;
    demoVault.pendingEmail = false;
    demoVault.items = [];
    demoVault.salt = "";
    demoVault.checkNonce = "";
    demoVault.checkCipher = "";
    return ok({ ok: true });
  }
  if (method === "GET" && p === "/vault/items") {
    if (!demoVault.unlocked) demoFail(403);
    return ok({ items: demoVault.items });
  }
  if (method === "POST" && p === "/vault/items/import") {
    const b = body as { items?: Array<{ nonce?: string; ciphertext?: string; version?: number }> };
    demoRejectPlain(body);
    if (!demoVault.unlocked) demoFail(403);
    const incoming = Array.isArray(b.items) ? b.items : [];
    if (!incoming.length) demoFail(400, "No hay entradas que importar.");
    const room = Math.max(0, 500 - demoVault.items.length);
    if (room <= 0) demoFail(400, "El Cofre ya tiene 500 entradas.");
    const now = iso(new Date());
    const batch = incoming.slice(0, room);
    for (const row of batch) {
      if (!row.nonce || !row.ciphertext) demoFail(400);
      demoVault.items.unshift({
        id: nid("vlt"), nonce: row.nonce, ciphertext: row.ciphertext, version: row.version ?? 1, createdAt: now, updatedAt: now,
      });
    }
    return send(201, { ok: true, imported: batch.length, skipped: incoming.length - batch.length });
  }
  if (method === "POST" && p === "/vault/items/delete") {
    const b = body as { ids?: string[] };
    if (!demoVault.unlocked) demoFail(403);
    const ids = new Set((Array.isArray(b.ids) ? b.ids : []).filter(Boolean));
    if (!ids.size) demoFail(400, "No hay entradas que borrar.");
    const before = demoVault.items.length;
    demoVault.items = demoVault.items.filter((item) => !ids.has(item.id));
    return ok({ ok: true, deleted: before - demoVault.items.length });
  }
  if (method === "POST" && p === "/vault/items") {
    const b = body as { nonce?: string; ciphertext?: string; version?: number };
    demoRejectPlain(body);
    if (!demoVault.unlocked) demoFail(403);
    if (!b.nonce || !b.ciphertext) demoFail(400);
    const now = iso(new Date());
    const item: DemoVaultItem = { id: nid("vlt"), nonce: b.nonce, ciphertext: b.ciphertext, version: b.version ?? 1, createdAt: now, updatedAt: now };
    demoVault.items.unshift(item);
    return send(201, { item });
  }
  {
    const patchItem = p.match(/^\/vault\/items\/([^/]+)$/);
    if (patchItem && method === "PATCH") {
      const b = body as { nonce?: string; ciphertext?: string; version?: number };
      demoRejectPlain(body);
      if (!demoVault.unlocked) demoFail(403);
      const item = demoVault.items.find((x) => x.id === patchItem[1]);
      if (!item) demoFail(404);
      if (!b.nonce || !b.ciphertext) demoFail(400);
      item.nonce = b.nonce;
      item.ciphertext = b.ciphertext;
      if (b.version) item.version = b.version;
      item.updatedAt = iso(new Date());
      return ok({ item });
    }
    if (patchItem && method === "DELETE") {
      if (!demoVault.unlocked) demoFail(403);
      const idx = demoVault.items.findIndex((x) => x.id === patchItem[1]);
      if (idx < 0) demoFail(404);
      demoVault.items.splice(idx, 1);
      return ok({ ok: true });
    }
  }

  // ---------- Mascot ----------
  // The demo has no model behind it: the task assistants stay hidden.
  if (method === "GET" && p === "/ai/status") return ok({ available: false });
  if (method === "GET" && p === "/integrations") return ok({ integrations: { telegram: "AVAILABLE", whatsapp: "AVAILABLE", gmailGoogle: "AVAILABLE" } });
  if (method === "GET" && p === "/mascot/settings") {
    return ok({ settings: mascotPublic() });
  }
  if (method === "PATCH" && p === "/mascot/settings") {
    const b = body as { enabled?: boolean; character?: string; provider?: string; model?: string; baseUrl?: string | null; modelsUrl?: string | null; apiKey?: string; clearKey?: boolean; footballApiKey?: string; clearFootballKey?: boolean };
    if (typeof b.enabled === "boolean") mascot.enabled = b.enabled;
    if (b.character === "calen" || b.character === "tashi" || b.character === "nubo" || b.character === "foco" || b.character === "posti" || b.character === "orbi") mascot.character = b.character;
    if (b.provider) mascot.provider = b.provider;
    if (b.model) mascot.model = b.model;
    if (b.baseUrl !== undefined) mascot.baseUrl = b.baseUrl;
    if (b.modelsUrl !== undefined) mascot.modelsUrl = b.modelsUrl;
    const slot = (mascot.provider === "openrouter" || mascot.provider === "custom" ? mascot.provider : "opencode") as keyof typeof mascot.keys;
    if (b.apiKey) mascot.keys[slot] = { hasKey: true, valid: false };
    if (b.clearKey) mascot.keys[slot] = { hasKey: false, valid: false };
    if (b.footballApiKey) mascot.hasFootballKey = true;
    if (b.clearFootballKey) mascot.hasFootballKey = false;
    return ok({ settings: mascotPublic() });
  }
  if (method === "GET" && p === "/mascot/models") {
    const provider = query.provider ?? "opencode";
    if (provider === "custom") {
      const url = query.modelsUrl || mascot.modelsUrl;
      if (!url) return ok({ models: [] });
      return ok({ models: [{ id: "llama-3.1-8b-instant", label: "llama-3.1-8b-instant" }] });
    }
    if (provider === "openrouter") return ok({ models: [{ id: "openrouter/free", label: "openrouter/free" }] });
    return ok({
      models: [
        { id: "auto-free", label: "Auto (gratis y rápido)" },
        { id: "mimo-v2.5-free", label: "mimo-v2.5-free", lane: "zen" },
        { id: "hy3-free", label: "hy3-free", lane: "zen" },
        { id: "ox-alpha-free", label: "ox-alpha-free", lane: "go" },
        { id: "mimo-v2.5", label: "mimo-v2.5", lane: "go" },
      ],
    });
  }
  if (method === "POST" && p === "/mascot/test") {
    const slot = (mascot.provider === "openrouter" || mascot.provider === "custom" ? mascot.provider : "opencode") as keyof typeof mascot.keys;
    if (!mascot.keys[slot].hasKey) demoFail(400);
    mascot.keys[slot] = { hasKey: true, valid: true };
    return ok({ ok: true, model: mascot.model === "auto-free" ? "ox-alpha-free" : mascot.model, preview: "ok" });
  }
  if (method === "POST" && p === "/mascot/chat") {
    const msgs = (body as { messages?: { role: string; content: string }[] })?.messages ?? [];
    const last = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const radio = demoRadioAction(last);
    return ok({
      reply: radio?.reply ?? demoMascotReply(last),
      model: mascot.model === "auto-free" ? "ox-alpha-free" : mascot.model,
      actions: radio ? [radio.action] : [],
    });
  }

  // ---------- Subscriptions ----------
  if (method === "GET" && p === "/subscriptions/methods") return ok({ methods: [...S.paymentMethods].sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.alias.localeCompare(b.alias)) });
  if (method === "POST" && p === "/subscriptions/methods") {
    const b = body as { alias?: string; kind?: PaymentMethod["kind"]; last4?: string | null };
    const alias = (b.alias ?? "").trim();
    if (!alias) demoFail(422, "Ponle un nombre al método de pago.");
    if (/(?:\d[ -]?){13,19}/.test(alias)) demoFail(422, "No escribas aquí el número de la tarjeta.");
    if (b.last4 && !/^\d{4}$/.test(b.last4)) demoFail(422, "Son exactamente 4 dígitos.");
    if (S.paymentMethods.some((x) => x.alias === alias)) demoFail(409, "Ya tienes un método de pago con ese nombre.");
    const created: PaymentMethod = { id: nid("pmt"), alias, kind: b.kind ?? "OTHER", last4: b.last4 ?? null, archivedAt: null };
    S.paymentMethods.push(created);
    return ok({ method: created });
  }
  if ((m = p.match(/^\/subscriptions\/methods\/([^/]+)$/))) {
    const found = S.paymentMethods.find((x) => x.id === m![1]);
    if (!found) demoFail(404, "El método de pago no existe.");
    if (method === "PATCH") {
      const b = body as { alias?: string; kind?: PaymentMethod["kind"]; last4?: string | null; archived?: boolean };
      if (b.alias !== undefined) found.alias = b.alias.trim();
      if (b.kind !== undefined) found.kind = b.kind;
      if (b.last4 !== undefined) found.last4 = b.last4;
      if (b.archived !== undefined) found.archivedAt = b.archived ? iso(new Date()) : null;
      return ok({ method: found });
    }
    if (method === "DELETE") {
      const inUse = S.subscriptions.some((x) => x.paymentMethodId === found.id);
      if (inUse) { found.archivedAt = iso(new Date()); return ok({ ok: true, archived: true, method: found }); }
      S.paymentMethods = S.paymentMethods.filter((x) => x.id !== found.id);
      return ok({ ok: true, archived: false });
    }
  }

  if (method === "GET" && p === "/subscriptions/tags") return ok({ tags: [...S.subscriptionTags].sort((a, b) => a.name.localeCompare(b.name)) });
  if (method === "POST" && p === "/subscriptions/tags") {
    const b = body as { name?: string; color?: string | null };
    const name = (b.name ?? "").trim();
    if (!name) demoFail(422, "Escribe el nombre de la etiqueta.");
    if (S.subscriptionTags.some((t) => t.name === name)) demoFail(409, "Ya tienes una etiqueta de suscripciones con ese nombre.");
    const created: SubscriptionTag = { id: nid("stg"), name, color: b.color ?? "#3b82f6" };
    S.subscriptionTags.push(created);
    return ok({ tag: created });
  }
  if ((m = p.match(/^\/subscriptions\/tags\/([^/]+)$/))) {
    const tag = S.subscriptionTags.find((t) => t.id === m![1]);
    if (!tag) demoFail(404, "La etiqueta no existe.");
    if (method === "PATCH") {
      const b = body as { name?: string; color?: string | null };
      if (b.name !== undefined) tag.name = b.name.trim();
      if (b.color !== undefined) tag.color = b.color;
      for (const sub of S.subscriptions) sub.tags = (sub.tags ?? []).map((t) => (t.id === tag.id ? { ...tag } : t));
      return ok({ tag });
    }
    if (method === "DELETE") {
      S.subscriptionTags = S.subscriptionTags.filter((t) => t.id !== tag.id);
      // The label goes; the subscriptions stay.
      for (const sub of S.subscriptions) sub.tags = (sub.tags ?? []).filter((t) => t.id !== tag.id);
      return ok({ ok: true });
    }
  }

  if (method === "GET" && p === "/subscriptions/summary") {
    const active = S.subscriptions.filter((x) => x.status === "ACTIVE");
    const monthlyCents = Math.round(active.reduce((sum, x) => sum + x.amountCents / Math.max(1, x.cycleMonths), 0));
    const year = T0.getFullYear();
    const paidThisYearCents = S.subscriptionCharges
      .filter((c) => c.status === "PAID" && c.dueDate.startsWith(String(year)))
      .reduce((sum, c) => sum + c.amountCents, 0);
    const horizon = demoAddMonths(demoYmd(T0), 3, 28);
    const upcoming: { subscriptionId: string; name: string; dueDate: string; amountCents: number }[] = [];
    for (const sub of active) {
      for (const due of demoForecast(sub, horizon)) upcoming.push({ subscriptionId: sub.id, name: sub.name, dueDate: due, amountCents: sub.amountCents });
    }
    upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const tagRows = new Map<string, { tagId: string | null; name: string; color?: string | null; monthlyCents: number }>();
    const methodRows = new Map<string, { methodId: string | null; name: string; monthlyCents: number }>();
    for (const sub of active) {
      const share = Math.round(sub.amountCents / Math.max(1, sub.cycleMonths));
      const tags = sub.tags ?? [];
      if (!tags.length) {
        const row = tagRows.get("") ?? { tagId: null, name: "Sin etiqueta", color: null, monthlyCents: 0 };
        row.monthlyCents += share; tagRows.set("", row);
      } else {
        const per = Math.round(share / tags.length);
        for (const t of tags) {
          const row = tagRows.get(t.id) ?? { tagId: t.id, name: t.name, color: t.color, monthlyCents: 0 };
          row.monthlyCents += per; tagRows.set(t.id, row);
        }
      }
      const key = sub.paymentMethodId ?? "";
      const pm = S.paymentMethods.find((x) => x.id === sub.paymentMethodId);
      const row = methodRows.get(key) ?? { methodId: sub.paymentMethodId ?? null, name: pm ? demoMethodLabel(pm) : "Sin método", monthlyCents: 0 };
      row.monthlyCents += share; methodRows.set(key, row);
    }
    return ok({
      counts: { active: active.length, paused: S.subscriptions.filter((x) => x.status === "PAUSED").length, cancelled: S.subscriptions.filter((x) => x.status === "CANCELLED").length },
      monthlyCents,
      yearlyProjectionCents: monthlyCents * 12,
      paidThisYearCents,
      next3MonthsCents: upcoming.reduce((sum, u) => sum + u.amountCents, 0),
      upcoming: upcoming.slice(0, 40),
      byTag: [...tagRows.values()].sort((a, b) => b.monthlyCents - a.monthlyCents),
      byMethod: [...methodRows.values()].sort((a, b) => b.monthlyCents - a.monthlyCents),
      year,
    });
  }

  if (method === "GET" && p === "/subscriptions") {
    let list = [...S.subscriptions];
    if (query.status) list = list.filter((x) => x.status === query.status);
    if (query.tagId) list = list.filter((x) => (x.tags ?? []).some((t) => t.id === query.tagId));
    if (query.methodId) list = list.filter((x) => x.paymentMethodId === query.methodId);
    list.sort((a, b) => a.status.localeCompare(b.status) || a.nextChargeDate.localeCompare(b.nextChargeDate));
    return ok({ subscriptions: list });
  }
  if (method === "POST" && p === "/subscriptions") {
    const b = body as Record<string, any>;
    if (!b.amountCents || b.amountCents < 1) demoFail(422, "El importe debe ser mayor que cero.");
    const anchorDay = Number(b.anchorDay);
    const first = String(b.firstChargeDate).slice(0, 10);
    const pm = S.paymentMethods.find((x) => x.id === b.paymentMethodId) ?? null;
    const created: Subscription = {
      id: nid("sub"), name: String(b.name).trim(), vendor: b.vendor ?? null, notes: b.notes ?? null,
      amountCents: b.amountCents, currency: "EUR", cycleMonths: b.cycleMonths ?? 1, anchorDay,
      status: b.status ?? "ACTIVE", nextChargeDate: demoAddMonths(first, 0, anchorDay),
      paymentMethodId: pm?.id ?? null, paymentMethod: pm,
      alertHour: b.alertHour ?? 9, notifyInApp: b.notifyInApp ?? true, notifyTelegram: b.notifyTelegram ?? false,
      notifyEmail: b.notifyEmail ?? false, alertDaysBefore: b.alertDaysBefore ?? [7, 1, 0],
      tags: S.subscriptionTags.filter((t) => (b.tagIds ?? []).includes(t.id)),
    };
    S.subscriptions.push(created);
    return ok({ subscription: created });
  }
  if ((m = p.match(/^\/subscriptions\/([^/]+)\/charges\/([^/]+)$/)) && method === "DELETE") {
    const sub = S.subscriptions.find((x) => x.id === m![1]);
    if (!sub) demoFail(404, "La suscripción no existe.");
    const charge = S.subscriptionCharges.find((c) => c.id === m![2] && c.subscriptionId === sub.id);
    if (!charge) demoFail(404, "El cargo no existe.");
    S.subscriptionCharges = S.subscriptionCharges.filter((c) => c.id !== charge.id);
    if (sub.status === "ACTIVE" && charge.dueDate < sub.nextChargeDate) sub.nextChargeDate = charge.dueDate;
    return ok({ ok: true });
  }
  if ((m = p.match(/^\/subscriptions\/([^/]+)\/charges$/)) && method === "POST") {
    const sub = S.subscriptions.find((x) => x.id === m![1]);
    if (!sub) demoFail(404, "La suscripción no existe.");
    const b = body as { dueDate: string; status: "PAID" | "SKIPPED"; amountCents?: number };
    const dueDate = String(b.dueDate).slice(0, 10);
    const pm = S.paymentMethods.find((x) => x.id === sub.paymentMethodId);
    const amountCents = b.status === "SKIPPED" ? 0 : (b.amountCents ?? sub.amountCents);
    const existing = S.subscriptionCharges.find((c) => c.subscriptionId === sub.id && c.dueDate === dueDate);
    const charge: SubscriptionCharge = existing ?? {
      id: nid("chg"), subscriptionId: sub.id, dueDate, paidAt: null, amountCents, status: b.status,
      methodLabel: pm ? demoMethodLabel(pm) : null,
    };
    charge.amountCents = amountCents;
    charge.status = b.status;
    charge.paidAt = b.status === "PAID" ? iso(new Date()) : null;
    if (!existing) S.subscriptionCharges.push(charge);
    if (sub.status === "ACTIVE" && dueDate >= sub.nextChargeDate) sub.nextChargeDate = demoAddMonths(dueDate, sub.cycleMonths, sub.anchorDay);
    return ok({ charge, nextChargeDate: sub.nextChargeDate });
  }
  if ((m = p.match(/^\/subscriptions\/([^/]+)$/))) {
    const sub = S.subscriptions.find((x) => x.id === m![1]);
    if (!sub) demoFail(404, "La suscripción no existe.");
    if (method === "GET") {
      const charges = S.subscriptionCharges.filter((c) => c.subscriptionId === sub.id).sort((a, b2) => b2.dueDate.localeCompare(a.dueDate));
      const settled = new Set(charges.map((c) => c.dueDate));
      const forecast = sub.status === "CANCELLED" ? [] : demoForecast(sub, demoAddMonths(demoYmd(T0), 12, 28))
        .filter((d) => !settled.has(d))
        .map((d) => ({ dueDate: d, amountCents: sub.amountCents }));
      return ok({ subscription: sub, charges, forecast });
    }
    if (method === "PATCH") {
      const b = body as Record<string, any>;
      for (const k of ["name", "vendor", "notes", "amountCents", "cycleMonths", "alertHour", "notifyInApp", "notifyTelegram", "notifyEmail", "alertDaysBefore", "status"]) {
        if (b[k] !== undefined) (sub as unknown as Record<string, unknown>)[k] = b[k];
      }
      if (b.paymentMethodId !== undefined) {
        sub.paymentMethodId = b.paymentMethodId ?? null;
        sub.paymentMethod = S.paymentMethods.find((x) => x.id === b.paymentMethodId) ?? null;
      }
      if (b.tagIds !== undefined) sub.tags = S.subscriptionTags.filter((t) => b.tagIds.includes(t.id));
      if (b.anchorDay !== undefined) sub.anchorDay = b.anchorDay;
      if (b.firstChargeDate !== undefined || b.anchorDay !== undefined) {
        sub.nextChargeDate = demoAddMonths(String(b.firstChargeDate ?? sub.nextChargeDate).slice(0, 10), 0, sub.anchorDay);
      }
      return ok({ subscription: sub });
    }
    if (method === "DELETE") {
      S.subscriptions = S.subscriptions.filter((x) => x.id !== sub.id);
      S.subscriptionCharges = S.subscriptionCharges.filter((c) => c.subscriptionId !== sub.id);
      return ok({ ok: true });
    }
  }

  // No stream in the demo, so nobody ever sees it; answered anyway to keep
  // the console free of "route not implemented".
  if (method === "POST" && /^\/chat\/(threads|groups)\/[^/]+\/typing$/.test(p)) return ok({ ok: true });

  // Undo after a delete: the demo soft-deletes the same way the API does, so
  // restoring is just clearing the mark.
  if (method === "POST" && (m = p.match(/^\/(tasks|events|notes|projects|goals)\/([^/]+)\/restore$/))) {
    const collection = ({ tasks: S.tasks, events: S.events, notes: S.notes, projects: S.projects, goals: S.goals } as Record<string, { id: string; deletedAt?: string | null }[]>)[m![1]];
    const item = collection?.find((x) => x.id === m![2]);
    if (!item) demoFail(404, "No encontrado.");
    item.deletedAt = null;
    return ok({ ok: true });
  }

  // Fallback
  console.warn("[dayly-demo] no handler:", method, p);
  return send(404, { error: { code: "NOT_FOUND", message: "Demo: ruta no implementada.", details: { method, p } } });
}

function demoReply(input: {
  conversation: MessagingConversation;
  body: string;
  sendAt: string;
  status?: ScheduledReply["status"];
  quotedMessageId?: string | null;
  pauseOnActivity?: boolean;
  confirmedVersion?: number | null;
  errorCode?: string | null;
  error?: string | null;
}): ScheduledReply {
  const now = iso(new Date());
  return {
    id: nid("msg-draft"),
    conversationId: input.conversation.id,
    quotedMessageId: input.quotedMessageId ?? null,
    body: input.body,
    sendAt: input.sendAt,
    timezone: "Europe/Madrid",
    status: input.status ?? "AWAITING_CONFIRMATION",
    draftVersion: 1,
    confirmedVersion: input.confirmedVersion ?? null,
    pauseOnActivity: input.pauseOnActivity ?? true,
    provider: input.conversation.provider,
    recipient: input.conversation.displayName,
    accountLabel: input.conversation.accountLabel,
    replyWindowEndsAt: input.conversation.replyWindowEndsAt,
    canConfirm: Boolean(input.conversation.replyWindowEndsAt && new Date(input.sendAt).getTime() < new Date(input.conversation.replyWindowEndsAt).getTime()),
    errorCode: input.errorCode ?? null,
    error: input.error ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function own<T extends { id: string }>(arr: T[], id: string): T {
  const it = arr.find((x) => x.id === id);
  if (!it) throw Object.assign(new Error("not found"), { status: 404 });
  return it;
}
function goalProgress(g: Goal): number | null {
  const tasks = g.tasks ?? [];
  if (tasks.length) return Math.round((tasks.filter((t) => t.status === "COMPLETED").length / tasks.length) * 100);
  return null;
}
function projectTasks(projectId: string) {
  return S.tasks.filter((t) => t.projectId === projectId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt));
}
function projectProgress(projectId: string): number {
  const tasks = projectTasks(projectId);
  const project = S.projects.find((p) => p.id === projectId);
  if (!tasks.length) return project?.status === "COMPLETED" ? 100 : 0;
  return Math.round((tasks.filter((t) => t.status === "COMPLETED").length / tasks.length) * 100);
}
function projectListItem(p: Project) {
  const tasks = projectTasks(p.id);
  return {
    ...p,
    _count: { tasks: tasks.length },
    progress: projectProgress(p.id),
    pendingTasks: tasks.filter((t) => t.status !== "COMPLETED").map((t) => ({ id: t.id, title: t.title })),
  };
}

function demoMethodLabel(m: PaymentMethod): string {
  return m.last4 ? `${m.alias} ····${m.last4}` : m.alias;
}

/** Forecast days from today up to `toYmd`, rebuilt from the anchor each step. */
function demoForecast(sub: Subscription, toYmd: string): string[] {
  const from = demoYmd(T0);
  const out: string[] = [];
  let ymd = sub.nextChargeDate;
  for (let i = 0; i < 60 && ymd <= toYmd; i++) {
    if (ymd >= from) out.push(ymd);
    ymd = demoAddMonths(ymd, sub.cycleMonths, sub.anchorDay);
  }
  return out;
}

/** Last group buzz per group in the demo, for the cooldown. */
const demoGroupBuzz = new Map<string, number>();
