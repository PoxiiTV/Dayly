import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { GROUP_NAME_MAX, displayNameOf, sanitizeNick, sanitizeSegments, segmentsAreUniform, segmentsText, type NickSegment } from "../lib/nick.js";
import * as schemas from "../validation/schemas.js";
import { audit } from "../middleware/audit.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  chatBuzzLimiter,
  chatRequestLimiter,
  chatSendLimiter,
  chatTypingLimiter,
} from "../middleware/rateLimit.js";
import { decryptChat, encryptChat } from "../lib/chat/crypto.js";
import {
  ensureFriendCode,
  formatFriendCode,
  normalizeFriendCode,
  pairKey,
  requireAcceptedLink,
  requireLink,
  rotateFriendCode,
  sideOf,
} from "../lib/chat/links.js";
import { notifyChatMessage } from "../lib/chat/notify.js";
import { addChatClient, publishChatEvent } from "../lib/chat/stream.js";
import { CHAT_SOUND_IDS, CHAT_SOUND_OFF, parseChatSound } from "../lib/chat/sounds.js";
import { CHAT_STATUSES, parseChatStatus, presenceOf, touchChatPresence } from "../lib/chat/presence.js";
import {
  acceptedFriendIds,
  loadGroup,
  MAX_GROUP_MEMBERS,
  MAX_GROUPS_PER_USER,
  otherMemberIds,
  requireGroupMember,
  requireGroupOwner,
} from "../lib/chat/groups.js";
import { CHAT_WALLPAPER_IDS, parseChatWallpaper } from "../lib/chat/wallpapers.js";
import { gifUrlProvider, isAllowedGifUrl, searchGifs } from "../lib/chat/gifs.js";
import { isGifSearchAvailable } from "../lib/gifSettings.js";
import { acceptChatFile } from "../middleware/upload.js";
import { MAX_CHAT_FILE_BYTES, readTransfer, storeTransfer } from "../lib/chat/transfers.js";
import { contentDisposition, isPreviewableImage, resolveAllowedMime, sanitizeFilename } from "../lib/attachment-policy.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** Same answer for "no such account" and "not discoverable": no enumeration. */
const VAGUE_REQUEST = "Si esa cuenta existe y admite solicitudes, le llegará tu invitación.";
const NOT_FOUND = "No se encontró a nadie con ese código.";
const BUZZ_COOLDOWN_MS = 10_000;
/**
 * A group buzz shakes every window at once, so it gets a much longer leash than
 * the one-to-one one: two minutes per person. Per PERSON, not per group — one
 * pest must not leave everybody else unable to call the others.
 */
const GROUP_BUZZ_COOLDOWN_MS = 2 * 60_000;
const MAX_PENDING_OUTGOING = 20;
const MAX_REQUESTS_PER_DAY = 30;
/** A rejected request can be resent, silently, only after this long. */
const DECLINE_SILENCE_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATE_COOLDOWN_MS = 5 * 60 * 1000;

const userCard = { id: true, name: true, avatarUrl: true, chatStatus: true, chatSeenAt: true, nick: true, nickColor: true, nickBold: true, subnick: true, nickSegments: true } as const;

const settingsSchema = z.object({
  discoverableByEmail: z.boolean().optional(),
  buzzEnabled: z.boolean().optional(),
  sound: z.enum([...CHAT_SOUND_IDS, CHAT_SOUND_OFF]).optional(),
  status: z.enum(CHAT_STATUSES).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que cambiar." });

const wallpaperSchema = z.object({
  // null clears it: back to the plain surface.
  wallpaper: z.enum(CHAT_WALLPAPER_IDS).nullable(),
});

const requestSchema = z.object({
  code: z.string().trim().min(1).max(24).optional(),
  email: z.string().trim().email().max(190).optional(),
}).refine((value) => Boolean(value.code) !== Boolean(value.email), {
  message: "Indica un código de amigo o un correo, no ambos.",
});

async function assertRequestCapacity(userId: string): Promise<void> {
  const [pendingOut, lastDay] = await Promise.all([
    prisma.friendLink.count({ where: { requestedById: userId, status: "PENDING" } }),
    prisma.friendLink.count({
      where: { requestedById: userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  if (pendingOut >= MAX_PENDING_OUTGOING || lastDay >= MAX_REQUESTS_PER_DAY) {
    throw ApiError.tooMany("Has enviado demasiadas solicitudes. Inténtalo más tarde.");
  }
}

const gifSchema = z.object({
  // Checked against the provider's hosts, not just "is a URL": this ends up in
  // an <img> in someone else's client.
  url: z.string().url().max(500).refine(isAllowedGifUrl, "GIF no permitido"),
  preview: z.string().url().max(500).refine(isAllowedGifUrl, "GIF no permitido"),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  description: z.string().max(120).optional(),
});

const sendSchema = z.object({
  body: z.string().trim().max(2000).optional(),
  gif: gifSchema.optional(),
  clientId: z.string().uuid(),
}).refine((value) => Boolean(value.body?.trim()) !== Boolean(value.gif), {
  message: "Envía texto o un GIF, no ambos.",
});

const gifSearchSchema = z.object({ q: z.string().max(60).optional() });

const historySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const readSchema = z.object({ upTo: z.string().datetime().optional() });

type LinkRow = Awaited<ReturnType<typeof prisma.friendLink.findFirstOrThrow>>;

/** Longest preview the list can show; keeps the row payload small. */
const PREVIEW_CHARS = 120;

function readPreview(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptChat(stored);
  } catch {
    // A preview is not worth a 500: the conversation itself still opens.
    return null;
  }
}

type OtherCard = { id: string; name: string; avatarUrl: string | null; chatStatus?: string | null; chatSeenAt?: Date | null; nick?: string | null; nickColor?: string | null; nickBold?: boolean | null; subnick?: string | null; nickSegments?: unknown };

function viewLink(link: LinkRow, userId: string, other: OtherCard) {
  const side = sideOf(link, userId);
  return {
    linkId: link.id,
    // Only what the other side is allowed to know: name, nick, face and
    // presence. The subnick travels too — it is the MSN line, meant to be read
    // by the people on your list and nobody else.
    user: {
      id: other.id,
      name: other.name,
      nick: other.nick ?? null,
      nickSegments: other.nickSegments ?? null,
      nickColor: other.nickColor ?? null,
      nickBold: Boolean(other.nickBold),
      subnick: other.subnick ?? null,
      avatarUrl: other.avatarUrl,
      status: presenceOf({ chatStatus: other.chatStatus ?? null, chatSeenAt: other.chatSeenAt ?? null }),
    },
    status: link.status,
    unreadCount: link[side.myUnread],
    lastMessageAt: link.lastMessageAt,
    otherBuzzAt: link[side.otherBuzz],
    // When the other side last read: a message older than this has been seen.
    otherReadAt: link[side.otherRead],
    muted: link[side.myMuted],
    wallpaper: parseChatWallpaper(link[side.myWallpaper]),
    lastMessage: readPreview(link.lastMessageEnc),
    lastMessageMine: link.lastMessageSenderId ? link.lastMessageSenderId === userId : null,
    blockedByMe: link.status === "BLOCKED" && link.blockedById === userId,
    requestedByMe: link.requestedById === userId,
    createdAt: link.createdAt,
  };
}

// ---------- Identity ----------

chatRouter.get("/me", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const code = await ensureFriendCode(userId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { chatDiscoverableByEmail: true, chatBuzzEnabled: true, chatSound: true, chatStatus: true },
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    friendCode: formatFriendCode(code),
    discoverableByEmail: user.chatDiscoverableByEmail,
    buzzEnabled: user.chatBuzzEnabled,
    sound: parseChatSound(user.chatSound),
    status: parseChatStatus(user.chatStatus),
    gifsAvailable: await isGifSearchAvailable(),
  });
}));

chatRouter.post("/friend-code/rotate", chatRequestLimiter, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { friendCodeUpdatedAt: true },
  });
  const last = current.friendCodeUpdatedAt?.getTime() ?? 0;
  if (Date.now() - last < ROTATE_COOLDOWN_MS) {
    throw ApiError.conflict("Espera unos minutos antes de cambiar el código otra vez.");
  }
  // Friendships survive: FriendLink references ids, never codes.
  const friendCode = await rotateFriendCode(userId);
  audit(req, "chat.code.rotate");
  res.json({ friendCode: formatFriendCode(friendCode) });
}));

