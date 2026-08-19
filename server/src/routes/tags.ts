import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { assertOwned } from "../lib/ownership.js";
import * as schemas from "../validation/schemas.js";

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

tagsRouter.get("/", asyncHandler(async (req, res) => {
  const tags = await prisma.tag.findMany({ where: { userId: req.user!.id }, orderBy: { name: "asc" } });
  res.json({ tags });
}));

tagsRouter.post("/", validate(schemas.createTagSchema), asyncHandler(async (req, res) => {
  const b = req.body as { name: string; color?: string | null };
  try {
    const tag = await prisma.tag.create({ data: { userId: req.user!.id, name: b.name.trim(), color: b.color ?? null } });
    res.status(201).json({ tag });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw ApiError.conflict("Ya existe una etiqueta con ese nombre.");
    throw err;
  }
}));

tagsRouter.patch("/:id", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.tag as never, req.params.id);
  const { name, color } = req.body as { name?: string; color?: string | null };
  const tag = await prisma.tag.update({ where: { id: req.params.id }, data: { name: name ?? undefined, color: color ?? undefined } });
  res.json({ tag });
}));

tagsRouter.delete("/:id", asyncHandler(async (req, res) => {
  await assertOwned(req, prisma.tag as never, req.params.id);
  await prisma.tag.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));