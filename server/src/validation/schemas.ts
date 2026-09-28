import { z } from "zod";
import { PASSWORD_POLICY } from "../lib/crypto.js";
import { isAllowedPushEndpoint } from "../lib/pushAllowlist.js";
import { NOTIFY_SOUND_IDS } from "../lib/notifySound.js";

// ---------- Shared primitives ----------
export const cuid = z.string().min(1).regex(/^[a-zA-Z0-9]+$/, "ID no válido");
export const optionalId = z.string().min(1).max(80).nullish();
export const priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const taskStatus = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"]);
export const projectStatus = z.enum(["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
export const theme = z.enum(["LIGHT", "DARK", "SYSTEM"]);
export const wallpaper = z.string().min(1).max(32).regex(/^(none|custom|[a-z][a-z0-9]{0,30})$/);
export const skin = z.enum([
  "ink", "graphite", "slate", "forest", "clay", "wine", "copper", "sea",
  "gold", "royal", "amethyst", "ice",
]);
export const isoDate = z.string().refine((v) => !isNaN(Date.parse(v)), "Fecha no válida");
// ISO datetime offset string (handles timezones correctly)
export const isoDateTime = z.string().refine((v) => !isNaN(Date.parse(v)), "Fecha/hora no válida");

const passwordSchema = z
  .string()
  .min(PASSWORD_POLICY.minLength, `La contraseña debe tener al menos ${PASSWORD_POLICY.minLength} caracteres`)
  .max(128)
  .regex(/[A-Z]/, "Debe incluir una mayúscula")
  .regex(/[a-z]/, "Debe incluir una minúscula")
  .regex(/[0-9]/, "Debe incluir un número");

const tagColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido");

/**
 * Avatars travel as a data URL and live in a TEXT column, so the cap is what
 * keeps a 20 MB photo out of the database. Shared by the user avatar and the
 * group photo: one rule, one place to change it.
 */
export const avatarDataUrl = z.union([
  z.null(),
  z.string()
    .max(180_000, "La foto es demasiado grande")
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Imagen no válida"),
]);

// ---------- Auth ----------
export const registerSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  email: z.string().trim().toLowerCase().email("Email no válido").max(190),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email no válido"),
  password: z.string().min(1, "Introduce tu contraseña"),
  twoFactorCode: z.string().trim().min(6).max(24).optional(),
});

export const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email no válido"),
});

export const resetSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const setup2faSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  code: z.string().trim().min(6).max(24).optional(),
});

export const enable2faSchema = z.object({ code: z.string().trim().min(6).max(6) });
export const verify2faLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email no válido"),
  twoFactorCode: z.string().trim().min(6).max(6),
});

export const firstPasswordSchema = z.object({
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const quickPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "El PIN debe tener exactamente 4 dígitos."),
  currentPin: z.string().max(32).optional(),
}).strict();

export const quickPinToggleSchema = z.object({
  enabled: z.boolean(),
  currentPin: z.string().max(32).optional(),
}).strict();

export const quickPinVerifySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "El PIN debe tener exactamente 4 dígitos."),
}).strict();

// ---------- Settings ----------
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80).optional(),
  // Generous on length because the decorations are long; the server trims to
  // NICK_MAX code points after sanitising. Null clears it back to `name`.
  nick: z.string().max(200).nullish(),
  nickColor: tagColor.nullish(),
  // Coloured pieces. Loose here on purpose: the server cleans each piece and
  // caps the total in code points, the same way it does for the plain nick.
  nickSegments: z.array(z.object({ t: z.string().max(200), c: tagColor.nullish() })).max(60).nullish(),
  nickBold: z.boolean().optional(),
  subnick: z.string().max(300).nullish(),
  timezone: z.string().max(80).optional(),
  weatherCity: z.string().trim().max(120).nullish(),
  language: z.string().max(10).optional(),
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  timeFormat24: z.boolean().optional(),
  theme: theme.optional(),
  themeScheduleEnabled: z.boolean().optional(),
  themeDarkStartMin: z.number().int().min(0).max(1439).optional(),
  themeDarkEndMin: z.number().int().min(0).max(1439).optional(),
  skin: skin.optional(),
  wallpaper: wallpaper.optional(),
  // Only ids, bounded: this is written straight back to the sidebar.
  navLayout: z.object({
    order: z.array(z.string().max(40)).max(30).optional(),
    hidden: z.array(z.string().max(40)).max(30).optional(),
    apps: z.array(z.string().max(40)).max(30).optional(),
    mascotSidebar: z.boolean().optional(),
    chatSidebar: z.boolean().optional(),
  }).strict().nullable().optional(),
  density: z.enum(["comfortable", "compact", "cozy"]).optional(),
  calendarStartHour: z.number().int().min(0).max(23).optional(),
  calendarEndHour: z.number().int().min(0).max(23).optional(),
  defaultEventDurationMin: z.number().int().min(5).max(480).optional(),
  defaultPriority: priority.optional(),
  notifyReminders: z.boolean().optional(),
  notifySound: z.enum(NOTIFY_SOUND_IDS).optional(),
  notifySoundEnabled: z.boolean().optional(),
  notifyTelegramReminders: z.boolean().optional(),
  notifyEvents: z.boolean().optional(),
  notifyTasks: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  emailNotificationDelayMin: z.number().int().min(0).max(1440).optional(),
  avatarUrl: avatarDataUrl.optional(),
});

