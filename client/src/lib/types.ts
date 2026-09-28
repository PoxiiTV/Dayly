/** Shared API resource types (mirror the backend service contracts). */

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "POSTPONED" | "CANCELLED";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type Theme = "LIGHT" | "DARK" | "SYSTEM";
export type { SkinId } from "@/lib/skins";
export type RoleName = "USER" | "ADMIN";

export type NavLayout = {
  order?: string[];
  hidden?: string[];
  apps?: string[];
  /** Keep the mascot chat permanently available in the sidebar. */
  mascotSidebar?: boolean;
  /** Keep a quick conversation composer permanently available in the sidebar. */
  chatSidebar?: boolean;
};

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: RoleName;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  quickPinEnabled: boolean;
  quickPinConfigured: boolean;
  timezone: string;
  weatherCity: string | null;
  language: string;
  firstDayOfWeek: number;
  timeFormat24: boolean;
  theme: Theme;
  themeScheduleEnabled: boolean;
  themeDarkStartMin: number;
  themeDarkEndMin: number;
  skin: string;
  density: string;
  calendarStartHour: number;
  calendarEndHour: number;
  avatarUrl: string | null;
  /** Decorated display name. Null means the account name is shown. */
  nick: string | null;
  nickColor: string | null;
  nickBold: boolean;
  /** Coloured pieces when the nick is multicoloured; null when it is not. */
  nickSegments?: { t: string; c?: string | null }[] | null;
  /** The MSN-style line under the nick; friends of the chat see it. */
  subnick: string | null;
  wallpaper: string;
  /** Sidebar layout and compact mascot placement stored with the account. */
  navLayout?: NavLayout | null;
  notifySound: string;
  notifySoundEnabled: boolean;
  notifyReminders: boolean;
  notifyEvents: boolean;
  notifyTasks: boolean;
  notifyEmail: boolean;
  mustChangePassword?: boolean;
}

