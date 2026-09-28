import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { http } from "@/lib/api";
import { DEFAULT_ENTITY_COLOR, nextTagColor, PROJECT_COLORS } from "@/lib/projects";
import type { Tag } from "@/lib/types";
import { Button, ColorSwatches, ConfirmDialog, Input, Modal, Spinner, useToast } from "@/components/ui";

type TagDraft = { id: string | null; name: string; color: string };

/**
 * Shared by the task tags and the subscription ones. They are separate
 * vocabularies on purpose — "Seguros" has nothing to do with a task label —
 * but the screen to manage them is identical, so only the endpoint, the cache
 * key and the copy change.
 */
export function TagManager({
  open,
  onClose,
  onDeleted,
  endpoint = "/api/tags",
  queryKey = "tags",
  consumerKeys = ["tasks", "events", "notes", "projects", "goals"],
  description = "Renombra, recolorea o elimina etiquetas. Los cambios se reflejan en todos los elementos donde se usan.",
  deleteMessage = (name: string) => `Se quitará #${name} de tareas, eventos, notas, proyectos y objetivos. Esos elementos no se eliminarán.`,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted?: (id: string) => void;
  endpoint?: string;
  queryKey?: string;
  consumerKeys?: string[];
  description?: string;
  deleteMessage?: (name: string) => string;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => http.get<{ tags: Tag[] }>(endpoint),
    enabled: open,
  });
  const tags = data?.tags ?? [];
  const [draft, setDraft] = useState<TagDraft | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setDeleting(null);
      setBusy(false);
    }
  }, [open]);

  const refreshConsumers = async () => {
    await qc.invalidateQueries({ queryKey: [queryKey] });
    for (const key of consumerKeys) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const startCreate = () => {
    setDraft({ id: null, name: "", color: nextTagColor(tags) });
  };

  const save = async () => {
    if (!draft || busy) return;
    const name = draft.name.trim().replace(/^#/, "");
    if (!name) {
      push("error", "Escribe el nombre de la etiqueta.");
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await http.patch(`${endpoint}/${draft.id}`, { name, color: draft.color });
        push("success", `Etiqueta #${name} actualizada`);
      } else {
        await http.post(endpoint, { name, color: draft.color });
        push("success", `Etiqueta #${name} creada`);
      }
      setDraft(null);
      await refreshConsumers();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo guardar la etiqueta.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting || busy) return;
    const target = deleting;
    setBusy(true);
    try {
      await http.del(`${endpoint}/${target.id}`);
      setDeleting(null);
      if (draft?.id === target.id) setDraft(null);
      onDeleted?.(target.id);
      await refreshConsumers();
      push("success", `Etiqueta #${target.name} eliminada`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo eliminar la etiqueta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open && !deleting}
        onClose={onClose}
        title="Gestionar etiquetas"
        description={description}
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{tags.length} etiqueta{tags.length === 1 ? "" : "s"}</p>
            <Button size="sm" onClick={startCreate} disabled={busy}>
              <Plus aria-hidden="true" className="h-4 w-4" />Nueva etiqueta
            </Button>
          </div>

          {draft && (
            <section className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4" aria-label={draft.id ? "Editar etiqueta" : "Crear etiqueta"}>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Input
                  label="Nombre"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Ej. Trabajo"
                  maxLength={60}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    void save();
                  }}
                />
                <div className="flex gap-2 sm:pb-px">
                  <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>Cancelar</Button>
                  <Button onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : draft.id ? "Guardar" : "Crear"}</Button>
                </div>
              </div>
              <div className="mt-4">
                <ColorSwatches colors={PROJECT_COLORS} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} label="Color de la etiqueta" />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted" aria-live="polite">
                <span className="h-3 w-3 rounded-full" style={{ background: draft.color }} aria-hidden="true" />
                Vista previa: <strong className="text-text">#{draft.name.trim().replace(/^#/, "") || "Etiqueta"}</strong>
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="grid min-h-32 place-items-center text-accent"><Spinner /></div>
          ) : tags.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
              <Tags aria-hidden="true" className="mx-auto h-6 w-6 text-faint" />
              <p className="mt-3 text-sm font-medium text-text">Aún no hay etiquetas</p>
              <p className="mt-1 text-sm text-muted">Crea la primera con un nombre y un color.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {tags.map((tag) => (
                <li key={tag.id} className="flex min-h-16 items-center gap-3 bg-surface/60 px-3 py-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: tag.color ?? DEFAULT_ENTITY_COLOR }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">#{tag.name}</span>
                  <Button
                    variant="ghost"
                    icon
                    aria-label={`Editar etiqueta ${tag.name}`}
                    title="Editar"
                    onClick={() => setDraft({ id: tag.id, name: tag.name, color: tag.color ?? DEFAULT_ENTITY_COLOR })}
                    disabled={busy}
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    icon
                    className="text-faint hover:text-danger"
                    aria-label={`Eliminar etiqueta ${tag.name}`}
                    title="Eliminar"
                    onClick={() => setDeleting(tag)}
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={() => void remove()}
        title="Eliminar etiqueta"
        message={deleteMessage(deleting?.name ?? "")}
        confirmLabel="Eliminar etiqueta"
        busy={busy}
      />
    </>
  );
}
