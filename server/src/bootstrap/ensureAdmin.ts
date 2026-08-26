import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, passwordPolicyError } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

/** Ensure RBAC rows exist, then create the first admin from env if the DB is empty. */
export async function ensureRolesAndAdmin(): Promise<void> {
  await prisma.role.upsert({
    where: { name: RoleName.USER },
    update: {},
    create: { name: RoleName.USER, description: "Usuario estándar", permissions: [] },
  });
  await prisma.role.upsert({
    where: { name: RoleName.ADMIN },
    update: {},
    create: {
      name: RoleName.ADMIN,
      description: "Administrador",
      permissions: ["admin.access", "users.manage", "users.view", "stats.view"],
    },
  });

  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) return;

  const count = await prisma.user.count();
  if (count > 0) {
    logger.info("Users already exist; skipping ADMIN_EMAIL bootstrap");
    return;
  }

  const policy = passwordPolicyError(password);
  if (policy) {
    throw new Error(`ADMIN_PASSWORD no cumple la política: ${policy}`);
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });
  await prisma.user.create({
    data: {
      email,
      emailLower: email,
      name: "Admin",
      passwordHash: await hashPassword(password),
      roleId: adminRole.id,
      emailVerifiedAt: new Date(),
    },
  });
  logger.info({ email }, "Bootstrap admin created");
}