export interface Tag { id: string; name: string; color?: string | null; }
export interface Subtask { id: string; title: string; done: boolean; sortOrder: number; }
export interface Task {
  id: string; title: string; description?: string | null;
  dueDate?: string | null; dueEndDate?: string | null; hasTime: boolean; priority: Priority; status: TaskStatus; notifyTelegram?: boolean;
  projectId?: string | null; color?: string | null; cardFill?: string | null; estimateMinutes?: number | null; timeSpentMinutes: number;
  notes?: string | null; deletedAt?: string | null;
  createdAt: string; updatedAt: string; completedAt?: string | null;
  sortOrder?: number;
  /** Position dragged by the user on the board; null follows the automatic order. */
  boardOrder?: number | null;
  subtasks?: Subtask[]; tags?: Tag[]; project?: { id: string; name: string; color?: string | null };
  goals?: { id: string; title: string }[];
  recurrence?: Record<string, unknown> | null;
  instanceKey?: string;
  attachments?: TaskAttachment[];
}
export interface TaskAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}
export interface EventItem {
  id: string; title: string; description?: string | null;
  startAt: string; endAt: string; allDay: boolean;
  location?: string | null; category?: string | null; color?: string | null; priority: Priority;
  url?: string | null; projectId?: string | null; status: TaskStatus; deletedAt?: string | null;
  tags?: Tag[]; project?: { id: string; name: string; color?: string | null };
  recurrence?: Record<string, unknown> | null;
  instanceKey?: string;
}
export interface NoteAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}
export interface Note {
  id: string; title: string; content?: string | null; pinned: boolean; archived: boolean; favorite: boolean;
  color?: string | null; folderId?: string | null; projectId?: string | null; tags?: Tag[];
  attachments?: NoteAttachment[];
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface NoteFolder { id: string; name: string; parentId?: string | null; notes?: { id: string }[]; }
export interface Project {
  id: string; name: string; description?: string | null; color?: string | null; status: ProjectStatus;
  startDate?: string | null; dueDate?: string | null; progress?: number; deletedAt?: string | null;
  _count?: Record<string, number>;
  pendingTasks?: { id: string; title: string }[];
}
export interface Habit { id: string; name: string; color?: string | null; icon?: string | null; scheduleDayBits: number; reminderMinuteOfDay?: number | null; lastReminderKey?: string | null; current?: number; longest?: number; }
export interface Goal { id: string; title: string; description?: string | null; dueDate?: string | null; progress?: number | null; manualProgress: number; status: TaskStatus; projectId?: string | null; tasks?: { id: string; title: string; status: TaskStatus }[]; }
export interface Reminder {
  id: string;
  title?: string | null;
  remindAt: string;
  endAt?: string | null;
  scheduleDaily: boolean;
  notifyTelegram?: boolean;
  targetType: string;
  targetId?: string | null;
  sentAt?: string | null;
  attachments?: TaskAttachment[];
}
/** Subscriptions keep their own vocabulary, unrelated to the task tags. */
export interface SubscriptionTag { id: string; name: string; color?: string | null; }

export type SubscriptionStatus = "ACTIVE" | "PAUSED" | "CANCELLED";
export type PaymentMethodKind = "ACCOUNT" | "CARD" | "OTHER";
export type ChargeStatus = "PAID" | "SKIPPED";

/** A label for where the money comes from. Never a credential: the wallet
 * holds an alias, a kind and at most the last four digits. */
export interface PaymentMethod {
  id: string;
  alias: string;
  kind: PaymentMethodKind;
  last4?: string | null;
  color?: string | null;
  archivedAt?: string | null;
}

export interface Subscription {
  id: string;
  name: string;
  vendor?: string | null;
  notes?: string | null;
  amountCents: number;
  currency: string;
  cycleMonths: number;
  anchorDay: number;
  status: SubscriptionStatus;
  /** Plain YYYY-MM-DD: charges are days, not instants. */
  nextChargeDate: string;
  startedAt?: string | null;
  cancelledAt?: string | null;
  paymentMethodId?: string | null;
  paymentMethod?: PaymentMethod | null;
  alertHour: number;
  notifyInApp: boolean;
  notifyTelegram: boolean;
  notifyEmail: boolean;
  alertDaysBefore: number[];
  tags?: SubscriptionTag[];
}

export interface SubscriptionCharge {
  id: string;
  subscriptionId: string;
  dueDate: string;
  paidAt?: string | null;
  amountCents: number;
  status: ChargeStatus;
  methodLabel?: string | null;
}

export interface SubscriptionForecast { dueDate: string; amountCents: number; }

export interface SubscriptionSummary {
  counts: { active: number; paused: number; cancelled: number };
  monthlyCents: number;
  yearlyProjectionCents: number;
  paidThisYearCents: number;
  next3MonthsCents: number;
  upcoming: { subscriptionId: string; name: string; dueDate: string; amountCents: number }[];
  byTag: { tagId: string | null; name: string; color?: string | null; monthlyCents: number }[];
  byMethod: { methodId: string | null; name: string; monthlyCents: number }[];
  year: number;
}

export interface TimeEntry { id: string; taskId?: string | null; task?: { id: string; title: string } | null; running: boolean; startedAt: string; durationSec: number; note?: string | null; }
export interface NotificationItem { id: string; type: string; title: string; body?: string | null; read: boolean; actionUrl?: string | null; createdAt: string; }
export interface InboxItem { id: string; content: string; archived: boolean; createdAt: string; }
export interface Mailbox {
  id: string;
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  authType?: "password" | "google";
  passwordConfigured: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
  isDefault: boolean;
}
export interface MailMessageListItem {
  uid: number;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  seen: boolean;
  snippet: string;
}
export interface MailMessage extends MailMessageListItem {
  to: string;
  text: string;
  messageId?: string | null;
}

export type MessagingProvider = "TELEGRAM" | "WHATSAPP";
export type ScheduledReplyStatus = "AWAITING_CONFIRMATION" | "SCHEDULED" | "PROCESSING" | "SENT" | "PAUSED" | "REQUIRES_ATTENTION" | "FAILED" | "CANCELED";

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  parameterCount: number;
}

export interface MessagingConnection {
  id: string;
  provider: MessagingProvider;
  status: "PENDING" | "ACTIVE" | "REVOKED" | "ERROR";
  label: string;
  lastError: string | null;
  capabilities: { sendText: boolean; receiveMedia: boolean; sendMedia: false; readReceipts: false; replyWindowHours: number };
  connectedAt: string | null;
  revokedAt: string | null;
  lastWebhookAt: string | null;
}

