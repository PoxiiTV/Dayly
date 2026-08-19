import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Timer, CalendarDays, Clock3, AlertTriangle, Info } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { EmptyState, useToast } from "@/components/ui";
import { relativeDay, fmtTime } from "@/lib/dates";

const TYPE_ICON: Record<string, any> = { TASK: Timer, EVENT: CalendarDays, REMINDER: Clock3, OVERDUE: AlertTriangle, SYSTEM: Info };

export function NotificationsPanel({ open, onClose, onGo }: { open: boolean; onClose: () => void; onGo: (path: string) => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => http.get<{ notifications: NotificationItem[]; unreadCount: number }>("/api/notifications"),
    enabled: open,
  });

  const markAll = async () => {
    try { await http.post("/api/notifications/read", {}); qc.invalidateQueries({ queryKey: ["notifications"] }); } catch { push("error", "No se pudo actualizar."); }
  };

  const go = (path?: string | null) => { onClose(); if (path) onGo(path); };

  useEffect(() => {
    if (open) {
      const t = setTimeout(async () => {
        try { await http.post("/api/notifications/read", {}); qc.invalidateQueries(); } catch { /* */ }
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [open, qc]);

  const req = data as { notifications?: NotificationItem[]; unreadCount?: number } | undefined;
  const notif = req?.notifications ?? [];

  return (
    <div className={open ? "fixed inset-0 z-[75]" : "hidden"}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-surface shadow-pop animate-[slide-in-right_.28s_cubic-bezier(.16,1,.3,1)] flex flex-col">
        <div className="flex items-center justify-between px-5 h-15 py-4 border-b border-border">
          <h3 className="font-semibold text-text flex items-center gap-2"><Bell className="w-5 h-5 text-accent" /> Notificaciones</h3>
          <div className="flex items-center gap-1">
            <button onClick={markAll} className="btn-ghost !h-8 text-xs" title="Marcar todo como leído"><CheckCheck className="w-4 h-4" />Leer todo</button>
            <button onClick={onClose} className="btn-ghost !p-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notif.length === 0 ? (
            <EmptyState icon={<Bell className="w-6 h-6" />} title="Todo al día" hint="Aquí verás recordatorios, tareas próximas y avisos." />
          ) : (
            <ul className="divide-y divide-border">
              {notif.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Info;
                return (
                  <li key={n.id}>
                    <button onClick={() => go(n.actionUrl)} className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-surface/60 transition-colors">
                      <span className={clsx("mt-0.5 w-8 h-8 rounded-lg grid place-items-center shrink-0", n.read ? "bg-surface border border-border text-muted" : "bg-accent-soft text-accent-strong")}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={clsx("block text-sm", n.read ? "text-muted" : "text-text font-medium")}>{n.title}</span>
                        {n.body && <span className="block text-xs text-muted mt-0.5">{n.body}</span>}
                        <span className="block text-[11px] text-faint mt-1">{relativeDay(n.createdAt)} · {fmtTime(n.createdAt)}</span>
                      </span>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}