import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api";
import type { Priority } from "@/lib/types";

const STORAGE = "dayly.aiAssist";
const EVENT = "dayly:ai-assist";

function readPref(): boolean {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(STORAGE) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Device preference «Usar la IA en tareas» (on unless turned off). */
export function useAiAssistPref(): boolean {
  return useSyncExternalStore(subscribe, readPref, () => true);
}

export function setAiAssistPref(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE);
    else localStorage.setItem(STORAGE, "off");
  } catch {
    // Restricted storage keeps the current session value only.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** True only when the user wants it and has a model configured. */
export function useAiEnabled(): boolean {
  const pref = useAiAssistPref();
  const { data } = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => http.get<{ available: boolean }>("/api/ai/status"),
    enabled: pref,
    staleTime: 5 * 60_000,
  });
  return pref && Boolean(data?.available);
}

type TaskText = { title?: string; description?: string };

export type AiClassification = {
  projectId: string | null;
  tagIds: string[];
  priority: Priority | null;
  dueDate: string | null;
  hasTime: boolean;
};

export type AiReschedule = { taskId: string; title: string; dueDate: string; hasTime: boolean; reason: string };
export type AiDayPlan = { summary: string; order: { taskId: string; title: string; priority: Priority; reason: string }[] };

export type AiOptimizeProposal = {
  title: string | null;
  description: string | null;
  subtasks: string[];
  projectId: string | null;
  tagIds: string[];
  priority: Priority | null;
};

export const aiApi = {
  title: (taskId: string) => http.post<{ task: { id: string; title: string }; previousTitle: string }>(`/api/ai/tasks/${taskId}/title`),
  suggestTitle: (text: TaskText) => http.post<{ title: string }>("/api/ai/title", text),
  optimize: (taskId: string) => http.post<{ proposal: AiOptimizeProposal; empty: boolean }>(`/api/ai/tasks/${taskId}/optimize`),
  improveDescription: (text: TaskText) => http.post<{ description: string }>("/api/ai/improve-description", text),
  classify: (text: TaskText) => http.post<AiClassification>("/api/ai/classify", text),
  subtasks: (text: TaskText) => http.post<{ suggestions: string[] }>("/api/ai/subtasks", text),
  rescheduleOverdue: () => http.post<{ proposals: AiReschedule[] }>("/api/ai/reschedule-overdue"),
  planDay: (date: string) => http.post<AiDayPlan>("/api/ai/plan-day", { date }),
};

const PLAN_STORAGE = "dayly.aiDayPlan";

/** The user's last «Plan del día» on this device, only while it is still that day. */
export function loadDayPlan(userId: string | undefined, date: string, today: string): AiDayPlan | null {
  if (!userId || date !== today) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_STORAGE) ?? "null") as { user?: string; date?: string; plan?: AiDayPlan } | null;
    return saved?.user === userId && saved.date === date && saved.plan && Array.isArray(saved.plan.order) ? saved.plan : null;
  } catch {
    return null;
  }
}

export function saveDayPlan(userId: string | undefined, date: string, plan: AiDayPlan): void {
  if (!userId) return;
  try {
    localStorage.setItem(PLAN_STORAGE, JSON.stringify({ user: userId, date, plan }));
  } catch {
    // Restricted storage: the plan lives only while the page stays open.
  }
}

/** Stand-in title while the AI writes the real one: the first words of the description. */
export function provisionalTitle(description: string, max = 60): string {
  const text = description.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return `${text.slice(0, cut > max * 0.5 ? cut : max).trim()}…`;
}
