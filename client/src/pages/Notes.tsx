import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, StickyNote, Pin, Archive, Search, Trash2, ImagePlus, Undo2 } from "lucide-react";
import clsx from "clsx";
import { getNoteAttachmentBlob, http } from "@/lib/api";
import type { Note, NoteAttachment } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, useToast, PageHeader, ConfirmDialog } from "@/components/ui";
import {
  MAX_ATTACHMENTS_PER_NOTE,
  noteImageAccept,
  uploadAttachments,
  validateAttachmentFile,
} from "@/lib/attachments";

export function Notes() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selected, setSelected] = useState<Note | null>(null);
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
    try {
      const r = await http.post<{ note: Note }>("/api/notes", { title: newTitle.trim() });
      setNewTitle("");
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["notes"] });
      open(r.note);
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo crear.");
    }
  };

  return (
    <div className="page-shell flex flex-col h-[calc(100vh-140px)]">
      <PageHeader
        title="Notas"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Nueva</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr] gap-6 min-h-0 flex-1">
      <div className="flex flex-col min-h-0">
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar notas…" className="!pl-9" />
        </div>
        <button type="button" onClick={() => setShowArchived(!showArchived)} className="mb-3 text-xs text-muted hover:text-text text-left inline-flex items-center gap-1 shrink-0"><Archive className="w-3.5 h-3.5" />{showArchived ? "Ocultar archivadas" : "Ver archivadas"}</button>
        <div className="flex-1 overflow-y-auto space-y-2 px-1 py-0.5">
          {isLoading ? <div className="grid place-items-center h-32"><Spinner /></div> :
            notes.length === 0 ? <EmptyState icon={<StickyNote className="w-6 h-6" />} title={showArchived ? "Sin notas archivadas" : "Sin notas"} action={!showArchived ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear nota</Button> : undefined} /> :
            <>
              {pinned.length > 0 && <><p className="text-[11px] uppercase tracking-wider text-faint">Fijadas</p>{pinned.map((n) => <NoteCard key={n.id} n={n} active={n.id === selectedId} onClick={() => open(n)} />)}</>}
              {pinned.length > 0 && rest.length > 0 && <div className="my-1" />}
              {rest.map((n) => <NoteCard key={n.id} n={n} active={n.id === selectedId} onClick={() => open(n)} />)}
            </>}
        </div>
      </div>

      <div className="card min-h-0 flex flex-col overflow-hidden hidden lg:flex">
        {selectedNote ? <Editor note={selectedNote} onClose={close} /> : (
          <div className="flex-1 grid place-items-center text-muted text-sm p-8">Selecciona una nota o crea una nueva. Tus cambios se guardan solos.</div>
        )}
      </div>

      {selectedNote && <div className="lg:hidden fixed inset-0 z-50 bg-bg flex flex-col"><Editor note={selectedNote} onClose={close} /></div>}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nueva nota"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        <Input label="Título" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Título de la nota" autoFocus />
      </Modal>
    </div>
  );
}

