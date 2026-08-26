import { Paperclip } from "lucide-react";
import type { TaskAttachment } from "@/lib/types";
import {
  MAX_ATTACHMENTS_PER_TASK,
  attachmentAccept,
  countAttachments,
  isPreviewableImage,
  type PendingAttachment,
} from "@/lib/attachments";

export function AttachmentStrip({
  existing,
  pending,
  removed,
  previews,
  fileRef,
  onAdd,
  onRemoveExisting,
  onRemovePending,
}: {
  existing: TaskAttachment[];
  pending: PendingAttachment[];
  removed: string[];
  previews: Record<string, string>;
  fileRef: { current: HTMLInputElement | null };
  onAdd: (list: FileList | null) => void;
  onRemoveExisting: (id: string) => void;
  onRemovePending: (key: string) => void;
}) {
  const visible = existing.filter((a) => !removed.includes(a.id));
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="label !mb-0">Adjuntos</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:opacity-40"
          onClick={() => fileRef.current?.click()}
          disabled={countAttachments(existing, pending, removed) >= MAX_ATTACHMENTS_PER_TASK}
        >
          <Paperclip className="w-3.5 h-3.5" />Añadir
        </button>
      </div>
      <input ref={fileRef} type="file" accept={attachmentAccept()} multiple className="sr-only" onChange={(e) => { onAdd(e.target.files); }} />
      {(visible.length > 0 || pending.length > 0) ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {visible.map((a) => (
            <div key={a.id} className="relative w-14">
              {isPreviewableImage(a.mimeType) && previews[a.id] ? (
                <img src={previews[a.id]} alt={a.filename} className="w-14 h-14 object-cover rounded-lg border border-border" />
              ) : (
                <div className="w-14 h-14 rounded-lg border border-border grid place-items-center text-[9px] text-muted text-center px-1 leading-tight">{a.filename}</div>
              )}
              <button type="button" className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface border border-border text-faint hover:text-danger text-[10px]" onClick={() => onRemoveExisting(a.id)} aria-label="Quitar">✕</button>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.key} className="relative w-14">
              {p.preview ? (
                <img src={p.preview} alt={p.file.name} className="w-14 h-14 object-cover rounded-lg border border-border" />
              ) : (
                <div className="w-14 h-14 rounded-lg border border-border grid place-items-center text-[9px] text-muted text-center px-1 leading-tight">{p.file.name}</div>
              )}
              <button type="button" className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface border border-border text-faint hover:text-danger text-[10px]" onClick={() => onRemovePending(p.key)} aria-label="Quitar">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-faint mt-1">Capturas o archivos, máx. 2 MB (5 por tarea).</p>
      )}
    </div>
  );
}
