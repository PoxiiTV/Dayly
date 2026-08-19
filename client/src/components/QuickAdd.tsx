import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ListTodo, StickyNote, PanelsTopLeft, AlarmClock } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { Button, Input, Modal, Select, Checkbox, useToast, Segmented } from "@/components/ui";
import { toDateTimeLocal, fromDateTimeLocal, iso } from "@/lib/dates";

type Kind = "task" | "event" | "note" | "project" | "reminder";

const TABS: { value: Kind; label: React.ReactNode }[] = [
  { value: "task", label: "Tarea" }, { value: "event", label: "Evento" }, { value: "note", label: "Nota" },
  { value: "project", label: "Proyecto" }, { value: "reminder", label: "Recordatorio" },
];
const ICON: Record<Kind, any> = { task: ListTodo, event: CalendarDays, note: StickyNote, project: PanelsTopLeft, reminder: AlarmClock };

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [kind, setKind] = useState<Kind>("task");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [detail1, setDetail1] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [allDay, setAllDay] = useState(false);
  const [freq, setFreq] = useState("");

  const now = new Date();
  const [start, setStart] = useState(toDateTimeLocal(now));
  const [end, setEnd] = useState(toDateTimeLocal(new Date(now.getTime() + 3600000)));

  const invalidate = () => { qc.invalidateQueries(); };

  const submit = async () => {
    if (!title.trim()) { push("error", "Ponle un título."); return; }
    setBusy(true);
    try {
      if (kind === "task") {
        await http.post("/api/tasks", { title: title.trim(), priority, dueDate: start ? iso(fromDateTimeLocal(start)) : null, hasTime: !!start, recurrence: freq ? { frequency: freq, interval: 1 } : undefined });
        push("success", "Tarea creada");
      } else if (kind === "event") {
        await http.post("/api/events", { title: title.trim(), description: detail1 || null, startAt: iso(fromDateTimeLocal(start)), endAt: iso(fromDateTimeLocal(end)), allDay, priority, recurrence: freq ? { frequency: freq, interval: 1 } : undefined });
        push("success", "Evento programado");
      } else if (kind === "note") {
        await http.post("/api/notes", { title: title.trim(), content: detail1 || "" });
        push("success", "Nota guardada");
      } else if (kind === "project") {
        await http.post("/api/projects", { name: title.trim(), description: detail1 || null, priority });
        push("success", "Proyecto creado");
      } else {
        await http.post("/api/reminders", { title: title.trim(), remindAt: iso(fromDateTimeLocal(start)), scheduleDaily: false });
        push("success", "Recordatorio programado");
      }
      invalidate(); setTitle(""); setDetail1(""); onClose();
    } catch (e: any) { push("error", e.message ?? "No se pudo crear."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={null} size="md"
      footer={<Button onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Crear"}</Button>}>
      <Segmented options={TABS} value={kind} onChange={setKind} className="mb-4 flex w-full overflow-x-auto no-scrollbar" />
      <div className={clsx("grid ", kind === "note" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 gap-4")}>
        {kind !== "project" && (
          <div className={kind === "note" ? "md:col-span-2" : ""}>
            <Input label={kind === "reminder" ? "Recordatorio de" : kind === "task" ? "Tarea" : "Título"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué hay que hacer?" autoFocus />
          </div>
        )}
        {kind === "project" && <Input label="Nombre del proyecto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre" />}
        {kind === "note" && <div className="md:col-span-2"><Input label="Contenido" value={detail1} onChange={(e) => setDetail1(e.target.value)} placeholder="Escribe aquí…" /></div>}
        {kind === "event" && (
          <>
            <Input label="Inicio" type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); const s = fromDateTimeLocal(e.target.value); setEnd(toDateTimeLocal(new Date(s.getTime() + 3600000))); }} />
            <Input label="Fin" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            <div className="md:col-span-2"><Checkbox label="Todo el día" checked={allDay} onChange={setAllDay} /></div>
          </>
        )}
        {(kind === "task" || kind === "event") && (
          <Select label="Prioridad" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Baja</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option>
          </Select>
        )}
        {(kind === "task" || kind === "event") && (
          <Select label="Repetición" value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="">No se repite</option>
            <option value="DAILY">Cada día</option>
            <option value="WEEKLY">Cada semana</option>
            <option value="MONTHLY">Cada mes</option>
          </Select>
        )}
        {kind === "task" && (
          <Input label="Fecha límite" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        )}
        {kind === "reminder" && <Input label="Cuándo" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}
      </div>
    </Modal>
  );
}