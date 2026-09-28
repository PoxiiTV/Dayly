import { http } from "@/lib/api";
import { iso } from "@/lib/dates";
import type { QuickAddParse } from "@/lib/quickAddParse";

/** What the quick add just made, so the caller can offer to undo or open it. */
export interface QuickAddCreated {
  kind: QuickAddParse["kind"];
  id: string;
}

/** Persist a parsed quick-add phrase using the existing create APIs. */
export async function createFromQuickAdd(parsed: QuickAddParse): Promise<QuickAddCreated> {
  const title = parsed.title.trim();
  if (!title) throw new Error("Ponle un título.");
  const startIso = parsed.start ? iso(parsed.start) : null;
  const endIso = parsed.end ? iso(parsed.end) : null;
  const recurrence = parsed.freq ? { frequency: parsed.freq, interval: 1 } : undefined;

  if (parsed.kind === "task") {
    const created = await http.post<{ task: { id: string } }>("/api/tasks", {
      title,
      priority: parsed.priority,
      dueDate: startIso,
      hasTime: parsed.hasTime,
      recurrence,
    });
    return { kind: "task", id: created.task.id };
  }
  if (parsed.kind === "event") {
    const startAt = startIso ?? iso(new Date());
    const endAt = endIso ?? iso(new Date(Date.now() + 3600_000));
    const created = await http.post<{ event: { id: string } }>("/api/events", {
      title,
      startAt,
      endAt,
      allDay: parsed.allDay,
      priority: parsed.priority,
      recurrence,
    });
    return { kind: "event", id: created.event.id };
  }
  if (parsed.kind === "note") {
    const created = await http.post<{ note: { id: string } }>("/api/notes", { title, content: "" });
    return { kind: "note", id: created.note.id };
  }
  if (parsed.kind === "project") {
    const created = await http.post<{ project: { id: string } }>("/api/projects", { name: title, priority: parsed.priority });
    return { kind: "project", id: created.project.id };
  }
  const created = await http.post<{ reminder: { id: string } }>("/api/reminders", {
    title,
    remindAt: startIso ?? iso(new Date(Date.now() + 3600_000)),
    scheduleDaily: false,
  });
  return { kind: "reminder", id: created.reminder.id };
}
