import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus, AlarmClock, Trash2, Send, Paperclip } from "lucide-react";
import clsx from "clsx";
import { http, getReminderAttachmentBlob } from "@/lib/api";
import type { Reminder, TaskAttachment } from "@/lib/types";
import { Spinner, EmptyState, Button, Input, Modal, Checkbox, useToast, PageHeader, TelegramNotifyToggle } from "@/components/ui";
import { useIntegration } from "@/lib/integrations";
import { fmtDate, fmtTime, toDateTimeLocal, fromDateTimeLocal, iso, relativeDay, localKey, suggestedCreateStart } from "@/lib/dates";
import { DateTimeField } from "@/components/DateTimeField";
import { useOccupiedTimes } from "@/lib/useOccupiedTimes";
import { AttachmentStrip } from "@/components/AttachmentStrip";
import {
  attachmentCapMessage,
  countAttachments,
  filesFromClipboard,
  isPreviewableImage,
  maxFilesFor,
  resolveAllowedMime,
  uploadAttachments,
  validateAttachmentFile,
  type PendingAttachment,
} from "@/lib/attachments";

export function Reminders() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useToast();
  const [editing, setEditing] = useState<Reminder | null | "new">(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => toDateTimeLocal(suggestedCreateStart()));
  const [until, setUntil] = useState("");
  const [daily, setDaily] = useState(false);
  const [telegram, setTelegram] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState<string | null>(null);
  const telegramAvailable = useIntegration("telegram") === "AVAILABLE";
  const [existing, setExisting] = useState<TaskAttachment[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);
  pendingRef.current = pending;

  const { data, isLoading } = useQuery({ queryKey: ["reminders"], queryFn: () => http.get<{ reminders: Reminder[] }>("/api/reminders") });
  const { data: telegramStatus } = useQuery({ queryKey: ["telegram-status"], queryFn: () => http.get<{ linked: boolean }>("/api/telegram/status") });
  const reminders = (data?.reminders ?? []).sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
  const isNew = editing === "new";
  const modalOpen = editing !== null;
  const editingId = editing && editing !== "new" ? editing.id : null;
  const excludeIds = useMemo(() => (editingId ? [editingId] : []), [editingId]);
  const startDay = at.slice(0, 10);
  const endDay = until.slice(0, 10);
  const startOccupied = useOccupiedTimes(startDay, modalOpen, excludeIds);
  const endOccupied = useOccupiedTimes(endDay, modalOpen && Boolean(endDay), excludeIds);

  const clearPending = useCallback(() => {
    setPending((prev) => {
      for (const item of prev) if (item.preview) URL.revokeObjectURL(item.preview);
      return [];
    });
  }, []);

  const fill = (r: Reminder | null) => {
    if (!r) {
      setTitle("");
      setAt(toDateTimeLocal(suggestedCreateStart()));
      setUntil("");
      setDaily(false);
      setTelegram(false);
      setExisting([]);
      setRemoved([]);
      clearPending();
      return;
    }
    setTitle(r.title ?? "");
    setAt(toDateTimeLocal(new Date(r.remindAt)));
    setUntil(r.endAt ? toDateTimeLocal(new Date(r.endAt)) : "");
    setDaily(r.scheduleDaily);
    setTelegram(Boolean(r.notifyTelegram));
    setExisting(r.attachments ?? []);
    setRemoved([]);
    clearPending();
  };

  const openNew = () => { fill(null); setEditing("new"); };
  const openEdit = (r: Reminder) => { fill(r); setEditing(r); };

  /**
   * `?r=<id>` opens that reminder, which is where the "Editar" of a quick add
   * and a notification link point. Consumed once so a refresh does not reopen
   * what you closed.
   */
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const wanted = searchParams.get("r");
    if (!wanted || openedFor.current === wanted) return;
    const found = reminders.find((r) => r.id === wanted);
    if (!found) return;
    openedFor.current = wanted;
    openEdit(found);
    const next = new URLSearchParams(searchParams);
    next.delete("r");
    setSearchParams(next, { replace: true });
  }, [searchParams, reminders, setSearchParams]);
  const closeModal = () => { fill(null); setEditing(null); };

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    const images = existing.filter((a) => isPreviewableImage(a.mimeType) && editingId && !removed.includes(a.id));
    if (!editingId || images.length === 0) { setPreviews({}); return; }
    void Promise.all(images.map(async (a) => {
      try {
        const blob = await getReminderAttachmentBlob(editingId, a.id);
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
  }, [editingId, existing, removed]);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const next = [...pendingRef.current];
    for (const file of Array.from(list)) {
      const err = await validateAttachmentFile(file, "reminder");
      if (err) { push("error", err); continue; }
      if (countAttachments(existing, next, removed) >= maxFilesFor("reminder")) {
        push("error", attachmentCapMessage("reminder"));
        break;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const mime = resolveAllowedMime(buf, file.name, "reminder");
      const preview = mime && isPreviewableImage(mime) ? URL.createObjectURL(file) : null;
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file, preview });
    }
    pendingRef.current = next;
    setPending(next);
    if (fileRef.current) fileRef.current.value = "";
  }, [existing, push, removed]);

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  useEffect(() => {
    if (!modalOpen) return;
    const onWinPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addFilesRef.current(files);
    };
    window.addEventListener("paste", onWinPaste);
    return () => window.removeEventListener("paste", onWinPaste);
  }, [modalOpen]);

  const payload = () => {
    const start = fromDateTimeLocal(at);
    const end = until ? fromDateTimeLocal(until) : null;
    const multiDay = end && localKey(end) !== localKey(start) && end.getTime() > start.getTime();
    return {
      title: title.trim() || null,
      remindAt: iso(start),
      endAt: multiDay ? iso(end) : null,
      scheduleDaily: daily,
      notifyTelegram: telegram,
    };
  };

  const save = async () => {
    try {
      let id = editingId;
      if (editing === "new") {
        const created = await http.post<{ reminder: Reminder }>("/api/reminders", payload());
        id = created.reminder.id;
      } else if (editing) {
        await http.patch(`/api/reminders/${editing.id}`, payload());
        for (const attId of removed) {
          await http.del(`/api/reminders/${editing.id}/attachments/${attId}`);
        }
      }
      if (id && pending.length) {
        await uploadAttachments("reminder", id, pending.map((p) => p.file));
      }
      push("success", editing === "new" ? "Recordatorio programado" : "Recordatorio actualizado");
      closeModal();
      qc.invalidateQueries({ queryKey: ["reminders"] });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    }
  };

  const del = async (id: string) => {
    try {
      await http.del(`/api/reminders/${id}`);
      qc.invalidateQueries({ queryKey: ["reminders"] });
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo eliminar.");
    }
  };

  const toggleTelegram = async (r: Reminder) => {
    if (telegramBusy) return;
    setTelegramBusy(r.id);
    try {
      await http.patch(`/api/reminders/${r.id}`, { notifyTelegram: !r.notifyTelegram });
      await qc.invalidateQueries({ queryKey: ["reminders"] });
      push(r.notifyTelegram ? "info" : "success", r.notifyTelegram ? "Aviso de Telegram desactivado" : "Aviso de Telegram activado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar el aviso de Telegram.");
    } finally {
      setTelegramBusy(null);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Recordatorios"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4" />Nuevo</Button>}
      />

      {isLoading ? <div className="grid place-items-center h-48 text-accent"><Spinner /></div> :
        reminders.length === 0 ? <EmptyState icon={<AlarmClock className="w-6 h-6" />} title="Sin recordatorios" action={<Button onClick={openNew}><Plus className="w-4 h-4" />Crear</Button>} /> :
        <div className="card divide-y divide-border/60 stagger overflow-hidden">
          {reminders.map((r) => {
            const past = new Date(r.remindAt).getTime() < Date.now();
            const hasFiles = (r.attachments?.length ?? 0) > 0;
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEdit(r);
                  }
                }}
                className="row group cursor-pointer"
              >
                <span className={clsx("row-icon", past ? "bg-bg border border-border text-faint" : "bg-accent-soft text-accent-strong")}><AlarmClock className="w-4 h-4" /></span>
                <div className="flex-1 min-w-0">
                  <p className={clsx("text-sm font-medium truncate inline-flex items-center gap-1.5 max-w-full", past ? "text-muted" : "text-text")}>
                    <span className="truncate">{r.title || "Recordatorio"}</span>
                    {hasFiles && <Paperclip className="w-3.5 h-3.5 text-faint shrink-0" aria-label="Tiene adjuntos" />}
                    {telegramAvailable && <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void toggleTelegram(r); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      disabled={telegramBusy === r.id}
                      className={clsx("shrink-0 rounded p-0.5", r.notifyTelegram ? "text-sky-500" : "text-faint opacity-0 group-hover:opacity-100 hover:text-sky-500")}
                      aria-label={r.notifyTelegram ? "Desactivar aviso de Telegram" : "Activar aviso de Telegram"}
                      title={r.notifyTelegram ? "Aviso de Telegram activado" : "Avisar por Telegram"}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {past ? "Pasado · " : "Aviso "}
                    {r.endAt && localKey(new Date(r.remindAt)) !== localKey(new Date(r.endAt))
                      ? `${relativeDay(r.remindAt)} – ${relativeDay(r.endAt)}`
                      : `${fmtDate(r.remindAt)} a las ${fmtTime(r.remindAt)}`}
                    {r.scheduleDaily && " · diario"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void del(r.id); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Eliminar recordatorio"
                  className="btn-ghost btn-icon text-faint hover:text-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={isNew ? "Nuevo recordatorio" : "Editar recordatorio"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancelar</Button>
            <Button onClick={() => void save()}>{isNew ? "Programar" : "Guardar"}</Button>
          </>
        }
      >
        <div
          className="space-y-5"
          onPaste={(e) => {
            const files = filesFromClipboard(e.clipboardData);
            if (!files.length) return;
            e.preventDefault();
            e.stopPropagation();
            void addFiles(files);
          }}
        >
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label="Título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Llamar a la sala" autoFocus />
            </div>
            <TelegramNotifyToggle on={telegram} onChange={setTelegram} linked={telegramStatus?.linked} />
          </div>
          <div className="modal-grid">
            <DateTimeField label="Desde" value={at} onChange={setAt} occupied={startOccupied} />
            <DateTimeField label="Hasta" value={until} onChange={setUntil} optional occupied={endOccupied} />
          </div>
          <Checkbox label="Repetir a diario" checked={daily} onChange={setDaily} />
          <AttachmentStrip
            kind="reminder"
            existing={existing}
            pending={pending}
            removed={removed}
            previews={previews}
            fileRef={fileRef}
            onAdd={(list) => { void addFiles(list); }}
            onRemoveExisting={(id) => setRemoved([...removed, id])}
            onRemovePending={(key) => {
              setPending((current) => {
                const item = current.find((p) => p.key === key);
                if (item?.preview) URL.revokeObjectURL(item.preview);
                return current.filter((p) => p.key !== key);
              });
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
