import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Inbox as InboxIcon, ListTodo, CalendarDays, StickyNote, Archive, Trash2 } from "lucide-react";
import { http } from "@/lib/api";
import type { InboxItem } from "@/lib/types";
import { Button, Input, EmptyState, Spinner, useToast, ConfirmDialog } from "@/components/ui";

export function Inbox() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["inbox"], queryFn: () => http.get<{ items: InboxItem[] }>("/api/inbox") });
  const items = data?.items?.filter((i) => !i.archived) ?? [];
  const archived = data?.items?.filter((i) => i.archived) ?? [];

  const capture = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await http.post<{ item: InboxItem }>("/api/inbox", { content: text.trim() });
      setHighlight(r.item.id); setText("");
      qc.invalidateQueries({ queryKey: ["inbox"] });
      setTimeout(() => setHighlight(null), 2000);
      push("success", "Añadido a la bandeja");
    } catch (e: any) { push("error", e.message); } finally { setBusy(false); }
  };

  const convert = async (item: InboxItem, type: "TASK" | "EVENT" | "NOTE") => {
    try {
      const r = await http.post(`/api/inbox/${item.id}/convert`, { type });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      const msg = type === "TASK" ? "tarea" : type === "EVENT" ? "evento" : "nota";
      push("success", `Convertido en ${msg}`);
    } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-text tracking-tight mb-1">Bandeja de entrada</h1>
      <p className="text-muted text-sm mb-5">Suéltalo todo aquí rápido; luego lo organizas tú.</p>

      <div className="flex gap-2 mb-6">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && capture()} placeholder="«Comprar cables», «Llamar a Juan», «Preparar reunión»…" className="!h-12" />
        <Button onClick={capture} disabled={busy} className="!h-12 px-5 shrink-0"><Plus className="w-4 h-4" />Añadir</Button>
      </div>

      <div className="space-y-2">
        {isLoading ? <div className="grid place-items-center h-40"><Spinner /></div> :
          items.length === 0 ? (
            <EmptyState icon={<InboxIcon className="w-6 h-6" />} title="Bandeja vacía" hint="Perfecto. Si capturas algo, aparecerá aquí para organizarlo." />
          ) : items.map((item) => (
            <div key={item.id} className={"card p-4 animate-fade-in " + (highlight === item.id ? "ring-2 ring-accent" : "")}>
              <div className="flex items-start gap-3">
                <p className="flex-1 text-text text-sm font-medium pt-0.5">{item.content}</p>
                <div className="flex items-center gap-1">
                  <ActionBtn title="Convertir en tarea" onClick={() => convert(item, "TASK")}><ListTodo className="w-4 h-4" /></ActionBtn>
                  <ActionBtn title="Convertir en evento" onClick={() => convert(item, "EVENT")}><CalendarDays className="w-4 h-4" /></ActionBtn>
                  <ActionBtn title="Convertir en nota" onClick={() => convert(item, "NOTE")}><StickyNote className="w-4 h-4" /></ActionBtn>
                  <ActionBtn title="Archivar" onClick={async () => { await http.post(`/api/inbox/${item.id}/archive`); qc.invalidateQueries({ queryKey: ["inbox"] }); }}><Archive className="w-4 h-4" /></ActionBtn>
                  <ActionBtn danger title="Eliminar" onClick={() => setConfirmId(item.id)}><Trash2 className="w-4 h-4" /></ActionBtn>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                <MiniTag onClick={() => convert(item, "TASK")} label="→ Tarea" />
                <MiniTag onClick={() => convert(item, "EVENT")} label="→ Evento" />
                <MiniTag onClick={() => convert(item, "NOTE")} label="→ Nota" />
              </div>
            </div>
          ))}
      </div>

      {archived.length > 0 && <div className="mt-8"><p className="text-xs text-faint uppercase tracking-wider mb-2">Archivado</p><div className="space-y-1.5">{archived.map((i) => <p key={i.id} className="text-sm text-muted line-through">{i.content}</p>)}</div></div>}

      <ConfirmDialog open={!!confirmId} onClose={() => setConfirmId(null)} title="Eliminar de la bandeja" message="Se borrará permanentemente." onConfirm={async () => { if (confirmId) { await http.del(`/api/inbox/${confirmId}`); qc.invalidateQueries({ queryKey: ["inbox"] }); } setConfirmId(null); }} />
    </div>
  );
}

function ActionBtn({ children, onClick, title, danger }: any) {
  return <button onClick={onClick} title={title} className={"p-2 rounded-lg transition-colors " + (danger ? "text-faint hover:bg-danger/10 hover:text-danger" : "text-faint hover:bg-accent-soft hover:text-accent-strong")}>{children}</button>;
}
function MiniTag({ onClick, label }: { onClick: () => void; label: string }) {
  return <button onClick={onClick} className="text-xs text-accent hover:underline">{label}</button>;
}