/** A photo the client already cropped and compressed. Null clears it. */
export const groupPhotoSchema = z.object({ avatarUrl: avatarDataUrl });

// ---------- Recurrence ----------
export const recurrenceSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"]),
  interval: z.number().int().min(1).max(365).default(1),
  byDay: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  count: z.number().int().min(1).max(1000).nullish(),
  endDate: isoDate.nullish(),
});

// ---------- Tasks ----------
/** Board card background: explicit "none", the project colour or a custom colour. */
export const taskCardFill = z.union([z.literal("none"), z.literal("project"), tagColor]);

const taskFields = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(300),
  description: z.string().max(5000).nullish(),
  dueDate: isoDateTime.nullish(),
  dueEndDate: isoDateTime.nullish(),
  hasTime: z.boolean().optional(),
  priority: priority.optional(),
  notifyTelegram: z.boolean().optional(),
  status: taskStatus.optional(),
  projectId: optionalId,
  color: z.string().max(20).nullish(),
  cardFill: taskCardFill.nullish(),
  estimateMinutes: z.number().int().min(0).max(100000).nullish(),
  notes: z.string().max(5000).nullish(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  tagIds: z.array(cuid).max(50).optional(),
  goalIds: z.array(cuid).max(20).optional(),
  subtasks: z
    .array(z.object({ title: z.string().trim().min(1).max(300) }))
    .max(200)
    .optional(),
  reminder: z
    .object({
      remindAt: isoDateTime,
      title: z.string().max(300).nullish(),
      scheduleDaily: z.boolean().optional(),
    })
    .nullish(),
  recurrence: recurrenceSchema.nullish(),
});

function dueRangeOk(value: { dueDate?: string | null; dueEndDate?: string | null }): boolean {
  if (!value.dueDate || !value.dueEndDate) return true;
  return new Date(value.dueEndDate).getTime() > new Date(value.dueDate).getTime();
}

export const createTaskSchema = taskFields.refine(dueRangeOk, { message: "La fecha final debe ser posterior a la inicial.", path: ["dueEndDate"] });
export const updateTaskSchema = taskFields.partial().refine(dueRangeOk, { message: "La fecha final debe ser posterior a la inicial.", path: ["dueEndDate"] });
export const moveTaskSchema = z.object({
  dueDate: isoDateTime.nullable().or(z.literal("")),
  hasTime: z.boolean().optional(),
});

export const reorderProjectTasksSchema = z.object({
  ids: z.array(cuid).min(1).max(500),
});

export const snoozeTaskSchema = z.object({
  minutes: z.literal(10),
  occurrenceAt: isoDateTime.optional(),
}).strict();

// ---------- Events ----------
export const createEventSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(300),
  description: z.string().max(5000).nullish(),
  startAt: isoDateTime,
  endAt: isoDateTime,
  allDay: z.boolean().optional(),
  location: z.string().max(300).nullish(),
  category: z.string().max(80).nullish(),
  color: z.string().max(20).nullish(),
  priority: priority.optional(),
  url: z.string().url("URL no válida").max(500).nullish().or(z.literal("").transform(() => null)),
  projectId: optionalId,
  status: taskStatus.optional(),
  tagIds: z.array(cuid).max(50).optional(),
  reminderMin: z.number().int().min(0).max(10080).nullish(),
  notifyTelegram: z.boolean().optional(),
  recurrence: recurrenceSchema.nullish(),
});

export const updateEventSchema = createEventSchema
  .partial()
  .extend({ startAt: isoDateTime.optional(), endAt: isoDateTime.optional() });
