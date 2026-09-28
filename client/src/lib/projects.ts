import type { ProjectStatus } from "@/lib/types";

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "PLANNING", label: "Planificación" },
  { value: "ACTIVE", label: "Activo" },
  { value: "PAUSED", label: "En pausa" },
  { value: "COMPLETED", label: "Completado" },
  { value: "ARCHIVED", label: "Archivado" },
];

export const PROJECT_COLORS = ["#6366f1", "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];

/** Fallback for entities (projects, habits, events) the user never coloured. */
export const DEFAULT_ENTITY_COLOR = PROJECT_COLORS[0];

/** Next unused palette color for a new tag (cycles if all are taken). */
export function nextTagColor(existing: { color?: string | null }[]): string {
  const used = new Set(existing.map((t) => t.color).filter((c): c is string => Boolean(c)));
  return PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[existing.length % PROJECT_COLORS.length];
}

export function projectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case "PLANNING": return "Planificación";
    case "ACTIVE": return "Activo";
    case "PAUSED": return "En pausa";
    case "COMPLETED": return "Completado";
    case "ARCHIVED": return "Archivado";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function projectStatusDotClass(status: ProjectStatus): string {
  switch (status) {
    case "PLANNING": return "bg-warn";
    case "ACTIVE": return "bg-accent";
    case "PAUSED": return "bg-faint";
    case "COMPLETED": return "bg-ok";
    case "ARCHIVED": return "bg-faint/60";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function projectStatusChipClass(status: ProjectStatus): string {
  switch (status) {
    case "PLANNING": return "bg-warn/15 text-warn";
    case "ACTIVE": return "bg-accent-soft text-accent-strong";
    case "PAUSED": return "bg-bg border border-border text-muted";
    case "COMPLETED": return "bg-ok/15 text-ok";
    case "ARCHIVED": return "bg-bg border border-border text-faint";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}
