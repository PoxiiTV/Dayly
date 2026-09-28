import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { addDays, localKey, parseKey } from "@/lib/dates";
import type { EventItem, Reminder, Task } from "@/lib/types";
import { collectOccupiedTimes, EMPTY_OCCUPIED, type OccupiedLookup } from "@/lib/occupiedTimes";

export function useOccupiedTimes(
  dayKey: string,
  enabled: boolean,
  excludeIds: readonly string[] = [],
): OccupiedLookup {
  const valid = Boolean(enabled && /^\d{4}-\d{2}-\d{2}$/.test(dayKey));
  const toDay = valid ? localKey(addDays(parseKey(dayKey), 1)) : "";
  const { data } = useQuery({
    queryKey: ["calendar-occupancy", dayKey],
    queryFn: async () => {
      // `to` is the next local day so midnight-parsed ISO dates still include
      // evening events (demo and APIs that compare against `new Date(to)`).
      const [calendar, reminders] = await Promise.all([
        http.get<{ events: EventItem[]; tasks: Task[] }>("/api/calendar", { from: dayKey, to: toDay }),
        http.get<{ reminders: Reminder[] }>("/api/reminders", { from: dayKey, to: toDay }),
      ]);
      return { events: calendar.events, tasks: calendar.tasks, reminders: reminders.reminders };
    },
    enabled: valid,
    staleTime: 30_000,
  });
  const excludeKey = excludeIds.join(",");
  return useMemo(() => {
    if (!valid) return EMPTY_OCCUPIED;
    return collectOccupiedTimes({
      dayKey,
      tasks: data?.tasks,
      events: data?.events,
      reminders: data?.reminders,
      excludeIds: excludeKey ? excludeKey.split(",") : [],
    });
  }, [valid, dayKey, data, excludeKey]);
}