chatRouter.patch("/settings", validate(settingsSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof settingsSchema>;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(body.discoverableByEmail === undefined ? {} : { chatDiscoverableByEmail: body.discoverableByEmail }),
      ...(body.buzzEnabled === undefined ? {} : { chatBuzzEnabled: body.buzzEnabled }),
      ...(body.sound === undefined ? {} : { chatSound: parseChatSound(body.sound) }),
      ...(body.status === undefined ? {} : { chatStatus: body.status }),
    },
    select: { chatDiscoverableByEmail: true, chatBuzzEnabled: true, chatSound: true, chatStatus: true },
  });
  res.json({
    settings: {
      discoverableByEmail: user.chatDiscoverableByEmail,
      buzzEnabled: user.chatBuzzEnabled,
      sound: parseChatSound(user.chatSound),
      status: parseChatStatus(user.chatStatus),
    },
  });
}));

// ---------- Friends ----------

chatRouter.get("/friends", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [asA, asB] = await Promise.all([
    prisma.friendLink.findMany({ where: { userAId: userId }, include: { userB: { select: userCard } } }),
    prisma.friendLink.findMany({ where: { userBId: userId }, include: { userA: { select: userCard } } }),
  ]);
  const rows = [
    ...asA.map((link) => ({ link, other: link.userB })),
    ...asB.map((link) => ({ link, other: link.userA })),
  ]
    // A blocked user must not see the link at all: for them the friend is gone.
    .filter(({ link }) => link.status !== "BLOCKED" || link.blockedById === userId)
    .filter(({ link }) => link.status !== "DECLINED")
    .map(({ link, other }) => viewLink(link, userId, other));

  const friends = rows
    .filter((row) => row.status === "ACCEPTED" || row.blockedByMe)
    .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  const pending = rows.filter((row) => row.status === "PENDING");

  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    friends,
    requests: {
      incoming: pending.filter((row) => !row.requestedByMe),
      outgoing: pending.filter((row) => row.requestedByMe),
    },
  });
}));

chatRouter.post("/requests", chatRequestLimiter, validate(requestSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof requestSchema>;
  const userId = req.user!.id;

  await assertRequestCapacity(userId);

  if (body.code) {
    const code = normalizeFriendCode(body.code);
    if (!code) throw ApiError.notFound(NOT_FOUND);
    const target = await prisma.user.findUnique({ where: { friendCode: code }, select: { id: true, status: true } });
    if (!target || target.status !== "ACTIVE") throw ApiError.notFound(NOT_FOUND);
    if (target.id === userId) throw ApiError.badRequest("Ese es tu propio código.");
    const outcome = await upsertRequest(userId, target.id);
    if (outcome === "blocked") throw ApiError.notFound(NOT_FOUND);
    audit(req, "chat.request.create", { entityType: "FriendLink", entityId: outcome.link.id });
    publishChatEvent(target.id, { type: "friends" });
    res.status(outcome.created ? 201 : 200).json({ link: outcome.link, autoAccepted: outcome.autoAccepted });
    return;
  }

  // By email the answer never changes, whatever we find: same status, same
  // text, so the endpoint cannot be used to probe who has an account here.
  const email = body.email!.toLowerCase();
  const target = await prisma.user.findUnique({
    where: { emailLower: email },
    select: { id: true, status: true, chatDiscoverableByEmail: true },
  });
  if (target && target.status === "ACTIVE" && target.chatDiscoverableByEmail && target.id !== userId) {
    const outcome = await upsertRequest(userId, target.id);
    if (outcome !== "blocked") {
      audit(req, "chat.request.create", { entityType: "FriendLink", entityId: outcome.link.id });
      publishChatEvent(target.id, { type: "friends" });
    }
  }
  res.status(202).json({ ok: true, message: VAGUE_REQUEST });
}));

type RequestOutcome = "blocked" | { link: LinkRow; created: boolean; autoAccepted: boolean };

