import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/env.js";
import { sendVaultUnlockEmail, smtpReady } from "../lib/mail.js";
import * as schemas from "../validation/schemas.js";
import {
  assertNoPlaintextSecrets,
  consumeVaultEmailChallenge,
  isVaultBlob,
  issueVaultUnlock,
  requireVaultTotp,
  resolveVaultUnlock,
  revokeVaultUnlock,
  startVaultEmailChallenge,
  VAULT_BACKUP_KIND,
  VAULT_KDF,
} from "../lib/vault.js";

export const vaultRouter = Router();
vaultRouter.use(requireAuth);

function publicItem(row: { id: string; nonce: string; ciphertext: string; version: number; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publicKdf(vault: { kdf: string; kdfIterations: number; salt: string; checkNonce: string; checkCipher: string }) {
  return {
    kdf: vault.kdf,
    kdfIterations: vault.kdfIterations,
    salt: vault.salt,
    checkNonce: vault.checkNonce,
    checkCipher: vault.checkCipher,
  };
}

vaultRouter.get("/", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [user, vault] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    prisma.vault.findUnique({ where: { userId } }),
  ]);
  const unlock = vault ? await resolveVaultUnlock(req, userId) : null;
  res.json({
    exists: Boolean(vault),
    unlocked: Boolean(unlock),
    twoFactorEnabled: user.twoFactorEnabled,
    emailOtpRequired: await smtpReady(),
    ...(unlock && vault ? publicKdf(vault) : {}),
  });
}));

vaultRouter.post("/setup", authLimiter, validate(schemas.vaultSetupSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const b = req.body as {
    twoFactorCode: string;
    kdf: string;
    kdfIterations: number;
    salt: string;
    checkNonce: string;
    checkCipher: string;
  };
  if (b.kdf !== VAULT_KDF) throw ApiError.badRequest("KDF no admitido.");
  if (!isVaultBlob(b.checkNonce, b.checkCipher)) throw ApiError.badRequest("Comprobante del Cofre no válido.");
  await requireVaultTotp(userId, b.twoFactorCode);
  const existing = await prisma.vault.findUnique({ where: { userId } });
  if (existing) throw ApiError.conflict("Ya tienes un Cofre. Desbloquéalo o bórralo antes de crear otro.");
  const vault = await prisma.vault.create({
    data: {
      userId,
      kdf: b.kdf,
      kdfIterations: b.kdfIterations,
      salt: b.salt,
      checkNonce: b.checkNonce,
      checkCipher: b.checkCipher,
    },
  });
  await issueVaultUnlock(req, userId, vault.id);
  res.status(201).json({ ok: true, ...publicKdf(vault) });
}));

vaultRouter.post("/unlock", authLimiter, validate(schemas.vaultUnlockSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const { twoFactorCode } = req.body as { twoFactorCode: string };
  await requireVaultTotp(userId, twoFactorCode);
  const vault = await prisma.vault.findUnique({ where: { userId } });
  if (!vault) throw ApiError.notFound("No hay Cofre. Créalo primero.");
  if (await smtpReady()) {
    const { code } = await startVaultEmailChallenge(userId, vault.id);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
    await sendVaultUnlockEmail(owner.email, owner.name, code);
    const payload: Record<string, unknown> = { ok: true, needsEmailOtp: true };
    if (config.nodeEnv === "test") payload.emailCode = code;
    res.json(payload);
    return;
  }
  await issueVaultUnlock(req, userId, vault.id);
  res.json({ ok: true, needsEmailOtp: false, ...publicKdf(vault) });
}));

vaultRouter.post("/unlock/email", authLimiter, validate(schemas.vaultUnlockEmailSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const { emailCode } = req.body as { emailCode: string };
  const { vaultId } = await consumeVaultEmailChallenge(userId, emailCode);
  const vault = await prisma.vault.findFirst({ where: { id: vaultId, userId } });
  if (!vault) throw ApiError.notFound("No hay Cofre.");
  await issueVaultUnlock(req, userId, vault.id);
  res.json({ ok: true, needsEmailOtp: false, ...publicKdf(vault) });
}));

