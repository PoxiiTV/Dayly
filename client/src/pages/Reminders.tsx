import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, AlarmClock, Trash2 } from "lucide-react";
import { http } from "@/lib/api";
import type { Reminder } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, useToast } from "@/components/ui";
import { fmtDate, fmtTime, toDateTimeLocal, fromDateTimeLocal, iso, relativeDay } from "@/lib/dates";

export function Reminders() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 3600000)));
  const [daily, setDaily] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["reminders"], queryFn: () => http.get<{ reminders: Reminder[] }>("/api/reminders") });
  const reminders = (data?.reminders ?? []).sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());

  const create = async () => {
    try { await http.post("/api/reminders", { title: title || null, remindAt: iso(fromDateTimeLocal(at)), scheduleDaily: daily }); setCreateOpen(false); setTitle(""); qc.invalidateQueries({ queryKey: ["reminders"] }); push("success", "Recordatorio programado"); } catch (e: any) { push("error", e.message); }
  };
  const del = async (id: string) => { try { await http.del(`/api/reminders/${id}`); qc.invalidateQueries({ queryKey: ["reminders"] }); } catch (e: any) { push("error", e.message); } };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-text tracking-tight">Recordatorios</h1>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo</Button>
      </div>

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        reminders.length === 0 ? <EmptyState icon={<AlarmClock className="w-6 h-6" />} title="Sin recordatorios" action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear</Button>} /> :
        <div className="card divide-y divide-border/60">
          {reminders.map((r) => {
            const past = new Date(r.remindAt).getTime() < Date.now();
            return (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className={"w-10 h-10 rounded-xl grid place-items-center " + (past ? "bg-surface border border-border text-faint" : "bg-accent-soft text-accent-strong")}><AlarmClock className="w-5 h-5" /></span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{r.title || "Recordatorio"}</p>
                  <p className="text-xs text-muted">{past ? "Pasado · " : "Aviso "}{fmtDate(r.remindAt)} a las {fmtTime(r.remindAt)}{r.scheduleDaily && " · diario"}</p>
                </div>
                <button onClick={() => del(r.id)} className="btn-ghost !p-2 text-faint hover:text-danger"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo recordatorio" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Programar</Button></>}>
        <div className="space-y-4">
          <Input label="Título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Llamar a la sala" autoFocus />
          <Input label="Cuándo" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} className="w-4 h-4 accent-blue-600" /> Repetir a diario</label>
        </div>
      </Modal>
    </div>
  );
}