/** One canonical row per pair, so crossed requests become a single friendship. */
async function upsertRequest(userId: string, targetId: string): Promise<RequestOutcome> {
  const key = pairKey(userId, targetId);
  const existing = await prisma.friendLink.findUnique({ where: { userAId_userBId: key } });

  if (!existing) {
    try {
      const link = await prisma.friendLink.create({
        data: { ...key, requestedById: userId, status: "PENDING" },
      });
      return { link, created: true, autoAccepted: false };
    } catch {
      // Lost the race against the other side asking at the same time.
      const raced = await prisma.friendLink.findUnique({ where: { userAId_userBId: key } });
      if (!raced) throw ApiError.internal("No se pudo enviar la solicitud.");
      return acceptIfTheirs(raced, userId);
    }
  }

  if (existing.status === "BLOCKED") return "blocked";
  if (existing.status === "ACCEPTED") return { link: existing, created: false, autoAccepted: false };
  if (existing.status === "PENDING") return acceptIfTheirs(existing, userId);

  // DECLINED: resending is a silent no-op for a week, so a rejection cannot be
  // used to pester, and it is never revealed to the sender either.
  const declinedAt = existing.declinedAt?.getTime() ?? 0;
  if (existing.requestedById === userId && Date.now() - declinedAt < DECLINE_SILENCE_MS) {
    return { link: existing, created: false, autoAccepted: false };
  }
  const link = await prisma.friendLink.update({
    where: { id: existing.id },
    data: { status: "PENDING", requestedById: userId, declinedAt: null },
  });
  return { link, created: false, autoAccepted: false };
}

async function acceptIfTheirs(link: LinkRow, userId: string): Promise<RequestOutcome> {
  if (link.requestedById === userId) return { link, created: false, autoAccepted: false };
  const accepted = await prisma.friendLink.update({
    where: { id: link.id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  return { link: accepted, created: false, autoAccepted: true };
}

chatRouter.post("/requests/:linkId/accept", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  // Only the other side can accept, and only while it is still pending.
  if (link.status !== "PENDING" || link.requestedById === userId) {
    throw ApiError.notFound("La solicitud no existe.");
  }
  const accepted = await prisma.friendLink.update({
    where: { id: link.id },
    data: { status: "ACCEPTED", acceptedAt: new Date(), declinedAt: null },
  });
  audit(req, "chat.request.accept", { entityType: "FriendLink", entityId: link.id });
  publishChatEvent(sideOf(link, userId).otherId, { type: "friends" });
  res.json({ link: accepted });
}));

chatRouter.post("/requests/:linkId/decline", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  if (link.status !== "PENDING" || link.requestedById === userId) {
    throw ApiError.notFound("La solicitud no existe.");
  }
  await prisma.friendLink.update({
    where: { id: link.id },
    data: { status: "DECLINED", declinedAt: new Date() },
  });
  res.json({ ok: true });
}));

chatRouter.post("/requests/:linkId/cancel", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  if (link.status !== "PENDING" || link.requestedById !== userId) {
    throw ApiError.notFound("La solicitud no existe.");
  }
  await prisma.friendLink.delete({ where: { id: link.id } });
  res.json({ ok: true });
}));

chatRouter.post("/friends/:linkId/block", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  if (link.status === "BLOCKED" && link.blockedById !== userId) {
    throw ApiError.notFound("La conversación no existe.");
  }
  // Messages are kept: blocking should not destroy what was said.
  const blocked = await prisma.friendLink.update({
    where: { id: link.id },
    data: { status: "BLOCKED", blockedById: userId, aUnreadCount: 0, bUnreadCount: 0 },
  });
  audit(req, "chat.link.block", { entityType: "FriendLink", entityId: link.id });
  publishChatEvent(sideOf(link, userId).otherId, { type: "friends" });
  res.json({ link: blocked });
}));

const prefsSchema = z.object({ muted: z.boolean() });

/** Silencing is personal: the other side is never told, and nothing is lost. */
chatRouter.patch("/friends/:linkId/prefs", validate(prefsSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  const side = sideOf(link, userId);
  const { muted } = req.body as z.infer<typeof prefsSchema>;
  await prisma.friendLink.update({ where: { id: link.id }, data: { [side.myMuted]: muted } });
  res.json({ muted });
}));

/** Hides the history for whoever asks. Nothing is deleted for the other side. */
chatRouter.post("/friends/:linkId/clear", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  const side = sideOf(link, userId);
  const now = new Date();
  await prisma.friendLink.update({
    where: { id: link.id },
    data: { [side.myCleared]: now, [side.myUnread]: 0, [side.myRead]: now },
  });
  audit(req, "chat.thread.clear", { entityType: "FriendLink", entityId: link.id });
  res.json({ clearedAt: now });
}));

/** Each side dresses the conversation for itself; the other one never sees it. */
chatRouter.patch("/friends/:linkId/wallpaper", validate(wallpaperSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  const side = sideOf(link, userId);
  const { wallpaper } = req.body as z.infer<typeof wallpaperSchema>;
  await prisma.friendLink.update({
    where: { id: link.id },
    data: { [side.myWallpaper]: wallpaper },
  });
  res.json({ wallpaper });
}));

chatRouter.post("/friends/:linkId/unblock", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  if (link.status !== "BLOCKED" || link.blockedById !== userId) {
    throw ApiError.notFound("La conversación no existe.");
  }
  const restored = await prisma.friendLink.update({
    where: { id: link.id },
    data: { status: "ACCEPTED", blockedById: null },
  });
  publishChatEvent(sideOf(link, userId).otherId, { type: "friends" });
  res.json({ link: restored });
}));

chatRouter.delete("/friends/:linkId", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  if (link.status === "BLOCKED" && link.blockedById !== userId) {
    throw ApiError.notFound("La conversación no existe.");
  }
  await prisma.friendLink.delete({ where: { id: link.id } });
  audit(req, "chat.friend.remove", { entityType: "FriendLink", entityId: link.id });
  publishChatEvent(sideOf(link, userId).otherId, { type: "friends" });
  res.json({ ok: true });
}));

// ---------- Thread ----------

function viewMessage(message: { id: string; senderId: string; kind: string; bodyEnc: string | null; attachmentEnc?: string | null; createdAt: Date }) {
  return {
    id: message.id,
    senderId: message.senderId,
    kind: message.kind,
    body: message.bodyEnc ? decryptChat(message.bodyEnc) : null,
    gif: message.kind === "GIF" && message.attachmentEnc ? readGif(message.attachmentEnc) : null,
    file: message.kind === "FILE" && message.attachmentEnc ? readFile(message.attachmentEnc) : null,
    createdAt: message.createdAt,
  };
}

/** The stored attachment, or nothing: a broken one must not sink the thread. */
function readGif(stored: string): z.infer<typeof gifSchema> | null {
  try {
    const parsed = gifSchema.safeParse(JSON.parse(decryptChat(stored)));
    return parsed.success && isAllowedGifUrl(parsed.data.url) ? parsed.data : null;
  } catch {
    return null;
  }
}

const fileSchema = z.object({
  transferId: z.string().min(1).max(40),
  name: z.string().max(180),
  mime: z.string().max(120),
  size: z.number().int().min(1),
  image: z.boolean(),
});