function NoteCard({ n, active, onClick }: { n: Note; active: boolean; onClick: () => void }) {
  const images = n.attachments?.length ?? 0;
  return (
    <button type="button" onClick={onClick} className={clsx("w-full card p-3 text-left transition-all", active ? "ring-2 ring-accent" : "hover:shadow-pop")}>
      <div className="flex items-center gap-2">
        {n.pinned && <Pin className="w-3.5 h-3.5 text-accent shrink-0" />}
        {n.archived && <Archive className="w-3.5 h-3.5 text-faint shrink-0" />}
        <span className="font-medium text-sm text-text truncate">{n.title}</span>
        {images > 0 && <span className="ml-auto text-faint shrink-0"><ImagePlus className="w-3.5 h-3.5" /></span>}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setContent(note.content ?? "");
    setTitle(note.title);
  }, [note.id]);

  useEffect(() => {
    timer.current && clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        await http.patch(`/api/notes/${note.id}/autosave`, { title, content });
        setSaveState("saved");
        qc.invalidateQueries({ queryKey: ["notes"] });
      } catch {
        setSaveState("offline");
      }
    }, 700);
    return () => { timer.current && clearTimeout(timer.current); };
  }, [title, content, note.id, qc]);

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    const images = note.attachments ?? [];
    if (images.length === 0) { setPreviews({}); return; }
    void Promise.all(images.map(async (a) => {
      try {
        const blob = await getNoteAttachmentBlob(note.id, a.id);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return [a.id, url] as const;
      } catch {
        return null;
      }
    })).then((pairs) => {
      if (cancelled) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      setPreviews(next);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [note.id, note.attachments]);

  const togglePin = async () => {
    try { await http.patch(`/api/notes/${note.id}`, { pinned: !note.pinned }); qc.invalidateQueries({ queryKey: ["notes"] }); }
    catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo fijar."); }
  };

  const toggleArchive = async () => {
    try {
      await http.patch(`/api/notes/${note.id}`, { archived: !note.archived });
      qc.invalidateQueries({ queryKey: ["notes"] });
      push("success", note.archived ? "Nota desarchivada" : "Nota archivada");
      onClose();
    } catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo archivar."); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await http.del(`/api/notes/${note.id}`);
      qc.invalidateQueries({ queryKey: ["notes"] });
      push("success", "Nota enviada a la papelera");
      setConfirmDelete(false);
      onClose();
    } catch (e: unknown) { push("error", e instanceof Error ? e.message : "No se pudo eliminar."); }
    finally { setBusy(false); }
  };

  const addImages = async (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list);
    if (!files.length) return;
    const current = note.attachments?.length ?? 0;
    const accepted: File[] = [];
    setUploading(true);
    try {
      for (const file of files) {
        const err = await validateAttachmentFile(file, "note");
        if (err) { push("error", err); continue; }
        if (current + accepted.length >= MAX_ATTACHMENTS_PER_NOTE) {
          push("error", "Máximo 8 imágenes por nota.");
          break;
        }
        accepted.push(file);
      }
      if (accepted.length) {
        await uploadAttachments("note", note.id, accepted);
        qc.invalidateQueries({ queryKey: ["notes"] });
      }
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = async (att: NoteAttachment) => {
    try {
      await http.del(`/api/notes/${note.id}/attachments/${att.id}`);
      qc.invalidateQueries({ queryKey: ["notes"] });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo quitar la imagen.");
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (!images.length) return;
    e.preventDefault();
    void addImages(images);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void addImages(e.dataTransfer.files);
  };

  const images = note.attachments ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 px-3 py-3 border-b border-border shrink-0">
        <button type="button" onClick={togglePin} title={note.pinned ? "Quitar fijado" : "Fijar"} className={clsx("btn-ghost !p-2", note.pinned && "text-accent")}><Pin className="w-4 h-4" /></button>
        <button type="button" onClick={toggleArchive} title={note.archived ? "Desarchivar" : "Archivar"} className="btn-ghost !p-2">
          {note.archived ? <Undo2 className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => setConfirmDelete(true)} title="Eliminar" className="btn-ghost !p-2 text-faint hover:text-danger"><Trash2 className="w-4 h-4" /></button>
        <span className={clsx("text-[11px] ml-auto", saveState === "saved" ? "text-faint" : saveState === "saving" ? "text-accent" : "text-danger")}>
          {saveState === "saved" ? "Guardado" : saveState === "saving" ? "Guardando…" : "Sin conexión"}
        </span>
        <button type="button" onClick={onClose} className="btn-ghost !p-2 lg:hidden">✕</button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col" onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="px-5 pt-4 text-lg font-semibold text-text bg-transparent outline-none shrink-0" placeholder="Título" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escribe aquí… (# encabezado, **negrita**, *cursiva*, - lista, [x] checklist)"
          className="flex-1 min-h-0 px-5 py-3 bg-transparent outline-none text-sm leading-relaxed text-text resize-none" />
        <div className="px-5 pb-4 shrink-0 border-t border-border/60 pt-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="label !mb-0">Imágenes</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:opacity-40"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || images.length >= MAX_ATTACHMENTS_PER_NOTE}
            >
              <ImagePlus className="w-3.5 h-3.5" />{uploading ? "Subiendo…" : "Añadir"}
            </button>
          </div>
          <input ref={fileRef} type="file" accept={noteImageAccept()} multiple className="sr-only" onChange={(e) => { void addImages(e.target.files); }} />
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((a) => (
                <div key={a.id} className="relative w-16">
                  {previews[a.id] ? (
                    <button type="button" className="block" onClick={() => window.open(previews[a.id], "_blank", "noopener")} title={a.filename}>
                      <img src={previews[a.id]} alt={a.filename} className="w-16 h-16 object-cover rounded-lg border border-border" />
                    </button>
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-border grid place-items-center"><Spinner /></div>
                  )}
                  <button type="button" className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface border border-border text-faint hover:text-danger text-[10px]" onClick={() => void removeImage(a)} aria-label="Quitar imagen">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-faint">Pega una captura o sube una imagen (JPG, PNG, WebP o GIF, máx. 2 MB).</p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar nota"
        message={`Se enviará «${note.title}» a la papelera. Podrás restaurarla desde ahí.`}
        confirmLabel="Eliminar"
        busy={busy}
        onConfirm={remove}
      />
    </div>
  );
}
