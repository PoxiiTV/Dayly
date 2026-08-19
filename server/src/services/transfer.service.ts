import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  emptyBundle,
  type TransferBundle,
  type TransferFormat,
} from "../lib/transfer.js";

export type TransferType = "tasks" | "events" | "notes";

export function parseTypes(raw?: string): TransferType[] {
  const allowed: TransferType[] = ["tasks", "events", "notes"];
  if (!raw || !raw.trim()) return allowed;
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()) as TransferType[];
  const picked = allowed.filter((t) => parts.includes(t));
  return picked.length ? picked : allowed;
}

export async function loadBundle(userId: string, types: TransferType[]): Promise<TransferBundle> {
  const want = new Set(types);
  const bundle = emptyBundle();

  if (want.has("tasks")) {
    const tasks = await prisma.task.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    bundle.tasks = tasks.map((t) => ({
      title: t.title,
      description: t.description,
      dueDate: t.dueDate?.toISOString() ?? null,
      hasTime: t.hasTime,
      priority: t.priority,
      status: t.status,
      notes: t.notes,
      color: t.color,
      estimateMinutes: t.estimateMinutes,
    }));
  }

  if (want.has("events")) {
    const events = await prisma.event.findMany({
      where: { userId, deletedAt: null },
      orderBy: { startAt: "asc" },
    });
    bundle.events = events.map((e) => ({
      title: e.title,
      description: e.description,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      allDay: e.allDay,
      location: e.location,
      color: e.color,
      status: e.status,
    }));
  }

  if (want.has("notes")) {
    const notes = await prisma.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    bundle.notes = notes.map((n) => ({
      title: n.title,
      content: n.content,
      pinned: n.pinned,
      favorite: n.favorite,
      color: n.color,
    }));
  }

  return bundle;
}

export async function persistBundle(userId: string, bundle: TransferBundle) {
  const created = { tasks: 0, events: 0, notes: 0 };

  await prisma.$transaction(async (tx) => {
    if (bundle.tasks.length) {
      const r = await tx.task.createMany({
        data: bundle.tasks.map((t) => ({
          userId,
          title: t.title,
          description: t.description ?? null,
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          hasTime: t.hasTime ?? false,
          priority: (t.priority ?? "NORMAL") as Prisma.TaskCreateManyInput["priority"],
          status: (t.status ?? "PENDING") as Prisma.TaskCreateManyInput["status"],
          notes: t.notes ?? null,
          color: t.color ?? null,
          estimateMinutes: t.estimateMinutes ?? null,
        })),
      });
      created.tasks = r.count;
    }
    if (bundle.events.length) {
      const r = await tx.event.createMany({
        data: bundle.events.map((e) => ({
          userId,
          title: e.title,
          description: e.description ?? null,
          startAt: new Date(e.startAt),
          endAt: new Date(e.endAt),
          allDay: e.allDay ?? false,
          location: e.location ?? null,
          color: e.color ?? null,
          status: (e.status ?? "PENDING") as Prisma.EventCreateManyInput["status"],
        })),
      });
      created.events = r.count;
    }
    if (bundle.notes.length) {
      const r = await tx.note.createMany({
        data: bundle.notes.map((n) => ({
          userId,
          title: n.title,
          content: n.content ?? null,
          pinned: n.pinned ?? false,
          favorite: n.favorite ?? false,
          color: n.color ?? null,
        })),
      });
      created.notes = r.count;
    }
  });

  return created;
}