function readFile(stored: string): z.infer<typeof fileSchema> | null {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(decryptChat(stored)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Relays a file to the other side: at most 5 MB, encrypted on disk and swept
 * after a week. The server is the road, not the destination.
 */
chatRouter.post("/threads/:linkId/files", chatSendLimiter, acceptChatFile, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireAcceptedLink(userId, req.params.linkId);
  const side = sideOf(link, userId);
  const posted = (req as unknown as { file?: { buffer: Buffer; originalname?: string } }).file;
  if (!posted?.buffer?.length) throw ApiError.badRequest("Falta el archivo.");
  if (posted.buffer.length > MAX_CHAT_FILE_BYTES) throw ApiError.badRequest("El archivo pesa más de 5 MB.");

  const filename = sanitizeFilename(posted.originalname || "archivo");
  // Sniffed from the bytes, not taken from the name: an extension is a claim.
  const mimeType = resolveAllowedMime(posted.buffer, filename, "task");
  if (!mimeType) throw ApiError.badRequest("Ese tipo de archivo no se puede enviar.");

  const transfer = await storeTransfer({ linkId: link.id, senderId: userId, filename, mimeType, buffer: posted.buffer });
  const image = isPreviewableImage(mimeType);
  const attachment = { transferId: transfer.id, name: filename, mime: mimeType, size: transfer.sizeBytes, image };
  const preview = image ? "Ha enviado una imagen" : filename;

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        linkId: link.id,
        senderId: userId,
        kind: "FILE",
        attachmentEnc: encryptChat(JSON.stringify(attachment)),
      },
    }),
    prisma.friendLink.update({
      where: { id: link.id },
      data: {
        lastMessageAt: now,
        lastMessageEnc: encryptChat(preview),
        lastMessageSenderId: userId,
        ...(side.side === "A" ? { bUnreadCount: { increment: 1 } } : { aUnreadCount: { increment: 1 } }),
      },
    }),
  ]);

  publishChatEvent(side.otherId, { type: "message", linkId: link.id });
  await notifyChatMessage({
    toUserId: side.otherId,
    fromName: req.user!.name,
    linkId: link.id,
    kind: "FILE",
    preview,
    lastReadAt: link[side.otherRead],
  });
  res.status(201).json({ message: viewMessage(message) });
}));

/** Serves a relayed file to either side of the conversation, and to nobody else. */
chatRouter.get("/files/:id", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [links, memberships] = await Promise.all([
    prisma.friendLink.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true },
    }),
    prisma.chatGroupMember.findMany({ where: { userId }, select: { groupId: true } }),
  ]);
  const { row, data } = await readTransfer(req.params.id, {
    linkIds: links.map((link) => link.id),
    groupIds: memberships.map((member) => member.groupId),
  });
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", contentDisposition(row.filename, isPreviewableImage(row.mimeType)));
  res.end(data);
}));

/** Search runs on the server so the provider key never reaches a browser. */
chatRouter.get("/gifs", chatSendLimiter, validate(gifSearchSchema, "query"), asyncHandler(async (req, res) => {
  const { q } = req.query as z.infer<typeof gifSearchSchema>;
  const search = await searchGifs(q ?? "");
  res.setHeader("Cache-Control", "private, max-age=60");
  res.json(search);
}));

/* ---------- Favourite GIFs ---------- */

/** Small enough to keep the list a single query, big enough to be useful. */
const MAX_GIF_FAVORITES = 50;

const favoriteSchema = gifSchema.extend({ description: z.string().max(120).optional() });

function viewFavorite(row: { id: string; url: string; preview: string; width: number; height: number; description: string | null; provider: string }) {
  return {
    id: row.id,
    url: row.url,
    preview: row.preview,
    width: row.width,
    height: row.height,
    description: row.description ?? undefined,
    provider: row.provider,
  };
}

chatRouter.get("/gifs/favorites", asyncHandler(async (req, res) => {
  const rows = await prisma.gifFavorite.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: MAX_GIF_FAVORITES,
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ favorites: rows.map(viewFavorite) });
}));

/** Starring the same GIF twice is not an error: it gives back the one stored. */
chatRouter.post("/gifs/favorites", validate(favoriteSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const gif = req.body as z.infer<typeof favoriteSchema>;
  const provider = gifUrlProvider(gif.url);
  if (!provider) throw ApiError.badRequest("Ese GIF no viene de un proveedor permitido.");

  const existing = await prisma.gifFavorite.findUnique({ where: { userId_url: { userId, url: gif.url } } });
  if (existing) {
    res.json({ favorite: viewFavorite(existing) });
    return;
  }
  const count = await prisma.gifFavorite.count({ where: { userId } });
  if (count >= MAX_GIF_FAVORITES) {
    // Nothing is dropped behind the user's back: they choose what goes.
    throw ApiError.conflict(`Tienes ${MAX_GIF_FAVORITES} GIF favoritos. Quita alguno para guardar este.`);
  }
  const favorite = await prisma.gifFavorite.create({
    data: {
      userId,
      provider,
      url: gif.url,
      preview: gif.preview,
      width: gif.width,
      height: gif.height,
      description: gif.description ?? null,
    },
  });
  res.status(201).json({ favorite: viewFavorite(favorite) });
}));

