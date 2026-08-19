import { Router } from "express";
import { Prisma, ProjectStatus } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned, paginate } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const projectInclude = {
  tags: true,
  _count: { select: { tasks: { where: { deletedAt: null } }, events: { where: { deletedAt: null } }, notes: { where: { deletedAt: null } } } },
};

// ---------- List ----------
projectsRouter.get("/", asyncHandler(async (req, res) => {
  const { status, q } = req.query as Record<string, string | undefined>;
  const where: Prisma.ProjectWhereInput = { userId: req.user!.id, deletedAt: null };
  if (status) where.status = status as ProjectStatus;
  if (q) where.name = { contains: q };
  const projects = await prisma.project.findMany({ where, include: projectInclude, orderBy: [{ updatedAt: "desc" }] });
  res.json({ projects });
}));

projectsRouter.get("/:id", asyncHandler(async (req, res) => {
  const project = await prisma.project.findFirst({ where: { id: req.params.id, userId: req.user!.id, deletedAt: null },
    include: { ...projectInclude, tasks: { where: { deletedAt: null }, orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }], include: { subtasks: true, tags: true } } } });
  if (!project) throw ApiError.notFound("Proyecto no encontrado.");
  // Derived progress: % of completed tasks.
  const total = project.tasks.length;
  const done = project.tasks.filter((t) => t.status === "COMPLETED").length;
  const progress = total ? Math.round((done / total) * 100) : (project.status === "COMPLETED" ? 100 : 0);
  res.json({ project: { ...project, progress } });
}));

projectsRouter.post("/", validate(schemas.createProjectSchema), asyncHandler(async (req, res) => {
  const b = req.body as unknown as z.infer<typeof schemas.createProjectSchema>;
  const data: Prisma.ProjectCreateInput = {
    name: b.name, description: b.description ?? null, color: b.color ?? null, status: b.status,
    startDate: b.startDate ? new Date(b.startDate) : null, dueDate: b.dueDate ? new Date(b.dueDate) : null,
    user: { connect: { id: req.user!.id } },
  };
  if (b.tagIds?.length) data.tags = { connect: b.tagIds.map((id) => ({ id })) };
  const project = await prisma.project.create({ data, include: projectInclude });
  res.status(201).json({ project });
}));

projectsRouter.patch("/:id", validate(schemas.updateProjectSchema), asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.project as never, req.params.id);
  const b = req.body as unknown as z.infer<typeof schemas.updateProjectSchema>;
  const data: Prisma.ProjectUpdateInput = {};
  for (const k of ["name", "description", "color", "status"] as const) if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k];
  if (b.startDate !== undefined) data.startDate = b.startDate ? new Date(b.startDate) : null;
  if (b.dueDate !== undefined) data.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (b.tagIds !== undefined) data.tags = { set: b.tagIds.map((id) => ({ id })) };
  const project = await prisma.project.update({ where: { id: req.params.id }, data, include: projectInclude });
  res.json({ project });
}));

projectsRouter.delete("/:id", asyncHandler(async (req, res) => { await assertOwned(req, prisma.project as never, req.params.id); await prisma.project.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } }); res.json({ ok: true }); }));
projectsRouter.post("/:id/restore", asyncHandler(async (req, res) => { await assertOwned(req, prisma.project as never, req.params.id); await prisma.project.update({ where: { id: req.params.id }, data: { deletedAt: null } }); res.json({ ok: true }); }));
projectsRouter.delete("/:id/permanent", asyncHandler(async (req, res) => { await assertOwned(req, prisma.project as never, req.params.id); await prisma.project.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

// Paginated tasks within a project.
projectsRouter.get("/:id/tasks", asyncHandler(async (req, res) => {
  const project = await prisma.project.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!project) throw ApiError.notFound("Proyecto no encontrado.");
  const pg = paginate(Number(req.query.page ?? 1), Number(req.query.pageSize ?? 50));
  const tasks = await prisma.task.findMany({ where: { projectId: project.id, userId: req.user!.id, deletedAt: null }, orderBy: [{ createdAt: "asc" }], skip: pg.skip, take: pg.take, include: { subtasks: true, tags: true } });
  res.json({ tasks, hasMore: tasks.length > pg.pageSize });
}));