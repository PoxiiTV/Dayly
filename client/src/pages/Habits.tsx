import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Repeat, Droplets } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Habit } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, useToast } from "@/components/ui";
import { localKey, addDays } from "@/lib/dates";

const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

export function Habits() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(127);

  const { data, isLoading } = useQuery({ queryKey: ["habits"], queryFn: () => http.get<{ habits: (Habit & { logs?: { date: string; done: boolean }[] })[] }>("/api/habits") });
  const habits = data?.habits ?? [];

  const toggleLog = async (h: string, date: string) => {
    try { await http.post(`/api/habits/${h}/log`, { date }); qc.invalidateQueries({ queryKey: ["habits"] }); } catch (e: any) { push("error", e.message); }
  };

  const weekStart = addDays(new Date(), -((new Date().getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const create = async () => {
    if (!name.trim()) return;
    try { await http.post("/api/habits", { name: name.trim(), scheduleDayBits: days }); setCreateOpen(false); setName(""); qc.invalidateQueries({ queryKey: ["habits"] }); push("success", "Hábito creado"); } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-5">
        <div><h1 className="text-2xl font-bold text-text tracking-tight">Hábitos</h1><p className="text-muted text-sm">Constancia y rachas</p></div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo hábito</Button>
      </div>

      {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> :
        habits.length === 0 ? <EmptyState icon={<Repeat className="w-6 h-6" />} title="Crea tu primer hábito" action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nuevo</Button>} /> :
        <div className="space-y-3">
          {habits.map((h) => {
            const doneKeys = new Set((h.logs ?? []).filter((l) => l.done).map((l) => l.date.slice(0, 10)));
            const weekDone = weekDays.filter((d) => doneKeys.has(localKey(d))).length;
            return (
              <div key={h.id} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: (h.color ?? "#6366f1") + "22", color: h.color ?? "#6366f1" }}><Droplets className="w-4 h-4" /></span>
                    <span className="font-medium text-text text-sm">{h.name}</span>
                  </div>
                  <span className="text-xs text-muted">🔥 {h.current ?? 0} · récord {h.longest ?? 0} · {weekDone}/7 esta semana</span>
                </div>
                <div className="flex gap-1.5">
                  {weekDays.map((d, i) => {
                    const key = localKey(d);
                    const done = doneKeys.has(key);
                    return (
                      <button key={key} onClick={() => toggleLog(h.id, key)} title={key}
                        className={clsx("flex-1 py-2 rounded-lg border text-center transition-all hover:scale-[1.04]", done ? "bg-accent/15 border-accent" : "bg-surface border-border")}>
                        <span className="block text-faint text-[10px]">{DAY_LABELS[i]}</span>
                        <span className={clsx("block w-3 h-3 mx-auto mt-1 rounded-full", done ? "bg-accent" : "border-2 border-border")} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo hábito" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <div className="space-y-4">
          <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Ej. Beber agua, Leer, Entrenar" autoFocus />
          <div><label className="label">Días de la semana</label>
            <div className="flex gap-1.5">{DAY_LABELS.map((d, i) => (
              <button key={d} onClick={() => setDays(days ^ (1 << i))} className={"w-9 h-9 rounded-lg text-xs font-bold transition-all " + (days & (1 << i) ? "bg-accent text-white" : "bg-surface border border-border text-muted")}>{d}</button>
            ))}</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}