chatRouter.delete("/gifs/favorites/:id", asyncHandler(async (req, res) => {
  // Scoped by user, so someone else's id is simply not found.
  const removed = await prisma.gifFavorite.deleteMany({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (removed.count === 0) throw ApiError.notFound("Ese favorito no existe.");
  res.json({ ok: true });
}));

chatRouter.get("/threads/:linkId/messages", validate(historySchema, "query"), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireAcceptedLink(userId, req.params.linkId);
  const query = req.query as unknown as z.infer<typeof historySchema>;
  const limit = query.limit ?? 50;

  const cleared = link[sideOf(link, userId).myCleared];
  const rows = await prisma.chatMessage.findMany({
    where: {
      linkId: link.id,
      // Clearing hides the history for the one who asked for it, and only
      // for them: the other side keeps the conversation intact.
      ...(cleared ? { createdAt: { gt: cleared } } : {}),
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    messages: page.map(viewMessage).reverse(),
    nextBefore: rows.length > limit ? page[page.length - 1]?.createdAt ?? null : null,
  });
}));

chatRouter.post("/threads/:linkId/messages", chatSendLimiter, validate(sendSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireAcceptedLink(userId, req.params.linkId);
  const body = req.body as z.infer<typeof sendSchema>;
  const side = sideOf(link, userId);

  // A phone on a flaky network will retry this POST; the same clientId must
  // never produce two messages.
  const duplicate = await prisma.chatMessage.findUnique({
    where: { senderId_clientMsgId: { senderId: userId, clientMsgId: body.clientId } },
  });
  if (duplicate) {
    res.json({ message: viewMessage(duplicate) });
    return;
  }

  const now = new Date();
  const preview = body.gif ? (body.gif.description?.trim() || "GIF") : body.body!.slice(0, PREVIEW_CHARS);
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        linkId: link.id,
        senderId: userId,
        kind: body.gif ? "GIF" : "TEXT",
        bodyEnc: body.gif ? null : encryptChat(body.body!),
        // The attachment column was reserved for exactly this from day one.
        attachmentEnc: body.gif ? encryptChat(JSON.stringify(body.gif)) : null,
        clientMsgId: body.clientId,
      },
    }),
    prisma.friendLink.update({
      where: { id: link.id },
      data: {
        lastMessageAt: now,
        lastMessageEnc: encryptChat(preview),
        lastMessageSenderId: userId,
        ...(side.side === "A" ? { bUnreadCount: { increment: 1 } } : { aUnreadCount: { increment: 1 } }),
      },
    }),
  ]);

  // Push before anything else: the point of the stream is that the other side
  // sees this now. The notification is still awaited — leaving a write in
  // flight after responding races with whatever comes next.
  publishChatEvent(side.otherId, { type: "message", linkId: link.id });
  await notifyChatMessage({
    toUserId: side.otherId,
    fromName: req.user!.name,
    linkId: link.id,
    kind: body.gif ? "GIF" : "TEXT",
    preview,
    lastReadAt: link[side.otherRead],
  });
  res.status(201).json({ message: viewMessage(message) });
}));

/**
 * "Escribiendo…" for a one-to-one thread. Same deal as the group one: nothing
 * is written down, the event just goes to the other side. A blocked link is
 * refused by requireAcceptedLink, so a blocked person cannot even signal.
 */
chatRouter.post("/threads/:linkId/typing", chatTypingLimiter, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireAcceptedLink(userId, req.params.linkId);
  const other = link.userAId === userId ? link.userBId : link.userAId;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, nick: true } });
  publishChatEvent(other, {
    type: "typing",
    linkId: link.id,
    userId,
    name: displayNameOf({ name: me?.name ?? "", nick: me?.nick ?? null }),
  });
  res.status(202).json({ ok: true });
}));

chatRouter.post("/threads/:linkId/buzz", chatBuzzLimiter, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireAcceptedLink(userId, req.params.linkId);
  const side = sideOf(link, userId);

  const now = new Date();
  const earliest = new Date(now.getTime() - BUZZ_COOLDOWN_MS);
  // Compare-and-set: two buzzes racing can only ever produce one.
  const claimed = await prisma.friendLink.updateMany({
    where: {
      id: link.id,
      ...(side.side === "A"
        ? { OR: [{ aLastBuzzAt: null }, { aLastBuzzAt: { lt: earliest } }] }
        : { OR: [{ bLastBuzzAt: null }, { bLastBuzzAt: { lt: earliest } }] }),
    },
    data: {
      lastMessageAt: now,
      lastMessageEnc: encryptChat("Zumbido"),
      lastMessageSenderId: userId,
      ...(side.side === "A"
        ? { aLastBuzzAt: now, bUnreadCount: { increment: 1 } }
        : { bLastBuzzAt: now, aUnreadCount: { increment: 1 } }),
    },
  });
  if (claimed.count === 0) {
    const sentAt = link[side.myBuzz]?.getTime() ?? 0;
    res.status(429).json({
      error: { code: "BUZZ_COOLDOWN", message: "Espera un momento antes de otro zumbido." },
      retryAfterMs: Math.max(0, BUZZ_COOLDOWN_MS - (Date.now() - sentAt)),
    });
    return;
  }

  const message = await prisma.chatMessage.create({
    data: { linkId: link.id, senderId: userId, kind: "BUZZ" },
  });
  publishChatEvent(side.otherId, { type: "buzz", linkId: link.id });
  await notifyChatMessage({
    toUserId: side.otherId,
    fromName: req.user!.name,
    linkId: link.id,
    kind: "BUZZ",
    preview: "Te ha mandado un zumbido.",
    lastReadAt: link[side.otherRead],
  });
  res.status(201).json({ message: viewMessage(message) });
}));

chatRouter.post("/threads/:linkId/read", validate(readSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const link = await requireLink(userId, req.params.linkId);
  const side = sideOf(link, userId);
  await prisma.friendLink.update({
    where: { id: link.id },
    data: side.side === "A"
      ? { aUnreadCount: 0, aLastReadAt: new Date() }
      : { bUnreadCount: 0, bLastReadAt: new Date() },
  });
  res.json({ ok: true });
}));

// ---------- Live stream ----------

/**
 * Server-Sent Events, so a message lands the moment it is sent instead of on
 * the next poll. The client keeps a slow poll as a fallback, so losing this
 * stream degrades latency rather than breaking the chat.
 */
chatRouter.get("/events", asyncHandler(async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Without this a buffering proxy would hold the events back and undo the
  // whole point of the stream.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Tells EventSource how fast to come back if the connection drops.
  res.write("retry: 3000" + String.fromCharCode(10, 10));

  touchChatPresence(req.user!.id);
  const close = addChatClient(req.user!.id, res, () => touchChatPresence(req.user!.id));
  req.on("close", close);
  res.on("close", close);
}));

// ---------- Poll ----------

/**
 * The only endpoint that runs all the time. Two indexed reads, no joins and no
 * COUNT(*): everything it needs is denormalised on FriendLink.
 */
