import { Search, Keyboard, Plus, ListTodo, CalendarDays, Map as MapIcon, ArrowLeft } from "lucide-react";
import { APP_NAME } from "@brand";
import { PageHeader } from "@/components/ui";

const SHORTCUTS: { keys: string; desc: string; icon: any }[] = [
  { keys: "Ctrl + K", desc: "Abrir búsqueda global", icon: Search },
  { keys: "Alt + N", desc: "Nueva tarea", icon: ListTodo },
  { keys: "Alt + E", desc: "Nuevo evento", icon: CalendarDays },
  { keys: "Alt + M", desc: "Ir a Mi día", icon: MapIcon },
  { keys: "Alt + C", desc: "Ir al Calendario", icon: CalendarDays },
  { keys: "Alt + T", desc: "Ir a Tareas", icon: ListTodo },
  { keys: "Esc", desc: "Cerrar diálogo o buscador", icon: ArrowLeft },
  { keys: "+", desc: "Botón flotante de creación rápida", icon: Plus },
];

export function Help() {
  return (
    <div className="page-shell">
      <PageHeader title="Ayuda" />
      <div className="space-y-6">
      <section className="card p-5">
        <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint"><Keyboard className="w-4 h-4" />Atajos de teclado</h2>
        <ul className="space-y-2.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-sm text-muted"><s.icon className="w-4 h-4 text-faint" />{s.desc}</span>
              <kbd className="px-2 py-1 rounded-lg bg-surface border border-border text-xs text-text font-mono">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold text-text mb-2">Cómo usar {APP_NAME}</h2>
        <ul className="space-y-2 text-sm text-muted list-disc pl-5">
          <li>El botón <strong className="text-text">+</strong> crea cualquier elemento desde cualquier lugar.</li>
          <li>En el <strong className="text-text">Calendario</strong> arrastra tareas y eventos a otra fecha u hora.</li>
          <li>Usa la <strong className="text-text">Bandeja de entrada</strong> para soltar ideas y convertirlas después.</li>
          <li><strong className="text-text">Mi día</strong> te muestra qué hacer ahora, después y qué está atrasado.</li>
          <li>El modo <strong className="text-text">Pomodoro</strong> registra automáticamente el tiempo en la tarea elegida.</li>
          <li>Tus datos están aislados por cuenta y los borrados van a la <strong className="text-text">Papelera</strong>.</li>
        </ul>
      </section>
      </div>
    </div>
  );
}