export interface MessagingConversation {
  id: string;
  provider: MessagingProvider;
  accountLabel: string;
  displayName: string;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  replyWindowEndsAt: string | null;
  canReply: boolean;
  unreadCount: number;
  preview: string;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  scheduledCount: number;
  attentionCount: number;
}

export interface ChannelMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  origin: "CUSTOMER" | "OWNER_DEVICE" | "API";
  kind: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "CONTACT" | "STICKER" | "UNKNOWN";
  body: string;
  attachment: { mimeType?: string; filename?: string; sizeBytes?: number } | null;
  hasMedia: boolean;
  deliveryStatus: "RECEIVED" | "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "UNKNOWN";
  providerSentAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyToMessageId: string | null;
}

export interface ScheduledReply {
  id: string;
  conversationId: string;
  quotedMessageId: string | null;
  body: string;
  sendAt: string;
  timezone: string;
  status: ScheduledReplyStatus;
  draftVersion: number;
  confirmedVersion: number | null;
  pauseOnActivity: boolean;
  isTemplate?: boolean;
  provider?: MessagingProvider;
  recipient?: string;
  accountLabel?: string;
  replyWindowEndsAt: string | null;
  canConfirm: boolean;
  errorCode: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- API envelope ----
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }

// ---------- Chat between users ----------
export type ChatUserCard = {
  id: string;
  name: string;
  /** Their decorated nick, when they set one. */
  nick?: string | null;
  nickSegments?: { t: string; c?: string | null }[] | null;
  nickColor?: string | null;
  nickBold?: boolean;
  /** Their MSN-style line; only people on their list receive it. */
  subnick?: string | null;
  avatarUrl: string | null;
  /** What they picked, or OFFLINE when no client of theirs is alive. */
  status?: string;
};

export type ChatLink = {
  linkId: string;
  user: ChatUserCard;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
  unreadCount: number;
  lastMessageAt: string | null;
  /** Background this side picked, or null. */
  wallpaper?: string | null;
  /** Last line of the conversation, for the list. */
  lastMessage?: string | null;
  lastMessageMine?: boolean | null;
  /** When the other side last read the thread: older messages of mine are seen. */
  otherReadAt?: string | null;
  muted?: boolean;
  otherBuzzAt: string | null;
  blockedByMe: boolean;
  requestedByMe: boolean;
  createdAt: string;
};

export type ChatGroupMember = ChatUserCard & { isOwner?: boolean };

export type ChatGroup = {
  groupId: string;
  name: string;
  /** Group photo. Any participant can change it, not only the owner. */
  avatarUrl?: string | null;
  /** Coloured pieces of the name; null when it is one colour. */
  nameSegments?: { t: string; c?: string | null }[] | null;
  ownerId: string;
  isOwner: boolean;
  members: ChatGroupMember[];
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage?: string | null;
  lastMessageMine?: boolean | null;
  muted: boolean;
  wallpaper?: string | null;
  createdAt: string;
};

export type ChatFriendsResponse = {
  friends: ChatLink[];
  requests: { incoming: ChatLink[]; outgoing: ChatLink[] };
};

export type ChatGif = {
  url: string;
  preview: string;
  width: number;
  height: number;
  description?: string;
};

export type ChatGifFavorite = ChatGif & { id: string; provider: string };

export type ChatFile = {
  transferId: string;
  name: string;
  mime: string;
  size: number;
  image: boolean;
};

export type ChatMessageItem = {
  id: string;
  senderId: string;
  kind: "TEXT" | "BUZZ" | "GIF" | "FILE";
  body: string | null;
  gif?: ChatGif | null;
  file?: ChatFile | null;
  createdAt: string;
};

export type ChatSync = {
  version: string;
  unreadTotal: number;
  pendingIncoming: number;
  threads: { linkId: string; lastMessageAt: string | null; unreadCount: number; otherBuzzAt: string | null }[];
  groups?: { groupId: string; lastMessageAt: string | null; unreadCount: number }[];
};

export type ChatIdentity = {
  friendCode: string;
  discoverableByEmail: boolean;
  buzzEnabled: boolean;
  /** Tone for incoming messages, or "off". */
  sound: string;
  /** ONLINE | AWAY | BUSY. BUSY silences this device. */
  status?: string;
  /** Whether the instance has a GIF provider configured. */
  gifsAvailable?: boolean;
};