chatRouter.get("/sync", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  // The poll every live client makes: cheap enough to double as the heartbeat.
  touchChatPresence(userId);
  const select = {
    id: true, userAId: true, userBId: true, status: true, blockedById: true, requestedById: true,
    lastMessageAt: true, aUnreadCount: true, bUnreadCount: true, aLastBuzzAt: true, bLastBuzzAt: true,
    updatedAt: true,
  } as const;
  // Two queries on purpose: an OR over both sides would not use either index.
  const [asA, asB, memberships] = await Promise.all([
    prisma.friendLink.findMany({ where: { userAId: userId }, select }),
    prisma.friendLink.findMany({ where: { userBId: userId }, select }),
    prisma.chatGroupMember.findMany({
      where: { userId },
      select: { groupId: true, unreadCount: true, group: { select: { lastMessageAt: true } } },
    }),
  ]);
  const all = [...asA, ...asB].filter((link) => link.status !== "BLOCKED" || link.blockedById === userId);

  const threads = all
    .filter((link) => link.status === "ACCEPTED")
    .map((link) => {
      const side = sideOf(link, userId);
      return {
        linkId: link.id,
        lastMessageAt: link.lastMessageAt,
        unreadCount: link[side.myUnread],
        otherBuzzAt: link[side.otherBuzz],
      };
    });
  const groups = memberships.map((member) => ({
    groupId: member.groupId,
    lastMessageAt: member.group.lastMessageAt,
    unreadCount: member.unreadCount,
  }));
  const unreadTotal = [...threads, ...groups].reduce((total, thread) => total + thread.unreadCount, 0);
  const pendingIncoming = all.filter((link) => link.status === "PENDING" && link.requestedById !== userId).length;

  // The row count matters: deleting a link (cancel, remove) does not move the
  // maximum updatedAt, so a version built only on time would miss it.
  const newest = [
    ...all.map((link) => link.updatedAt.getTime()),
    ...groups.map((group) => group.lastMessageAt?.getTime() ?? 0),
  ].reduce((max, at) => Math.max(max, at), 0);
  const version = `${newest}.${all.length}.${groups.length}.${unreadTotal}.${pendingIncoming}`;
  const etag = `W/"${version}"`;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.json({ version, unreadTotal, pendingIncoming, threads, groups });
}));

// ---------- Groups ----------

const groupIdList = z.array(z.string().min(1).max(40)).min(1).max(MAX_GROUP_MEMBERS - 1);
const groupCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  memberIds: groupIdList,
});
const groupRenameSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameSegments: z.array(z.object({ t: z.string().max(200), c: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish() })).max(60).nullish(),
});
const groupFriendRequestSchema = z.object({ userId: z.string().trim().min(1).max(40) });

/**
 * A group name is decorated with the same generator as a nick and read by every
 * member, so it gets the same cleaning: controls, bidi overrides, invisibles
 * and runaway combining marks out, and the cap counted in CODE POINTS — the
 * fancy alphabets are astral, and a plain `.max(60)` would reject a name of
 * thirty letters.
 */
function cleanGroupName(raw: string): string {
  const name = sanitizeNick(raw, GROUP_NAME_MAX);
  if (!name) throw ApiError.badRequest("Ponle un nombre al grupo.");
  return name;
}

/**
 * A name that changes colour partway through. `name` always keeps the plain
 * text, so every screen that just prints it goes on working; the pieces are
 * only stored when they actually differ in colour.
 */
function cleanGroupNamePieces(raw: unknown): { name: string; pieces: NickSegment[] | null } | null {
  const pieces = sanitizeSegments(raw, GROUP_NAME_MAX);
  if (!pieces) return null;
  return { name: segmentsText(pieces), pieces: segmentsAreUniform(pieces) ? null : pieces };
}
const groupAddSchema = z.object({ userIds: groupIdList });
const groupPrefsSchema = z.object({ muted: z.boolean() });

type GroupRow = Awaited<ReturnType<typeof loadGroup>>;

/** The group as this member sees it: their unread count, their wallpaper. */
function viewGroup(group: GroupRow, userId: string) {
  const me = group.members.find((member) => member.userId === userId);
  return {
    groupId: group.id,
    name: group.name,
    nameSegments: group.nameSegments ?? null,
    avatarUrl: group.avatarUrl,
    ownerId: group.ownerId,
    isOwner: group.ownerId === userId,
    members: group.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      avatarUrl: member.user.avatarUrl,
      status: presenceOf({ chatStatus: member.user.chatStatus, chatSeenAt: member.user.chatSeenAt }),
      isOwner: member.userId === group.ownerId,
    })),
    unreadCount: me?.unreadCount ?? 0,
    lastMessageAt: group.lastMessageAt,
    lastMessage: readPreview(group.lastMessageEnc),
    lastMessageMine: group.lastMessageSenderId ? group.lastMessageSenderId === userId : null,
    muted: me?.muted ?? false,
    wallpaper: parseChatWallpaper(me?.wallpaper ?? null),
    createdAt: group.createdAt,
  };
}

/** Everyone but the person who acted hears about it. */
function publishToGroup(group: GroupRow, exceptUserId: string, event: Parameters<typeof publishChatEvent>[1]): void {
  for (const id of otherMemberIds(group, exceptUserId)) publishChatEvent(id, event);
}

chatRouter.get("/groups", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const memberships = await prisma.chatGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groups = await prisma.chatGroup.findMany({
    where: { id: { in: memberships.map((member) => member.groupId) } },
    include: { members: { include: { user: { select: userCard } } } },
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    groups: groups
      .map((group) => viewGroup(group, userId))
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)),
  });
}));

/**
 * A group participant is already visible to the caller, so they can be
 * invited to friendship directly from the member list. The group membership
 * is the authorization boundary; no friend code or email discovery is needed.
 */
chatRouter.post("/groups/:id/friend-requests", chatRequestLimiter, validate(groupFriendRequestSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const { userId: targetId } = req.body as z.infer<typeof groupFriendRequestSchema>;
  if (targetId === userId) throw ApiError.badRequest("Ya estás en tu propia lista de amigos.");
  if (!group.members.some((member) => member.userId === targetId)) {
    throw ApiError.notFound("Esa persona no está en el grupo.");
  }

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
  if (!target || target.status !== "ACTIVE") throw ApiError.notFound(NOT_FOUND);
  await assertRequestCapacity(userId);
  const outcome = await upsertRequest(userId, target.id);
  if (outcome === "blocked") throw ApiError.notFound(NOT_FOUND);

  audit(req, "chat.request.create", { entityType: "FriendLink", entityId: outcome.link.id, metadata: { source: "group" } });
  publishChatEvent(target.id, { type: "friends" });
  res.status(outcome.created ? 201 : 200).json({ autoAccepted: outcome.autoAccepted });
}));

chatRouter.post("/groups", chatSendLimiter, validate(groupCreateSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const body = req.body as z.infer<typeof groupCreateSchema>;

  const mine = await prisma.chatGroup.count({ where: { members: { some: { userId } } } });
  if (mine >= MAX_GROUPS_PER_USER) throw ApiError.conflict("Tienes demasiados grupos.");

  const friends = await acceptedFriendIds(userId);
  const invited = [...new Set(body.memberIds)].filter((id) => id !== userId);
  // Only your own friends: nobody gets dragged in by a stranger.
  if (invited.some((id) => !friends.has(id))) throw ApiError.badRequest("Solo puedes añadir a tus amigos.");
  if (invited.length === 0) throw ApiError.badRequest("Elige al menos a una persona.");

  const group = await prisma.chatGroup.create({
    data: {
      name: cleanGroupName(body.name),
      ownerId: userId,
      members: { create: [userId, ...invited].map((id) => ({ userId: id })) },
    },
    include: { members: { include: { user: { select: userCard } } } },
  });
  publishToGroup(group, userId, { type: "groups", groupId: group.id });
  audit(req, "chat.group.create", { entityType: "chatGroup", entityId: group.id, metadata: { members: invited.length + 1 } });
  res.status(201).json({ group: viewGroup(group, userId) });
}));

