import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import type { EventItem, Reminder, Task } from "@/lib/types";
import { toDateTimeLocal } from "@/lib/dates";
import { TaskEditor } from "@/components/tasks";
import { Button, Checkbox, ComingSoonBadge, Input, Modal, Spinner, Textarea, useToast } from "@/components/ui";
import { useIntegration } from "@/lib/integrations";
import { DateTimeField } from "@/components/DateTimeField";

export type CalendarSelection = { kind: "task" | "event" | "reminder"; id: string };

export function CalendarItemEditor({ selection, reminders, onClose }: {
  selection: CalendarSelection; reminders: Reminder[]; onClose: () => void;
}) {
  const { data, isError, refetch } = useQuery({
    queryKey: ["calendar-detail", selection.kind, selection.id],
    staleTime: 0,
    queryFn: async () => {
      if (selection.kind === "task") return { kind: "task" as const, item: (await http.get<{ task: Task }>(`/api/tasks/${selection.id}`)).task };
      if (selection.kind === "event") return { kind: "event" as const, item: (await http.get<{ event: EventItem }>(`/api/events/${selection.id}`)).event };
      const item = reminders.find((r) => r.id === selection.id);
      if (!item) throw new Error("Recordatorio no encontrado.");
      return { kind: "reminder" as const, item };
    },
  });
  if (!data) return <Modal open onClose={onClose} title="Revisar elemento">
    {isError ? <div role="alert">No se pudo cargar el elemento. <Button onClick={() => void refetch()}>Reintentar</Button></div> : <Spinner />}
  </Modal>;
  if (data.kind === "task") return <TaskEditor key={data.item.id} open task={data.item} onClose={onClose} />;
  return <CalendarDetailsForm key={`${data.kind}:${data.item.id}`} record={data} onClose={onClose} />;
}

function CalendarDetailsForm({ record, onClose }: {
  record: { kind: "event"; item: EventItem } | { kind: "reminder"; item: Reminder }; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const event = record.kind === "event" ? record.item : null;
  const reminder = record.kind === "reminder" ? record.item : null;
  const [title, setTitle] = useState(record.item.title ?? "");
  const [start, setStart] = useState(toDateTimeLocal(new Date(event?.startAt ?? reminder!.remindAt)));
  const [end, setEnd] = useState(record.item.endAt ? toDateTimeLocal(new Date(record.item.endAt)) : "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [daily, setDaily] = useState(reminder?.scheduleDaily ?? false);
  const [telegram, setTelegram] = useState(reminder?.notifyTelegram ?? false);
  const telegramState = useIntegration("telegram");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const from = new Date(start), until = end ? new Date(end) : null;
    if (!Number.isFinite(from.getTime()) || (event && !title.trim()) || (event && !until) || (until && (!Number.isFinite(until.getTime()) || until <= from))) {
      push("error", "Revisa el título y las fechas: el final debe ser posterior al inicio.");
      return;
    }
    setBusy(true);
    try {
      await http.patch(`/api/${record.kind}s/${record.item.id}`, event ? {
        title: title.trim(), startAt: from.toISOString(), endAt: until!.toISOString(),
        description, location, allDay,
      } : {
        title: title.trim(), remindAt: from.toISOString(), endAt: until?.toISOString() ?? null,
        scheduleDaily: daily, notifyTelegram: telegram,
      });
      await qc.invalidateQueries();
      push("success", event ? "Evento actualizado" : "Recordatorio actualizado");
      onClose();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo guardar.");
    } finally { setBusy(false); }
  };
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={event ? "Editar evento" : "Editar recordatorio"}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar cambios"}</Button></>}>
    <div className="space-y-4">
      {event?.recurrence && <p className="text-sm text-muted">Estás editando la serie completa. Las fechas corresponden a su inicio original.</p>}
      <Input label="Título" aria-label="Título" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <DateTimeField label="Inicio" value={start} onChange={setStart} />
      <DateTimeField label={event ? "Final" : "Final (opcional)"} value={end} onChange={setEnd} optional={!event} />
      {event ? <>
        <Checkbox label="Todo el día" checked={allDay} onChange={setAllDay} />
        <Textarea label="Descripción" aria-label="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input label="Lugar" aria-label="Lugar" value={location} onChange={(e) => setLocation(e.target.value)} />
      </> : <>
        <Checkbox label="Repetir cada día" checked={daily} onChange={setDaily} />
        {telegramState === "AVAILABLE" && <Checkbox label="Avisar por Telegram" checked={telegram} onChange={setTelegram} />}
        {telegramState === "COMING_SOON" && <p className="flex items-center gap-2 text-sm text-muted">Avisar por Telegram <ComingSoonBadge /></p>}
      </>}
    </div>
  </Modal>;
}
