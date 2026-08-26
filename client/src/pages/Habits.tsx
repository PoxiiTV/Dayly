import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Repeat, Droplets, Pencil, Trash2, Bell, CalendarDays } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Habit } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, Select, useToast, PageHeader } from "@/components/ui";
import { HabitCalendarModal } from "@/components/HabitCalendarModal";
import { localKey, addDays } from "@/lib/dates";

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

type EditorState = {
  id?: string;
  name: string;
  days: number;
  reminder: string; // "HH:MM" or ""
};

function editorFrom(habit?: Habit | null): EditorState {
  const m = habit?.reminderMinuteOfDay;
  return {
    id: habit?.id,
    name: habit?.name ?? "",
    days: habit?.scheduleDayBits ?? 127,
    reminder: m === null || m === undefined ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
  };
}

export function Habits() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [form, setForm] = useState<EditorState>(() => editorFrom(null));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Habit | null>(null);
  const [calendarFor, setCalendarFor] = useState<Habit | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["habits"], queryFn: () => http.get<{ habits: (Habit & { logs?: { date: string; done: boolean }[] })[] }>("/api/habits") });
  const habits = data?.habits ?? [];

  const toggleLog = async (h: string, date: string) => {
    try {
      await http.post(`/api/habits/${h}/log`, { date });
      qc.invalidateQueries({ queryKey: ["habits"] });
    } catch (e: any) {
      push("error", e.message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(editorFrom(null));
    setEditorOpen(true);
  };

  const openEdit = (h: Habit) => {
    setEditing(h);
    setForm(editorFrom(h));
    setEditorOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { push("error", "Escribe un nombre."); return; }
    setBusy(true);
    const minuteOfDay = form.reminder
      ? Number(form.reminder.slice(0, 2)) * 60 + Number(form.reminder.slice(3, 5))
      : null;
    const payload = { name: form.name.trim(), scheduleDayBits: form.days, reminderMinuteOfDay: minuteOfDay };
    try {
      if (form.id) await http.patch(`/api/habits/${form.id}`, payload);
      else await http.post("/api/habits", payload);
      qc.invalidateQueries({ queryKey: ["habits"] });
      setEditorOpen(false);
      push("success", form.id ? "Hábito actualizado" : "Hábito creado");
    } catch (e: any) {
      push("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await http.del(`/api/habits/${confirmDelete.id}`);
      qc.invalidateQueries({ queryKey: ["habits"] });
      push("success", "Hábito eliminado");
    } catch (e: any) {
      push("error", e.message);
    } finally {
      setConfirmDelete(null);
    }
  };

  // Monday-first week grid ending today.
  const today = new Date();
  const weekStart = addDays(today, -((today.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="page-shell">
      <PageHeader
        title="Hábitos"
        lead="Constancia y rachas"
        actions={<Button onClick={openCreate}><Plus className="w-4 h-4" />Nuevo hábito</Button>}
      />

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        habits.length === 0 ? <EmptyState icon={<Repeat className="w-6 h-6" />} title="Crea tu primer hábito" action={<Button onClick={openCreate}><Plus className="w-4 h-4" />Nuevo</Button>} /> :
        <div className="space-y-3">
          {habits.map((h) => {
            const doneKeys = new Set((h.logs ?? []).filter((l) => l.done).map((l) => l.date.slice(0, 10)));
            const scheduledDays = Array.from({ length: 7 }, (_, i) => ((h.scheduleDayBits >> i) & 1) === 1);
            const scheduledWeek = weekDays.filter((_, i) => scheduledDays[i]);
            const doneScheduled = scheduledWeek.filter((d) => doneKeys.has(localKey(d))).length;
            const todayIdx = (today.getDay() + 6) % 7;
            const dueToday = scheduledDays[todayIdx];
            const doneToday = doneKeys.has(localKey(today));
            return (
              <div key={h.id} className="card p-4">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: (h.color ?? "#6366f1") + "22", color: h.color ?? "#6366f1" }}><Droplets className="w-4 h-4" /></span>
                    <div className="min-w-0">
                      <span className="font-medium text-text text-sm block truncate">{h.name}</span>
                      <span className="text-xs text-muted flex items-center gap-1">
                        {dueToday && !doneToday && <Bell className="w-3 h-3 text-warn" />}
                        🔥 {h.current ?? 0} · récord {h.longest ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {h.reminderMinuteOfDay != null && (
                      <span className="chip !py-0.5 !px-2 text-xs border border-border text-muted">
                        {String(Math.floor(h.reminderMinuteOfDay / 60)).padStart(2, "0")}:{String(h.reminderMinuteOfDay % 60).padStart(2, "0")}
                      </span>
                    )}
                    <button type="button" aria-label="Ver calendario" onClick={() => setCalendarFor(h)} className="p-2 rounded-lg text-faint hover:text-text hover:bg-surface transition-colors">
                      <CalendarDays className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Editar hábito" onClick={() => openEdit(h)} className="p-2 rounded-lg text-faint hover:text-text hover:bg-surface transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Eliminar hábito" onClick={() => setConfirmDelete(h)} className="p-2 rounded-lg text-faint hover:text-danger hover:bg-surface transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {weekDays.map((d, i) => {
                    const key = localKey(d);
                    const done = doneKeys.has(key);
                    const isFuture = d.getTime() > today.getTime() && !isSameDay(d, today);
                    const scheduled = scheduledDays[i];
                    return (
                      <button key={key} disabled={!scheduled || isFuture} onClick={() => toggleLog(h.id, key)} title={`${key}${scheduled ? "" : " · no programado"}`}
                        className={clsx(
                          "flex-1 py-2 rounded-lg border text-center transition-all",
                          !scheduled ? "opacity-30 bg-surface border-border cursor-not-allowed" :
                          done ? "bg-accent/15 border-accent hover:scale-[1.04]" :
                          isFuture ? "bg-surface border-border opacity-50 cursor-default" :
                          "bg-surface border-border hover:scale-[1.04]",
                        )}>
                        <span className="block text-faint text-[10px]">{DAY_LABELS[i]}</span>
                        <span className={clsx("block w-3 h-3 mx-auto mt-1 rounded-full", done ? "bg-accent" : scheduled ? "border-2 border-border" : "border-2 border-dashed border-border")} />
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-faint mt-2">{doneScheduled}/{scheduledWeek.length} esta semana</p>
              </div>
            );
          })}
        </div>}

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editing ? "Editar hábito" : "Nuevo hábito"}
        footer={<><Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button></>}>
        <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="Ej. Beber agua, Leer, Entrenar" autoFocus />
        <div>
          <label className="label">Días programados</label>
          <div className="flex gap-1.5">{DAY_LABELS.map((d, i) => (
            <button type="button" key={d} onClick={() => setForm({ ...form, days: form.days ^ (1 << i) })} className={"flex-1 h-11 rounded-xl text-xs font-bold transition-all " + (form.days & (1 << i) ? "bg-accent text-white" : "bg-surface border border-border text-muted")}>{d}</button>
          ))}</div>
        </div>
        <Select label="Recordatorio diario" value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })}>
          <option value="">Sin recordatorio</option>
          {TIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <p className="text-xs text-faint -mt-2">Recibirás un aviso a esa hora los días programados, hasta que marques el hábito como hecho.</p>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar hábito"
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</Button><Button variant="danger" onClick={() => void remove()}>Eliminar</Button></>}>
        <p className="text-sm text-muted">¿Seguro que quieres eliminar «{confirmDelete?.name}»? Se borrará también su historial.</p>
      </Modal>

      <HabitCalendarModal habit={calendarFor} open={!!calendarFor} onClose={() => setCalendarFor(null)} />
    </div>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return localKey(a) === localKey(b);
}

const TIME_OPTIONS: [string, string][] = (
  Array.from({ length: 24 * 4 }, (_, i) => i * 15)
).map((m) => {
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return [v, v];
});