export const moveEventSchema = z.object({
  startAt: isoDateTime,
  endAt: isoDateTime,
  allDay: z.boolean().optional(),
}).refine((value) => new Date(value.endAt).getTime() > new Date(value.startAt).getTime(), {
  message: "La hora final debe ser posterior a la inicial.",
  path: ["endAt"],
});

// ---------- Notes ----------
export const createNoteSchema = z.object({
  title: z.string().max(300).default("Sin título"),
  content: z.string().max(200000).nullish(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  favorite: z.boolean().optional(),
  color: z.string().max(20).nullish(),
  folderId: optionalId,
  projectId: optionalId,
  tagIds: z.array(cuid).max(50).optional(),
});
export const updateNoteSchema = createNoteSchema.partial();

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: optionalId,
});
export const updateFolderSchema = createFolderSchema.partial();

// ---------- Projects ----------
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(200),
  description: z.string().max(5000).nullish(),
  color: z.string().max(20).nullish(),
  status: projectStatus.optional(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  tagIds: z.array(cuid).max(50).optional(),
});
export const updateProjectSchema = createProjectSchema.partial();

// ---------- Tags ----------
export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: tagColor.nullish(),
});
export const updateTagSchema = createTagSchema.partial().refine((body) => Object.keys(body).length > 0, "No hay cambios.");

// ---------- Habits ----------
export const createHabitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().max(20).nullish(),
  icon: z.string().max(40).nullish(),
  scheduleDayBits: z.number().int().min(0).max(127).optional(),
  reminderMinuteOfDay: z.number().int().min(0).max(24 * 60 - 1).nullish(),
});
export const updateHabitSchema = createHabitSchema.partial();
export const habitLogSchema = z.object({
  date: isoDate,
  done: z.boolean().optional(),
});

// ---------- Goals ----------
export const createGoalSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(300),
  description: z.string().max(5000).nullish(),
  dueDate: isoDate.nullish(),
  manualProgress: z.number().int().min(-1).max(100).optional(),
  status: taskStatus.optional(),
  projectId: optionalId,
  tagIds: z.array(cuid).max(50).optional(),
  taskIds: z.array(cuid).max(100).optional(),
});
export const updateGoalSchema = createGoalSchema.partial();

// ---------- Reminders ----------
const reminderFields = z.object({
  title: z.string().max(300).nullish(),
  remindAt: isoDateTime,
  endAt: isoDateTime.nullish(),
  scheduleDaily: z.boolean().optional(),
  notifyTelegram: z.boolean().optional(),
  targetType: z.enum(["TASK", "EVENT", "NOTE", "GOAL", "NONE"]).optional(),
  targetId: optionalId,
});

function reminderRangeOk(value: { remindAt?: string; endAt?: string | null }): boolean {
  if (!value.remindAt || !value.endAt) return true;
  return new Date(value.endAt).getTime() > new Date(value.remindAt).getTime();
}

export const createReminderSchema = reminderFields.refine(reminderRangeOk, { message: "La fecha final debe ser posterior a la inicial.", path: ["endAt"] });
export const updateReminderSchema = reminderFields.partial().refine(reminderRangeOk, { message: "La fecha final debe ser posterior a la inicial.", path: ["endAt"] });

// ---------- Time tracking ----------
export const startTimeSchema = z.object({
  taskId: optionalId,
  projectId: optionalId,
  note: z.string().max(500).nullish(),
  source: z.enum(["MANUAL", "POMODORO"]).optional(),
});
export const endTimeSchema = z.object({ note: z.string().max(500).nullish() });

// ---------- Notifications ----------
export const readNotificationsSchema = z.object({
  ids: z.array(cuid).optional(),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(4000).refine(isAllowedPushEndpoint, "Endpoint de push no permitido"),
  keys: z.object({
    p256dh: z.string().trim().min(10).max(500),
    auth: z.string().trim().min(4).max(200),
  }),
});
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().min(10).max(4000),
});

