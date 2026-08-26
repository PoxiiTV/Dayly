import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, RotateCcw, Timer, Coffee } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Task } from "@/lib/types";
import { Button, Select, useToast, PageHeader } from "@/components/ui";
import { ProgressBar } from "@/components/tasks";
import { fmtDuration } from "@/lib/dates";

const PRESETS = [
  { label: "25 / 5", work: 25 * 60, rest: 5 * 60 },
  { label: "50 / 10", work: 50 * 60, rest: 10 * 60 },
  { label: "Pomodoro largo", work: 90 * 60, rest: 20 * 60 },
];

export function Pomodoro() {
  const { push } = useToast();
  const [preset, setPreset] = useState(PRESETS[0]);
  const [phase, setPhase] = useState<"work" | "rest">("work");
  const [left, setLeft] = useState(preset.work);
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState("");
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const finished = useRef(false);

  const { data } = useQuery({ queryKey: ["tasks", "quick"], queryFn: () => http.get<{ tasks: Task[] }>("/api/tasks") });
  const tasks = data?.tasks ?? [];

  const total = phase === "work" ? preset.work : preset.rest;

  useEffect(() => {
    setLeft(total);
  }, [preset, phase]);

  useEffect(() => {
    if (!running) return;
    interval.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(interval.current!);
          finished.current = true;
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => { if (interval.current) clearInterval(interval.current); };
  }, [running, total]);

  // when timer hits 0
  useEffect(() => {
    if (finished.current && left === 0) {
      finished.current = false;
      setRunning(false);
      if (phase === "work") {
        push("success", "¡Sesión de concentración completada! Tómate un descanso 🍅");
        setPhase("rest");
        setLeft(preset.rest);
        if (taskId) { http.post("/api/time/manual", { taskId, minutes: Math.round(preset.work / 60) }).catch(() => {}); }
      } else {
        push("info", "Descanso terminado. ¡Vamos a por otra!");
        setPhase("work");
        setLeft(preset.work);
      }
    }
  }, [left, phase]);

  const pct = ((total - left) / total) * 100;
  const mins = Math.floor(left / 60), secs = left % 60;

  return (
    <div className="page-shell">
      <PageHeader title="Modo concentración" />

      <div className="text-center">
      <div className="flex justify-center gap-2 mb-8">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => { setPreset(p); setRunning(false); }}
            className={clsx("chip border transition-all", preset.label === p.label ? "bg-accent-soft text-accent-strong border-transparent" : "border-border text-muted")}>{p.label}</button>
        ))}
      </div>

      <div className="card p-10">
        <span className={clsx("chip mb-6", phase === "work" ? "bg-accent-soft text-accent-strong" : "bg-ok/15 text-ok")}>
          {phase === "work" ? <Timer className="w-4 h-4" /> : <Coffee className="w-4 h-4" />}{phase === "work" ? "Concentración" : "Descanso"}
        </span>
        <div className="text-6xl font-bold tabular-nums text-text mb-6" style={{ fontVariantNumeric: "tabular-nums" }}>
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
        <ProgressBar value={pct} color="rgb(var(--accent))" className="h-2 mb-8" />
        <div className="flex items-center justify-center gap-3 mb-6">
          <Button size="sm" variant={running ? "secondary" : "primary"} onClick={() => setRunning(!running)}>
            {running ? <><Pause className="w-4 h-4" />Pausar</> : <><Play className="w-4 h-4" />Iniciar</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setRunning(false); setLeft(total); }}><RotateCcw className="w-4 h-4" />Reiniciar</Button>
        </div>
        <div className="max-w-xs mx-auto text-left">
          <Select label="Vincular a una tarea (opcional)" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Ninguna</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </div>
        <p className="text-xs text-faint mt-6">Al terminar una sesión se registra el tiempo en la tarea seleccionada.</p>
      </div>
      </div>
    </div>
  );
}