import type { ProjectStatus } from "@/lib/types";

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "PLANNING", label: "Planificación" },
  { value: "ACTIVE", label: "Activo" },
  { value: "PAUSED", label: "En pausa" },
  { value: "COMPLETED", label: "Completado" },
  { value: "ARCHIVED", label: "Archivado" },
];

export const PROJECT_COLORS = ["#6366f1", "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];

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
    case "ACTIVE": return "bg-[#4169E1]";
    case "PAUSED": return "bg-faint";
    case "COMPLETED": return "bg-ok";
    case "ARCHIVED": return "bg-violet-600";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function projectStatusChipClass(status: ProjectStatus): string {
  switch (status) {
    case "PLANNING": return "bg-warn/15 text-warn";
    case "ACTIVE": return "bg-[#4169E1]/15 text-[#2748c7] dark:text-[#8aa4ff]";
    case "PAUSED": return "bg-surface border border-border text-muted";
    case "COMPLETED": return "bg-ok/15 text-ok";
    case "ARCHIVED": return "bg-violet-600/15 text-violet-700 dark:text-violet-300";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}