// ---------- Inbox ----------
export const inboxCreateSchema = z.object({
  content: z.string().trim().min(1, "Escribe algo").max(2000),
});
export const inboxConvertSchema = z.object({
  type: z.enum(["TASK", "EVENT", "NOTE"]),
  title: z.string().max(300).optional(),
  dueDate: isoDateTime.optional(),
  startAt: isoDateTime.optional(),
});
export const mailboxCreateSchema = z.object({
  label: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Email no válido").max(190),
  imapHost: z.string().trim().min(1, "Indica el servidor IMAP").max(255),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: z.string().trim().min(1, "Indica el servidor SMTP").max(255),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  username: z.string().trim().min(1).max(190).optional(),
  password: z.string().min(1, "Indica la contraseña").max(500),
});
export const mailboxUpdateSchema = z.object({
  label: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Email no válido").max(190).optional(),
  imapHost: z.string().trim().min(1).max(255).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  username: z.string().trim().min(1).max(190).optional(),
  password: z.string().min(1).max(500).optional(),
});
export const mailboxReplySchema = z.object({
  text: z.string().trim().min(1, "Escribe el mensaje.").max(20_000),
});

// ---------- Search ----------
export const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["all", "task", "event", "note", "project", "goal", "habit"]).optional(),
});

// ---------- Calendar ----------
export const calendarRangeSchema = z.object({
  from: isoDate,
  to: isoDate,
});

// ---------- Import / export ----------
export const exportQuerySchema = z.object({
  format: z.enum(["json", "csv", "ics"]).optional().default("json"),
  types: z.string().max(80).optional(),
});
export const importBodySchema = z.object({
  format: z.enum(["json", "csv", "ics", "auto"]).optional().default("auto"),
  text: z.string().min(1, "El archivo está vacío.").max(800_000, "El archivo es demasiado grande (máximo 800 KB)."),
});

// ---------- Admin ----------
export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email("Email no válido").max(190),
  password: passwordSchema,
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});
export const adminUpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export const adminResetPasswordSchema = z.object({
  password: passwordSchema,
});
export const adminListSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminSmtpSettingsSchema = z.object({
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(190),
  password: z.string().max(500).optional(),
  fromAddress: z.string().trim().min(1).max(255),
});
export const adminTelegramSettingsSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const radioStreamInfoSchema = z.object({
  stationId: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().min(8).max(500),
});

export const adminSpotifySettingsSchema = z.object({
  clientId: z.string().trim().max(80).refine((value) => value === "" || /^[A-Za-z0-9]{8,80}$/.test(value), "Client ID no válido").optional(),
  enabled: z.boolean().optional(),
  confirmReconnect: z.boolean().optional(),
}).strict().refine((value) => value.clientId !== undefined || value.enabled !== undefined, "No hay cambios que guardar");

export const adminGoogleOAuthSettingsSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().trim().max(255),
  clientSecret: z.string().max(500).optional(),
  confirmReconnect: z.boolean().optional(),
}).strict();

export const adminGifSettingsSchema = z.object({
  enabled: z.boolean(),
  // Omitted keeps the stored key; empty clears that provider.
  giphyKey: z.string().max(200).optional(),
  klipyKey: z.string().max(200).optional(),
  giphyOn: z.boolean().optional(),
  klipyOn: z.boolean().optional(),
}).strict();

export const adminWhatsAppSettingsSchema = z.object({
  enabled: z.boolean(),
  appId: z.string().trim().max(80),
  appSecret: z.string().max(500).optional(),
  configId: z.string().trim().max(120),
  verifyToken: z.string().max(500).optional(),
  graphVersion: z.string().trim().max(20),
  confirmReconnect: z.boolean().optional(),
}).strict();

const vaultB64 = z.string().regex(/^[A-Za-z0-9_-]+$/, "Blob no válido");

export const vaultUnlockSchema = z.object({
  twoFactorCode: z.string().trim().min(6).max(6),
}).strict();

export const vaultSetupSchema = z.object({
  twoFactorCode: z.string().trim().min(6).max(6),
  kdf: z.literal("pbkdf2-sha256"),
  kdfIterations: z.number().int().min(210_000).max(1_000_000),
  salt: vaultB64.min(16).max(64),
  checkNonce: vaultB64.min(16).max(32),
  checkCipher: vaultB64.min(24).max(24_000),
}).strict();

export const vaultItemBlobSchema = z.object({
  nonce: vaultB64.min(16).max(32),
  ciphertext: vaultB64.min(24).max(24_000),
  version: z.number().int().min(1).max(8).optional(),
}).strict();

export const vaultUnlockEmailSchema = z.object({
  emailCode: z.string().trim().min(6).max(6),
}).strict();