vaultRouter.post("/rekey", authLimiter, validate(schemas.vaultRekeySchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const b = req.body as {
    twoFactorCode: string;
    kdf: string;
    kdfIterations: number;
    salt: string;
    checkNonce: string;
    checkCipher: string;
    items: Array<{ id: string; nonce: string; ciphertext: string; version?: number }>;
  };
  if (b.kdf !== VAULT_KDF) throw ApiError.badRequest("KDF no admitido.");
  if (!isVaultBlob(b.checkNonce, b.checkCipher)) throw ApiError.badRequest("Comprobante del Cofre no válido.");
  for (const item of b.items) {
    if (!isVaultBlob(item.nonce, item.ciphertext)) throw ApiError.badRequest("Blob del Cofre no válido.");
  }
  await requireVaultTotp(userId, b.twoFactorCode);
  const vault = await prisma.vault.findFirst({ where: { id: unlock.vaultId, userId } });
  if (!vault) throw ApiError.notFound("No hay Cofre.");
  const existing = await prisma.vaultItem.findMany({ where: { userId, vaultId: vault.id }, select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  if (b.items.length !== existing.length) {
    throw ApiError.badRequest("Hay que volver a cifrar todas las entradas del Cofre.");
  }
  for (const item of b.items) {
    if (!existingIds.has(item.id)) throw ApiError.badRequest("Hay entradas que no pertenecen a este Cofre.");
  }
  const seen = new Set<string>();
  for (const item of b.items) {
    if (seen.has(item.id)) throw ApiError.badRequest("Entrada duplicada en el recifrado.");
    seen.add(item.id);
  }
  await prisma.$transaction(async (tx) => {
    await tx.vault.update({
      where: { id: vault.id },
      data: {
        kdf: b.kdf,
        kdfIterations: b.kdfIterations,
        salt: b.salt,
        checkNonce: b.checkNonce,
        checkCipher: b.checkCipher,
      },
    });
    for (const item of b.items) {
      await tx.vaultItem.update({
        where: { id: item.id },
        data: { nonce: item.nonce, ciphertext: item.ciphertext, version: item.version ?? 1 },
      });
    }
  });
  const next = await prisma.vault.findUniqueOrThrow({ where: { id: vault.id } });
  res.json({ ok: true, ...publicKdf(next) });
}));

vaultRouter.post("/lock", asyncHandler(async (req, res) => {
  await revokeVaultUnlock(req, req.user!.id);
  res.json({ ok: true });
}));

vaultRouter.post("/destroy", authLimiter, validate(schemas.vaultUnlockSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  await requireVaultTotp(userId, (req.body as { twoFactorCode: string }).twoFactorCode);
  const vault = await prisma.vault.findUnique({ where: { userId } });
  if (!vault) throw ApiError.notFound("No hay Cofre.");
  await prisma.vault.delete({ where: { id: vault.id } });
  await revokeVaultUnlock(req, userId);
  res.json({ ok: true });
}));

vaultRouter.get("/backup", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const vault = await prisma.vault.findFirst({ where: { id: unlock.vaultId, userId } });
  if (!vault) throw ApiError.notFound("No hay Cofre.");
  const items = await prisma.vaultItem.findMany({
    where: { userId, vaultId: vault.id },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  res.json({
    version: 1,
    kind: VAULT_BACKUP_KIND,
    exportedAt: new Date().toISOString(),
    kdf: vault.kdf,
    kdfIterations: vault.kdfIterations,
    salt: vault.salt,
    checkNonce: vault.checkNonce,
    checkCipher: vault.checkCipher,
    items: items.map((row) => ({ nonce: row.nonce, ciphertext: row.ciphertext, version: row.version })),
  });
}));

vaultRouter.post("/import", authLimiter, validate(schemas.vaultImportSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const b = req.body as {
    twoFactorCode: string;
    kdf: string;
    kdfIterations: number;
    salt: string;
    checkNonce: string;
    checkCipher: string;
    items: Array<{ nonce: string; ciphertext: string; version?: number }>;
  };
  if (b.kdf !== VAULT_KDF) throw ApiError.badRequest("KDF no admitido.");
  if (!isVaultBlob(b.checkNonce, b.checkCipher)) throw ApiError.badRequest("Comprobante del Cofre no válido.");
  for (const item of b.items) {
    if (!isVaultBlob(item.nonce, item.ciphertext)) throw ApiError.badRequest("Blob del Cofre no válido.");
  }
  await requireVaultTotp(userId, b.twoFactorCode);
  const existing = await prisma.vault.findUnique({ where: { userId } });
  if (existing) throw ApiError.conflict("Ya tienes un Cofre. Bórralo antes de restaurar una copia.");
  const vault = await prisma.$transaction(async (tx) => {
    const created = await tx.vault.create({
      data: {
        userId,
        kdf: b.kdf,
        kdfIterations: b.kdfIterations,
        salt: b.salt,
        checkNonce: b.checkNonce,
        checkCipher: b.checkCipher,
      },
    });
    if (b.items.length) {
      await tx.vaultItem.createMany({
        data: b.items.map((item) => ({
          userId,
          vaultId: created.id,
          nonce: item.nonce,
          ciphertext: item.ciphertext,
          version: item.version ?? 1,
        })),
      });
    }
    return created;
  });
  await issueVaultUnlock(req, userId, vault.id);
  res.status(201).json({ ok: true, imported: b.items.length, ...publicKdf(vault) });
}));

