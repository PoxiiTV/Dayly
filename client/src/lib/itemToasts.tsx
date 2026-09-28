import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { useToast } from "@/components/ui";
import type { QuickAddCreated } from "@/lib/quickAddCreate";

/**
 * The Gmail trick, for things you create and things you delete: a notice that
 * stays a few seconds with "Deshacer" — and, right after a quick add, "Editar"
 * so you can fix what the phrase got wrong without going to find the item.
 */

export type ItemKind = "task" | "event" | "reminder" | "note" | "project";

const LABEL: Record<ItemKind, { created: string; deleted: string }> = {
  task: { created: "Tarea creada", deleted: "Tarea eliminada" },
  event: { created: "Evento creado", deleted: "Evento eliminado" },
  reminder: { created: "Recordatorio creado", deleted: "Recordatorio eliminado" },
  note: { created: "Nota creada", deleted: "Nota eliminada" },
  project: { created: "Proyecto creado", deleted: "Proyecto eliminado" },
};

/**
 * Where the item opens for editing. Tasks, events and reminders live inside a
 * page, so they travel as a query parameter that the page picks up; notes and
 * projects already have a route of their own.
 */
export function editHref(kind: ItemKind, id: string): string {
  switch (kind) {
    case "task": return `/tasks?t=${id}`;
    case "event": return `/calendar?e=${id}`;
    case "reminder": return `/reminders?r=${id}`;
    case "note": return `/notes/${id}`;
    case "project": return `/projects/${id}`;
  }
}

/**
 * Undoing a creation removes the row for good rather than sending it to the
 * trash: it never really existed, and leaving it there would make "deshacer"
 * something you then have to clean up. Reminders are hard-deleted anyway.
 */
function undoCreatePath(kind: ItemKind, id: string): string {
  return kind === "reminder" ? `/api/reminders/${id}` : `/api/${kind}s/${id}/permanent`;
}

/**
 * Only the soft-deleted kinds can be brought back. A reminder has no
 * `deletedAt`, so there is nothing to restore and no undo is offered for it —
 * better than a button that silently recreates a different reminder without
 * its attachments.
 */
export function canUndoDelete(kind: ItemKind): boolean {
  return kind !== "reminder";
}

export function useItemToasts() {
  const { push } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const afterQuickAdd = useCallback((created: QuickAddCreated) => {
    const kind = created.kind as ItemKind;
    push("success", LABEL[kind].created, [
      {
        label: "Editar",
        onClick: () => navigate(editHref(kind, created.id)),
      },
      {
        label: "Deshacer",
        onClick: () => {
          void http.del(undoCreatePath(kind, created.id))
            .then(() => {
              qc.invalidateQueries();
              push("info", "Deshecho");
            })
            .catch(() => push("error", "No se pudo deshacer."));
        },
      },
    ]);
  }, [push, navigate, qc]);

  const afterDelete = useCallback((kind: ItemKind, id: string) => {
    if (!canUndoDelete(kind)) {
      push("success", LABEL[kind].deleted);
      return;
    }
    push("success", LABEL[kind].deleted, [
      {
        label: "Deshacer",
        onClick: () => {
          // `/api/trash/restore`, not `/api/{kind}s/:id/restore`: the per-entity
          // ones guard with the default ownership check, which demands
          // `deletedAt: null`, so restoring a deleted row answers 404. This is
          // the endpoint the Papelera itself uses.
          void http.post("/api/trash/restore", { type: kind, id })
            .then(() => {
              qc.invalidateQueries();
              push("info", "Restaurado");
            })
            .catch(() => push("error", "No se pudo restaurar. Búscalo en la papelera."));
        },
      },
    ]);
  }, [push, qc]);

  /**
   * Completing a task is the other move you want back in one click: the tick is
   * easy to hit by mistake and the row leaves the list straight away, so
   * finding it again means changing the filter.
   */
  const afterComplete = useCallback((id: string, previousStatus: string) => {
    push("success", "¡Tarea completada! 🎉", [
      {
        label: "Deshacer",
        onClick: () => {
          // Back to whatever it was, not a blanket PENDING: a task that was
          // "en curso" should not silently become a fresh one.
          void http.patch(`/api/tasks/${id}`, { status: previousStatus })
            .then(() => {
              qc.invalidateQueries();
              push("info", "Tarea sin completar");
            })
            .catch(() => push("error", "No se pudo deshacer."));
        },
      },
    ]);
  }, [push, qc]);

  return { afterQuickAdd, afterDelete, afterComplete };
}
