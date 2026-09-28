import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { deriveKey } from "../../config/env.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { removeAttachmentFile, writeAttachmentFile, absUploadPath } from "../uploads.js";
import fs from "node:fs/promises";

/** Chat files are relayed, not hosted: 5 MB each and gone in a week. */
export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;
export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Its own key namespace, like the message bodies.
const DOMAIN = "user-chat:files";
const VERSION = 1;

/**
 * AES-256-GCM over the whole file.
 *
 * The bytes sit on the server only while they travel, but "only while they
 * travel" is not a reason to leave someone's photo readable on disk.
 */
function encryptFile(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

function decryptFile(stored: Buffer): Buffer {
  if (stored.length < 29 || stored[0] !== VERSION) throw ApiError.internal("No se pudo leer el archivo.");
  const iv = stored.subarray(1, 13);
  const tag = stored.subarray(13, 29);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(DOMAIN, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(29)), decipher.final()]);
}

export type StoredTransfer = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

/** Writes the file and the row that keeps track of when it has to go. */
export async function storeTransfer(opts: {
  /** One of the two: the conversation it travels in. */
  linkId?: string;
  groupId?: string;
  senderId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredTransfer> {
  if (!opts.buffer.length) throw ApiError.badRequest("El archivo está vacío.");
  if (opts.buffer.length > MAX_CHAT_FILE_BYTES) throw ApiError.badRequest("El archivo pesa más de 5 MB.");
  const owner = opts.linkId ?? opts.groupId;
  if (!owner) throw ApiError.internal("No se pudo enviar el archivo.");

  const storageKey = `chat/${owner}/${nanoid(18)}`;
  await writeAttachmentFile(storageKey, encryptFile(opts.buffer));
  const row = await prisma.chatTransfer.create({
    data: {
      linkId: opts.linkId ?? null,
      groupId: opts.groupId ?? null,
      senderId: opts.senderId,
      filename: opts.filename,
      mimeType: opts.mimeType,
      sizeBytes: opts.buffer.length,
      storageKey,
      expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
    },
  });
  return { id: row.id, filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
}

/** The bytes back, for someone the caller has already checked belongs here. */
export async function readTransfer(
  id: string,
  scope: { linkIds: string[]; groupIds?: string[] },
): Promise<{ row: { filename: string; mimeType: string }; data: Buffer }> {
  const row = await prisma.chatTransfer.findFirst({
    where: {
      id,
      OR: [
        { linkId: { in: scope.linkIds } },
        { groupId: { in: scope.groupIds ?? [] } },
      ],
    },
  });
  // Expired or never yours: both are "not found", so an id is no oracle.
  if (!row || row.expiresAt.getTime() <= Date.now()) throw ApiError.notFound("Ese archivo ya no está disponible.");
  const stored = await fs.readFile(absUploadPath(row.storageKey)).catch(() => null);
  if (!stored) throw ApiError.notFound("Ese archivo ya no está disponible.");
  return { row: { filename: row.filename, mimeType: row.mimeType }, data: decryptFile(stored) };
}

/** Deletes what has expired, file first so a crash never orphans bytes. */
export async function sweepExpiredTransfers(): Promise<number> {
  const due = await prisma.chatTransfer.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { id: true, storageKey: true },
    take: 200,
  });
  for (const row of due) {
    await removeAttachmentFile(row.storageKey);
  }
  if (due.length) {
    await prisma.chatTransfer.deleteMany({ where: { id: { in: due.map((row) => row.id) } } });
    logger.info({ count: due.length }, "expired chat transfers removed");
  }
  return due.length;
}

/** Hourly sweep, plus one at boot so a restart also tidies up. */
export function startTransferSweeper(): void {
  if (process.env.NODE_ENV === "test") return;
  const tick = () => {
    void sweepExpiredTransfers().catch((err) => logger.warn({ err }, "chat transfer sweep failed"));
  };
  tick();
  const timer = setInterval(tick, 60 * 60_000);
  timer.unref();
}
