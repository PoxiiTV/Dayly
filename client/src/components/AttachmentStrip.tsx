import { useState } from "react";
import { Paperclip } from "lucide-react";
import { PhotoZoom } from "@/components/chat/PhotoZoom";
import type { TaskAttachment } from "@/lib/types";
import {
  attachmentAccept,
  attachmentDropHint,
  countAttachments,
  isPreviewableImage,
  maxFilesFor,
  type AttachmentKind,
  type PendingAttachment,
} from "@/lib/attachments";

function AttachmentThumbs({
  existing,
  pending,
  removed,
  previews,
  onRemoveExisting,
  onRemovePending,
}: {
  existing: TaskAttachment[];
  pending: PendingAttachment[];
  removed: string[];
  previews: Record<string, string>;
  onRemoveExisting: (id: string) => void;
  onRemovePending: (key: string) => void;
}) {
  const [zoomed, setZoomed] = useState<{ kind: "existing" | "pending"; id: string } | null>(null);
  const visible = existing.filter((a) => !removed.includes(a.id));
  if (visible.length === 0 && pending.length === 0) return null;
  const selected = zoomed?.kind === "existing"
    ? visible.find((a) => a.id === zoomed.id && isPreviewableImage(a.mimeType) && previews[a.id])
    : pending.find((p) => p.key === zoomed?.id && p.preview);
  const zoomSrc = selected && ("mimeType" in selected ? previews[selected.id] : selected.preview);
  const zoomAlt = selected && ("mimeType" in selected ? selected.filename : selected.file.name);
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((a) => (
        <div key={a.id} className="relative w-14">
          {isPreviewableImage(a.mimeType) && previews[a.id] ? (
            <button type="button" onClick={() => setZoomed({ kind: "existing", id: a.id })} aria-label={`Ampliar ${a.filename}`} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <img src={previews[a.id]} alt="" className="w-14 h-14 object-cover rounded-lg border border-border" />
            </button>
          ) : (
            <div className="w-14 h-14 rounded-lg border border-border bg-bg grid place-items-center text-[9px] text-muted text-center px-1 leading-tight overflow-hidden">{a.filename}</div>
          )}
          <button type="button" className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-surface border border-border text-faint shadow-soft transition-colors hover:text-danger hover:border-danger/40 text-[10px]" onClick={() => { if (zoomed?.kind === "existing" && zoomed.id === a.id) setZoomed(null); onRemoveExisting(a.id); }} aria-label={`Quitar ${a.filename}`}>✕</button>
        </div>
      ))}
      {pending.map((p) => (
        <div key={p.key} className="relative w-14">
          {p.preview ? (
            <button type="button" onClick={() => setZoomed({ kind: "pending", id: p.key })} aria-label={`Ampliar ${p.file.name}`} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <img src={p.preview} alt="" className="w-14 h-14 object-cover rounded-lg border border-border" />
            </button>
          ) : (
            <div className="w-14 h-14 rounded-lg border border-border bg-bg grid place-items-center text-[9px] text-muted text-center px-1 leading-tight overflow-hidden">{p.file.name}</div>
          )}
          <button type="button" className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-surface border border-border text-faint shadow-soft transition-colors hover:text-danger hover:border-danger/40 text-[10px]" onClick={() => { if (zoomed?.kind === "pending" && zoomed.id === p.key) setZoomed(null); onRemovePending(p.key); }} aria-label={`Quitar ${p.file.name}`}>✕</button>
        </div>
      ))}
      {zoomSrc && zoomAlt && <PhotoZoom src={zoomSrc} alt={zoomAlt} size="attachment" onClose={() => setZoomed(null)} />}
    </div>
  );
}

export function AttachmentStrip({
  existing,
  pending,
  removed,
  previews,
  fileRef,
  onAdd,
  onRemoveExisting,
  onRemovePending,
  embedded = false,
  kind = "task",
}: {
  existing: TaskAttachment[];
  pending: PendingAttachment[];
  removed: string[];
  previews: Record<string, string>;
  fileRef: { current: HTMLInputElement | null };
  onAdd: (list: FileList | null) => void;
  onRemoveExisting: (id: string) => void;
  onRemovePending: (key: string) => void;
  /** Chips + hidden file input only; parent owns the attach button. */
  embedded?: boolean;
  kind?: AttachmentKind;
}) {
  const visible = existing.filter((a) => !removed.includes(a.id));
  const full = countAttachments(existing, pending, removed) >= maxFilesFor(kind);
  const empty = visible.length === 0 && pending.length === 0;
  const thumbs = (
    <AttachmentThumbs
      existing={existing}
      pending={pending}
      removed={removed}
      previews={previews}
      onRemoveExisting={onRemoveExisting}
      onRemovePending={onRemovePending}
    />
  );
  const fileInput = <input ref={fileRef} type="file" accept={attachmentAccept()} multiple className="sr-only" onChange={(e) => { onAdd(e.target.files); }} />;

  if (embedded) {
    return (
      <div className="space-y-2">
        {fileInput}
        {thumbs}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="label mb-0">Adjuntos</label>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent rounded-md px-1.5 py-1 -mr-1.5 transition-colors hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => fileRef.current?.click()}
          disabled={full}
        >
          <Paperclip className="w-3.5 h-3.5" />Añadir
        </button>
      </div>
      {fileInput}
      {empty ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-border px-4 py-4 text-xs text-faint transition-colors hover:border-accent/40 hover:text-muted"
        >
          {attachmentDropHint(kind)}
        </button>
      ) : thumbs}
    </div>
  );
}