export const vaultImportSchema = z.object({
  twoFactorCode: z.string().trim().min(6).max(6),
  kdf: z.literal("pbkdf2-sha256"),
  kdfIterations: z.number().int().min(210_000).max(1_000_000),
  salt: vaultB64.min(16).max(64),
  checkNonce: vaultB64.min(16).max(32),
  checkCipher: vaultB64.min(24).max(24_000),
  items: z.array(vaultItemBlobSchema).max(500),
}).strict();

export const vaultItemsImportSchema = z.object({
  items: z.array(vaultItemBlobSchema).min(1).max(500),
}).strict();

export const vaultItemsDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(8).max(64)).min(1).max(500),
}).strict();

export const vaultRekeyItemSchema = vaultItemBlobSchema.extend({
  id: z.string().trim().min(8).max(64),
}).strict();

export const vaultRekeySchema = z.object({
  twoFactorCode: z.string().trim().min(6).max(6),
  kdf: z.literal("pbkdf2-sha256"),
  kdfIterations: z.number().int().min(210_000).max(1_000_000),
  salt: vaultB64.min(16).max(64),
  checkNonce: vaultB64.min(16).max(32),
  checkCipher: vaultB64.min(24).max(24_000),
  items: z.array(vaultRekeyItemSchema).max(500),
}).strict();

// ---------- Subscriptions ----------
// The wallet stores a label, never a credential. A 13-19 digit run in the alias
// is almost certainly a pasted card number, so it is refused with a message the
// user can act on instead of being quietly persisted.
const looksLikeCardNumber = (value: string) => /(?:\d[ -]?){13,19}/.test(value);

const paymentMethodFields = z.object({
  alias: z.string().trim().min(1, "Ponle un nombre al método de pago.").max(60)
    .refine((v) => !looksLikeCardNumber(v), "No escribas aquí el número de la tarjeta: con un nombre y los últimos 4 dígitos basta."),
  kind: z.enum(["ACCOUNT", "CARD", "OTHER"]).optional(),
  last4: z.string().trim().regex(/^\d{4}$/, "Son exactamente 4 dígitos.").nullish(),
  color: z.string().max(20).nullish(),
  archived: z.boolean().optional(),
});

export const createPaymentMethodSchema = paymentMethodFields.omit({ archived: true });
export const updatePaymentMethodSchema = paymentMethodFields.partial()
  .refine((body) => Object.keys(body).length > 0, "No hay cambios.");

/** Up to three reminders, each 0-60 days before the charge. */
const alertDaysBefore = z.array(z.number().int().min(0, "Los días de aviso no pueden ser negativos.").max(60)).max(3, "Como mucho 3 avisos por suscripción.");

const subscriptionFields = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  vendor: z.string().trim().max(120).nullish(),
  notes: z.string().max(5000).nullish(),
  // Cents, so 1..100.000.000 is 0,01 € .. 1.000.000 €.
  amountCents: z.number().int("El importe debe ser un número entero de céntimos.").min(1, "El importe debe ser mayor que cero.").max(100_000_000),
  cycleMonths: z.number().int().min(1).max(36),
  anchorDay: z.number().int().min(1).max(31),
  firstChargeDate: isoDate,
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).optional(),
  paymentMethodId: optionalId,
  alertHour: z.number().int().min(0).max(23).optional(),
  notifyInApp: z.boolean().optional(),
  notifyTelegram: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  alertDaysBefore: alertDaysBefore.optional(),
  tagIds: z.array(cuid).max(50).optional(),
});

export const createSubscriptionSchema = subscriptionFields;
export const updateSubscriptionSchema = subscriptionFields.partial()
  .refine((body) => Object.keys(body).length > 0, "No hay cambios.");

// Subscriptions carry their own tag vocabulary, so they get their own schema
// rather than borrowing the task one.
export const createSubscriptionTagSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre de la etiqueta.").max(60),
  color: tagColor.nullish(),
});
export const updateSubscriptionTagSchema = createSubscriptionTagSchema.partial()
  .refine((body) => Object.keys(body).length > 0, "No hay cambios.");

export const settleChargeSchema = z.object({
  dueDate: isoDate,
  status: z.enum(["PAID", "SKIPPED"]),
  // Omitted means "the subscription amount"; sent means the charge was adjusted.
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  paidAt: isoDateTime.nullish(),
});

const integrationDisplay = z.enum(["HIDDEN", "COMING_SOON"]);
export const adminIntegrationVisibilitySchema = z.object({
  telegram: integrationDisplay.optional(),
  whatsapp: integrationDisplay.optional(),
  gmailGoogle: integrationDisplay.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "No hay cambios.");
