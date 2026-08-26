import { z } from "zod";
import { PASSWORD_POLICY } from "../lib/crypto.js";
import { isAllowedPushEndpoint } from "../lib/pushAllowlist.js";

// ---------- Shared primitives ----------
export const cuid = z.string().min(1).regex(/^[a-zA-Z0-9]+$/, "ID no válido");
export const optionalId = z.string().min(1).max(80).nullish();
export const priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const taskStatus = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "POSTPONED", "CANCELLED"]);
export const projectStatus = z.enum(["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
export const theme = z.enum(["LIGHT", "DARK", "SYSTEM"]);
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

// ---------- Settings ----------
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80).optional(),
  timezone: z.string().max(80).optional(),
  city: z.string().trim().max(120).nullish(),
  language: z.string().max(10).optional(),
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  timeFormat24: z.boolean().optional(),
  theme: theme.optional(),
  skin: skin.optional(),
  density: z.enum(["comfortable", "compact", "cozy"]).optional(),
  calendarStartHour: z.number().int().min(0).max(23).optional(),
  calendarEndHour: z.number().int().min(0).max(23).optional(),
  defaultEventDurationMin: z.number().int().min(5).max(480).optional(),
  defaultPriority: priority.optional(),
  notifyReminders: z.boolean().optional(),
  notifyEvents: z.boolean().optional(),
  notifyTasks: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  emailNotificationDelayMin: z.number().int().min(0).max(1440).optional(),
  avatarUrl: z
    .union([
      z.null(),
      z.string()
        .max(180_000, "La foto es demasiado grande")
        .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Imagen no válida"),
    ])
    .optional(),
});

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
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(300),
  description: z.string().max(5000).nullish(),
  dueDate: isoDateTime.nullish(),
  hasTime: z.boolean().optional(),
  priority: priority.optional(),
  status: taskStatus.optional(),
  projectId: optionalId,
  color: z.string().max(20).nullish(),
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

export const updateTaskSchema = createTaskSchema.partial();

export const reorderProjectTasksSchema = z.object({
  ids: z.array(cuid).min(1).max(500),
});

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
  recurrence: recurrenceSchema.nullish(),
});

export const updateEventSchema = createEventSchema
  .partial()
  .extend({ startAt: isoDateTime.optional(), endAt: isoDateTime.optional() });

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
  color: z.string().max(20).nullish(),
});

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
  manualProgress: z.number().int().min(0).max(100).nullish(),
  status: taskStatus.optional(),
  projectId: optionalId,
  tagIds: z.array(cuid).max(50).optional(),
  taskIds: z.array(cuid).max(100).optional(),
});
export const updateGoalSchema = createGoalSchema.partial();

// ---------- Reminders ----------
export const createReminderSchema = z.object({
  title: z.string().max(300).nullish(),
  remindAt: isoDateTime,
  scheduleDaily: z.boolean().optional(),
  targetType: z.enum(["TASK", "EVENT", "NOTE", "GOAL", "NONE"]).optional(),
  targetId: optionalId,
});
export const updateReminderSchema = createReminderSchema.partial();

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
export const adminListSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});