chatRouter.patch("/groups/:id", validate(groupRenameSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  requireGroupOwner(group, userId);
  const body = req.body as z.infer<typeof groupRenameSchema>;
  const coloured = body.nameSegments === undefined || body.nameSegments === null
    ? null
    : cleanGroupNamePieces(body.nameSegments);
  const updated = await prisma.chatGroup.update({
    where: { id: group.id },
    data: {
      name: coloured ? coloured.name : cleanGroupName(body.name),
      nameSegments: coloured?.pieces
        ? (coloured.pieces as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
    include: { members: { include: { user: { select: userCard } } } },
  });
  publishToGroup(updated, userId, { type: "groups", groupId: group.id });
  res.json({ group: viewGroup(updated, userId) });
}));

/**
 * The group photo, changeable by ANY participant — not just the owner, the way
 * every messenger people already use works. Renaming and removing people stay
 * with the owner; this one is deliberately shared, so the audit entry records
 * who actually changed it.
 */
/**
 * "Escribiendo…" for a group. Fire and forget: no row, no cache to invalidate,
 * just the event. The name travels with it so the other side can say who.
 */
/** Buzz the whole group, once every two minutes per participant. */
chatRouter.post("/groups/:id/buzz", chatBuzzLimiter, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const now = new Date();
  const earliest = new Date(now.getTime() - GROUP_BUZZ_COOLDOWN_MS);

  // Compare-and-set on this member's own row: two buzzes racing produce one.
  const claimed = await prisma.chatGroupMember.updateMany({
    where: {
      groupId: group.id,
      userId,
      OR: [{ lastBuzzAt: null }, { lastBuzzAt: { lt: earliest } }],
    },
    data: { lastBuzzAt: now },
  });
  if (claimed.count === 0) {
    const mine = group.members.find((member) => member.userId === userId);
    const sentAt = mine?.lastBuzzAt?.getTime() ?? 0;
    res.status(429).json({
      error: { code: "BUZZ_COOLDOWN", message: "Ya has zumbado al grupo hace poco. Espera un par de minutos." },
      retryAfterMs: Math.max(0, GROUP_BUZZ_COOLDOWN_MS - (Date.now() - sentAt)),
    });
    return;
  }

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({ data: { groupId: group.id, senderId: userId, kind: "BUZZ" } }),
    prisma.chatGroup.update({
      where: { id: group.id },
      data: { lastMessageAt: now, lastMessageEnc: encryptChat("Zumbido"), lastMessageSenderId: userId },
    }),
    prisma.chatGroupMember.updateMany({
      where: { groupId: group.id, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } },
    }),
  ]);

  publishToGroup(group, userId, { type: "buzz", groupId: group.id });
  await Promise.all(group.members
    .filter((member) => member.userId !== userId)
    .map((member) => notifyChatMessage({
      toUserId: member.userId,
      fromName: req.user!.name,
      groupId: group.id,
      groupName: group.name,
      kind: "BUZZ",
      preview: "Ha zumbado al grupo.",
      lastReadAt: member.lastReadAt,
    })));
  res.status(201).json({ message: viewMessage(message) });
}));

chatRouter.post("/groups/:id/typing", chatTypingLimiter, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, nick: true } });
  publishToGroup(group, userId, {
    type: "typing",
    groupId: group.id,
    userId,
    name: displayNameOf({ name: me?.name ?? "", nick: me?.nick ?? null }),
  });
  res.status(202).json({ ok: true });
}));

chatRouter.patch("/groups/:id/photo", chatSendLimiter, validate(schemas.groupPhotoSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const body = req.body as z.infer<typeof schemas.groupPhotoSchema>;
  const updated = await prisma.chatGroup.update({
    where: { id: group.id },
    data: { avatarUrl: body.avatarUrl },
    include: { members: { include: { user: { select: userCard } } } },
  });
  publishToGroup(updated, userId, { type: "groups", groupId: group.id });
  audit(req, body.avatarUrl ? "chat.group.photo_set" : "chat.group.photo_clear", {
    entityType: "chatGroup",
    entityId: group.id,
  });
  res.json({ group: viewGroup(updated, userId) });
}));

chatRouter.post("/groups/:id/members", validate(groupAddSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const body = req.body as z.infer<typeof groupAddSchema>;

  const present = new Set(group.members.map((member) => member.userId));
  const invited = [...new Set(body.userIds)].filter((id) => !present.has(id));
  if (invited.length === 0) throw ApiError.badRequest("Ya están todos en el grupo.");
  if (present.size + invited.length > MAX_GROUP_MEMBERS) {
    throw ApiError.conflict(`Un grupo admite ${MAX_GROUP_MEMBERS} personas como mucho.`);
  }
  // Any member can bring in their own friends, not anyone they can name.
  const friends = await acceptedFriendIds(userId);
  if (invited.some((id) => !friends.has(id))) throw ApiError.badRequest("Solo puedes añadir a tus amigos.");

  await prisma.chatGroupMember.createMany({
    data: invited.map((id) => ({ groupId: group.id, userId: id })),
    skipDuplicates: true,
  });
  const updated = await loadGroup(group.id);
  publishToGroup(updated, userId, { type: "groups", groupId: group.id });
  audit(req, "chat.group.members.add", { entityType: "chatGroup", entityId: group.id, metadata: { added: invited.length } });
  res.json({ group: viewGroup(updated, userId) });
}));