vaultRouter.get("/items", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const items = await prisma.vaultItem.findMany({
    where: { userId, vaultId: unlock.vaultId },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  res.json({ items: items.map(publicItem) });
}));

vaultRouter.post("/items/import", validate(schemas.vaultItemsImportSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const b = req.body as { items: Array<{ nonce: string; ciphertext: string; version?: number }> };
  for (const item of b.items) {
    if (!isVaultBlob(item.nonce, item.ciphertext)) throw ApiError.badRequest("Blob del Cofre no válido.");
  }
  const result = await prisma.$transaction(async (tx) => {
    const count = await tx.vaultItem.count({ where: { userId } });
    const room = Math.max(0, 500 - count);
    if (room <= 0) throw ApiError.badRequest("El Cofre ya tiene 500 entradas.");
    const batch = b.items.slice(0, room);
    await tx.vaultItem.createMany({
      data: batch.map((item) => ({
        userId,
        vaultId: unlock.vaultId,
        nonce: item.nonce,
        ciphertext: item.ciphertext,
        version: item.version ?? 1,
      })),
    });
    return { imported: batch.length, skipped: b.items.length - batch.length };
  });
  res.status(201).json({ ok: true, imported: result.imported, skipped: result.skipped });
}));

vaultRouter.post("/items/delete", validate(schemas.vaultItemsDeleteSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const ids = [...new Set((req.body as { ids: string[] }).ids)];
  const result = await prisma.vaultItem.deleteMany({
    where: { userId, vaultId: unlock.vaultId, id: { in: ids } },
  });
  res.json({ ok: true, deleted: result.count });
}));

vaultRouter.post("/items", validate(schemas.vaultItemBlobSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const b = req.body as { nonce: string; ciphertext: string; version?: number };
  if (!isVaultBlob(b.nonce, b.ciphertext)) throw ApiError.badRequest("Blob del Cofre no válido.");
  const count = await prisma.vaultItem.count({ where: { userId } });
  if (count >= 500) throw ApiError.badRequest("Máximo 500 entradas en el Cofre.");
  const item = await prisma.vaultItem.create({
    data: {
      userId,
      vaultId: unlock.vaultId,
      nonce: b.nonce,
      ciphertext: b.ciphertext,
      version: b.version ?? 1,
    },
  });
  res.status(201).json({ item: publicItem(item) });
}));

vaultRouter.patch("/items/:id", validate(schemas.vaultItemBlobSchema), asyncHandler(async (req, res) => {
  assertNoPlaintextSecrets(req.body);
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const b = req.body as { nonce: string; ciphertext: string; version?: number };
  if (!isVaultBlob(b.nonce, b.ciphertext)) throw ApiError.badRequest("Blob del Cofre no válido.");
  const existing = await prisma.vaultItem.findFirst({ where: { id: req.params.id, userId, vaultId: unlock.vaultId } });
  if (!existing) throw ApiError.notFound("Entrada no encontrada.");
  const item = await prisma.vaultItem.update({
    where: { id: existing.id },
    data: { nonce: b.nonce, ciphertext: b.ciphertext, version: b.version ?? existing.version },
  });
  res.json({ item: publicItem(item) });
}));

vaultRouter.delete("/items/:id", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const unlock = await resolveVaultUnlock(req, userId);
  if (!unlock) throw ApiError.forbidden("Desbloquea el Cofre para continuar.");
  const existing = await prisma.vaultItem.findFirst({ where: { id: req.params.id, userId, vaultId: unlock.vaultId } });
  if (!existing) throw ApiError.notFound("Entrada no encontrada.");
  await prisma.vaultItem.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));
