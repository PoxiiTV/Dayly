import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, StickyNote, Pin, Archive, Search } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import type { Note } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, useToast } from "@/components/ui";

export function Notes() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selected, setSelected] = useState<Note | null>(id ? null : null);
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);

  const { data, isLoading } = useQuery({
    queryKey: ["notes", q, showArchived],
    queryFn: () => http.get<{ notes: Note[] }>("/api/notes", { q: q || undefined, archived: showArchived ? "true" : "false" }),
  });
  const selectedNote = selectedId ? data?.notes.find((n) => n.id === selectedId) ?? selected : selected;

  const notes = (data?.notes ?? []).filter((n) => !(n.archived && !showArchived));
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);

  const open = (n: Note) => { setSelected(n); setSelectedId(n.id); navigate(`/notes/${n.id}`); };
  const close = () => { setSelected(null); setSelectedId(null); navigate("/notes"); };

  const create = async () => {
    if (!newTitle.trim()) return;
    try { const r = await http.post<{ note: Note }>("/api/notes", { title: newTitle.trim() }); setNewTitle(""); setCreateOpen(false); qc.invalidateQueries({ queryKey: ["notes"] }); open(r.note); } catch (e: any) { push("error", e.message); }
  };

  return (
    <div className="max-w-6xl mx-auto animate-fade-in grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr] gap-6 h-[calc(100vh-140px)]">
      {/* List */}
      <div className="flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h1 className="text-2xl font-bold text-text tracking-tight">Notas</h1>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nueva</Button>
        </div>
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar notas…" className="!pl-9" />
        </div>
        <button onClick={() => setShowArchived(!showArchived)} className="mb-3 text-xs text-muted hover:text-text text-left inline-flex items-center gap-1 shrink-0"><Archive className="w-3.5 h-3.5" />{showArchived ? "Ocultar archivadas" : "Ver archivadas"}</button>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? <div className="grid place-items-center h-32"><Spinner /></div> :
            notes.length === 0 ? <EmptyState icon={<StickyNote className="w-6 h-6" />} title="Sin notas" action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear nota</Button>} /> :
            <>
              {pinned.length > 0 && <><p className="text-[11px] uppercase tracking-wider text-faint px-1">Fijadas</p>{pinned.map((n) => <NoteCard key={n.id} n={n} active={n.id === selectedId} onClick={() => open(n)} />)}</>}
              {pinned.length > 0 && rest.length > 0 && <div className="my-1" />}
              {rest.map((n) => <NoteCard key={n.id} n={n} active={n.id === selectedId} onClick={() => open(n)} />)}
            </>}
        </div>
      </div>

      {/* Editor */}
      <div className="card min-h-0 flex flex-col overflow-hidden hidden lg:flex">
        {selectedNote ? <Editor note={selectedNote} onClose={close} /> : (
          <div className="flex-1 grid place-items-center text-muted text-sm p-8">Selecciona una nota o crea una nueva. Tus cambios se guardan solos.</div>
        )}
      </div>

      {/* Mobile: editor as full page overlay via modal */}
      {selectedNote && <div className="lg:hidden fixed inset-0 z-50 bg-bg"><Editor note={selectedNote} onClose={close} /></div>}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nueva nota" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <Input label="Título" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Título de la nota" autoFocus />
      </Modal>
    </div>
  );
}

function NoteCard({ n, active, onClick }: { n: Note; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx("w-full card p-3 text-left transition-all", active ? "ring-2 ring-accent" : "hover:shadow-pop")}>
      <div className="flex items-center gap-2">
        {n.pinned && <Pin className="w-3.5 h-3.5 text-accent shrink-0" />}
        <span className="font-medium text-sm text-text truncate">{n.title}</span>
      </div>
      {n.content && <p className="text-xs text-muted mt-1 line-clamp-2 break-words">{n.content.replace(/[#*>`]/g, "")}</p>}
    </button>
  );
}

function Editor({ note, onClose }: { note: Note; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [content, setContent] = useState(note.content ?? "");
  const [title, setTitle] = useState(note.title);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const timer = useRefTimer();

  useEffect(() => {
    setContent(note.content ?? ""); setTitle(note.title);
  }, [note.id]);

  // debounced autosave
  useEffect(() => {
    timer.current && clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        await http.patch(`/api/notes/${note.id}/autosave`, { title, content });
        setSaveState("saved");
        qc.invalidateQueries({ queryKey: ["notes"] });
      } catch (e: any) { setSaveState("offline"); }
    }, 700);
    return () => { timer.current && clearTimeout(timer.current); };
  }, [title, content]);

  const togglePin = async () => { try { await http.patch(`/api/notes/${note.id}`, { pinned: !note.pinned }); qc.invalidateQueries(); } catch (e: any) { push("error", e.message); } };

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <button onClick={togglePin} className={clsx("btn-ghost !p-2", note.pinned && "text-accent")}><Pin className="w-4 h-4" /></button>
        <span className={clsx("text-[11px]", saveState === "saved" ? "text-faint" : saveState === "saving" ? "text-accent" : "text-danger")}>
          {saveState === "saved" ? "Guardado" : saveState === "saving" ? "Guardando…" : "Sin conexión"}
        </span>
        <button onClick={onClose} className="btn-ghost !p-2 lg:hidden">✕</button>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="px-5 pt-4 text-lg font-semibold text-text bg-transparent outline-none shrink-0" placeholder="Título" />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escribe aquí… (# encabezado, **negrita**, *cursiva*, - lista, [x] checklist)"
        className="flex-1 min-h-0 px-5 py-3 bg-transparent outline-none text-sm leading-relaxed text-text resize-none" />
    </>
  );
}

import { useRef } from "react";
function useRefTimer() { return useRef<ReturnType<typeof setTimeout> | null>(null); }