chatRouter.delete("/groups/:id/members/:userId", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const target = req.params.userId;
  // You can always walk out; taking someone else out is the owner's call.
  if (target !== userId) requireGroupOwner(group, userId);
  if (target === group.ownerId && target !== userId) throw ApiError.badRequest("No puedes sacar a quien creó el grupo.");

  const removed = await prisma.chatGroupMember.deleteMany({ where: { groupId: group.id, userId: target } });
  if (removed.count === 0) throw ApiError.notFound("Esa persona no está en el grupo.");

  const left = await prisma.chatGroupMember.count({ where: { groupId: group.id } });
  // The last one out turns off the light: an empty group belongs to nobody.
  if (left === 0) {
    await prisma.chatGroup.delete({ where: { id: group.id } });
  } else if (group.ownerId === target) {
    // The owner left: the oldest remaining member keeps the group usable.
    const heir = await prisma.chatGroupMember.findFirst({
      where: { groupId: group.id },
      orderBy: { joinedAt: "asc" },
    });
    if (heir) await prisma.chatGroup.update({ where: { id: group.id }, data: { ownerId: heir.userId } });
  }
  publishToGroup(group, userId, { type: "groups", groupId: group.id });
  publishChatEvent(target, { type: "groups", groupId: group.id });
  audit(req, "chat.group.members.remove", { entityType: "chatGroup", entityId: group.id, metadata: { self: target === userId } });
  res.json({ ok: true });
}));

chatRouter.patch("/groups/:id/prefs", validate(groupPrefsSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await requireGroupMember(userId, req.params.id);
  const body = req.body as z.infer<typeof groupPrefsSchema>;
  await prisma.chatGroupMember.updateMany({
    where: { groupId: req.params.id, userId },
    data: { muted: body.muted },
  });
  res.json({ ok: true, muted: body.muted });
}));

chatRouter.patch("/groups/:id/wallpaper", validate(wallpaperSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await requireGroupMember(userId, req.params.id);
  const body = req.body as z.infer<typeof wallpaperSchema>;
  await prisma.chatGroupMember.updateMany({
    where: { groupId: req.params.id, userId },
    data: { wallpaper: body.wallpaper },
  });
  res.json({ ok: true, wallpaper: body.wallpaper });
}));

chatRouter.post("/groups/:id/clear", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await requireGroupMember(userId, req.params.id);
  await prisma.chatGroupMember.updateMany({
    where: { groupId: req.params.id, userId },
    data: { clearedAt: new Date(), unreadCount: 0 },
  });
  res.json({ ok: true });
}));

chatRouter.get("/groups/:id/messages", validate(historySchema, "query"), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group, me } = await requireGroupMember(userId, req.params.id);
  const query = req.query as unknown as z.infer<typeof historySchema>;
  const limit = query.limit ?? 50;

  const rows = await prisma.chatMessage.findMany({
    where: {
      groupId: group.id,
      // Clearing hides the history for the one who asked, and only for them.
      ...(me.clearedAt ? { createdAt: { gt: me.clearedAt } } : {}),
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    messages: page.map(viewMessage).reverse(),
    nextBefore: rows.length > limit ? page[page.length - 1]?.createdAt ?? null : null,
  });
}));

chatRouter.post("/groups/:id/messages", chatSendLimiter, validate(sendSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const body = req.body as z.infer<typeof sendSchema>;

  const duplicate = await prisma.chatMessage.findUnique({
    where: { senderId_clientMsgId: { senderId: userId, clientMsgId: body.clientId } },
  });
  if (duplicate) {
    res.json({ message: viewMessage(duplicate) });
    return;
  }

  const now = new Date();
  const preview = body.gif ? (body.gif.description?.trim() || "GIF") : body.body!.slice(0, PREVIEW_CHARS);
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        groupId: group.id,
        senderId: userId,
        kind: body.gif ? "GIF" : "TEXT",
        bodyEnc: body.gif ? null : encryptChat(body.body!),
        attachmentEnc: body.gif ? encryptChat(JSON.stringify(body.gif)) : null,
        clientMsgId: body.clientId,
      },
    }),
    prisma.chatGroup.update({
      where: { id: group.id },
      data: { lastMessageAt: now, lastMessageEnc: encryptChat(preview), lastMessageSenderId: userId },
    }),
    // Everyone else's badge; the sender has read it by definition.
    prisma.chatGroupMember.updateMany({
      where: { groupId: group.id, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } },
    }),
  ]);

  publishToGroup(group, userId, { type: "message", groupId: group.id });
  await Promise.all(group.members
    .filter((member) => member.userId !== userId)
    .map((member) => notifyChatMessage({
      toUserId: member.userId,
      fromName: req.user!.name,
      groupId: group.id,
      groupName: group.name,
      kind: body.gif ? "GIF" : "TEXT",
      preview,
      lastReadAt: member.lastReadAt,
    })));
  res.status(201).json({ message: viewMessage(message) });
}));

chatRouter.post("/groups/:id/files", chatSendLimiter, acceptChatFile, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const { group } = await requireGroupMember(userId, req.params.id);
  const posted = (req as unknown as { file?: { buffer: Buffer; originalname?: string } }).file;
  if (!posted?.buffer?.length) throw ApiError.badRequest("Falta el archivo.");
  if (posted.buffer.length > MAX_CHAT_FILE_BYTES) throw ApiError.badRequest("El archivo pesa más de 5 MB.");

  const filename = sanitizeFilename(posted.originalname || "archivo");
  const mimeType = resolveAllowedMime(posted.buffer, filename, "task");
  if (!mimeType) throw ApiError.badRequest("Ese tipo de archivo no se puede enviar.");

  const transfer = await storeTransfer({ groupId: group.id, senderId: userId, filename, mimeType, buffer: posted.buffer });
  const image = isPreviewableImage(mimeType);
  const attachment = { transferId: transfer.id, name: filename, mime: mimeType, size: transfer.sizeBytes, image };
  const preview = image ? "Ha enviado una imagen" : filename;

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        groupId: group.id,
        senderId: userId,
        kind: "FILE",
        attachmentEnc: encryptChat(JSON.stringify(attachment)),
      },
    }),
    prisma.chatGroup.update({
      where: { id: group.id },
      data: { lastMessageAt: now, lastMessageEnc: encryptChat(preview), lastMessageSenderId: userId },
    }),
    prisma.chatGroupMember.updateMany({
      where: { groupId: group.id, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } },
    }),
  ]);

  publishToGroup(group, userId, { type: "message", groupId: group.id });
  await Promise.all(group.members
    .filter((member) => member.userId !== userId)
    .map((member) => notifyChatMessage({
      toUserId: member.userId,
      fromName: req.user!.name,
      groupId: group.id,
      groupName: group.name,
      kind: "FILE",
      preview,
      lastReadAt: member.lastReadAt,
    })));
  res.status(201).json({ message: viewMessage(message) });
}));

chatRouter.post("/groups/:id/read", asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  await requireGroupMember(userId, req.params.id);
  await prisma.chatGroupMember.updateMany({
    where: { groupId: req.params.id, userId },
    data: { unreadCount: 0, lastReadAt: new Date() },
  });
  res.json({ ok: true });
}));
