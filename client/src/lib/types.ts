/** Shared API resource types (mirror the backend service contracts). */

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "POSTPONED" | "CANCELLED";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type Theme = "LIGHT" | "DARK" | "SYSTEM";
export type { SkinId } from "@/lib/skins";
export type RoleName = "USER" | "ADMIN";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: RoleName;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  timezone: string;
  language: string;
  firstDayOfWeek: number;
  timeFormat24: boolean;
  theme: Theme;
  skin: string;
  density: string;
  calendarStartHour: number;
  calendarEndHour: number;
  avatarUrl: string | null;
  mustChangePassword?: boolean;
}

export interface Tag { id: string; name: string; color?: string | null; }
export interface Subtask { id: string; title: string; done: boolean; sortOrder: number; }
export interface Task {
  id: string; title: string; description?: string | null;
  dueDate?: string | null; hasTime: boolean; priority: Priority; status: TaskStatus;
  projectId?: string | null; color?: string | null; estimateMinutes?: number | null; timeSpentMinutes: number;
  notes?: string | null; deletedAt?: string | null;
  createdAt: string; updatedAt: string; completedAt?: string | null;
  sortOrder?: number;
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
export interface Goal { id: string; title: string; description?: string | null; dueDate?: string | null; progress?: number; manualProgress: number; status: TaskStatus; projectId?: string | null; tasks?: { id: string; title: string; status: TaskStatus }[]; }
export interface Reminder { id: string; title?: string | null; remindAt: string; scheduleDaily: boolean; targetType: string; targetId?: string | null; sentAt?: string | null; }
export interface TimeEntry { id: string; taskId?: string | null; task?: { id: string; title: string } | null; running: boolean; startedAt: string; durationSec: number; note?: string | null; }
export interface NotificationItem { id: string; type: string; title: string; body?: string | null; read: boolean; actionUrl?: string | null; createdAt: string; }
export interface InboxItem { id: string; content: string; archived: boolean; createdAt: string; }

// ---- API envelope ----
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }