import type { Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";
import { config } from "../config/env.js";
import { APP_NAME } from "./brand.js";
import { createSession } from "../services/auth.service.js";
import { audit } from "../middleware/audit.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function rpConfig(req: Request) {
  const origins = config.clientOrigin.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const headerOrigin = (req.get("origin") ?? "").replace(/\/$/, "");
  const origin = headerOrigin || origins[0] || config.publicUrl.replace(/\/$/, "");
  let rpID = "localhost";
  try {
    rpID = new URL(origin).hostname;
  } catch {
    try { rpID = new URL(config.publicUrl).hostname; } catch { /* localhost */ }
  }
  return { rpID, origin, origins: origins.length ? origins : [origin], rpName: APP_NAME };
}

async function saveChallenge(kind: "register" | "login", challenge: string, userId?: string) {
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return prisma.passkeyChallenge.create({
    data: {
      kind,
      challenge,
      userId: userId ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

async function takeChallenge(id: string, kind: "register" | "login") {
  const row = await prisma.passkeyChallenge.findUnique({ where: { id } });
  if (!row || row.kind !== kind || row.expiresAt < new Date()) {
    throw ApiError.badRequest("La passkey ha caducado. Vuelve a intentarlo.");
  }
  await prisma.passkeyChallenge.delete({ where: { id } }).catch(() => undefined);
  return row;
}

function asTransports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((t): t is AuthenticatorTransportFuture => typeof t === "string");
}

export async function listPasskeys(userId: string) {
  const rows = await prisma.passkey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, deviceType: true, backedUp: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    deviceType: r.deviceType,
    backedUp: r.backedUp,
  }));
}

export async function startRegister(req: Request) {
  const userId = req.user!.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const existing = await prisma.passkey.findMany({ where: { userId } });
  const { rpID, rpName } = rpConfig(req);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: asTransports(p.transports),
    })),
  });
  const challenge = await saveChallenge("register", options.challenge, userId);
  return { options, challengeId: challenge.id };
}

export async function finishRegister(req: Request, body: { challengeId?: string; name?: string; response?: RegistrationResponseJSON }) {
  const userId = req.user!.id;
  if (!body.challengeId || !body.response) throw ApiError.badRequest("Falta la respuesta de la passkey.");
  const challenge = await takeChallenge(body.challengeId, "register");
  if (challenge.userId !== userId) throw ApiError.forbidden("La passkey no coincide con esta cuenta.");
  const { origin, origins, rpID } = rpConfig(req);
  const verified = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origins.length ? origins : origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verified.verified || !verified.registrationInfo) {
    throw ApiError.unauthorized("No se pudo registrar la passkey.");
  }
  const cred = verified.registrationInfo.credential;
  const name = (body.name ?? "").trim().slice(0, 80) || "Passkey";
  await prisma.passkey.create({
    data: {
      userId,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey),
      counter: cred.counter,
      deviceType: verified.registrationInfo.credentialDeviceType,
      backedUp: verified.registrationInfo.credentialBackedUp,
      transports: cred.transports ?? body.response.response.transports ?? [],
      name,
    },
  });
  await audit(req, "auth.passkey.register", { entityType: "user", entityId: userId });
  return { ok: true };
}

export async function startLogin(req: Request) {
  const { rpID } = rpConfig(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  const challenge = await saveChallenge("login", options.challenge);
  return { options, challengeId: challenge.id };
}

export async function finishLogin(req: Request, body: { challengeId?: string; response?: AuthenticationResponseJSON }) {
  if (!body.challengeId || !body.response) throw ApiError.badRequest("Falta la respuesta de la passkey.");
  const challenge = await takeChallenge(body.challengeId, "login");
  const credentialId = body.response.id;
  const passkey = await prisma.passkey.findUnique({ where: { credentialId } });
  if (!passkey) throw ApiError.unauthorized("Passkey no reconocida.");
  const user = await prisma.user.findUnique({ where: { id: passkey.userId }, include: { role: true } });
  if (!user || user.status !== "ACTIVE") throw ApiError.forbidden("Tu cuenta está suspendida. Contacta con el administrador.");

  const { origin, origins, rpID } = rpConfig(req);
  const verified = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origins.length ? origins : origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: asTransports(passkey.transports),
    },
  });
  if (!verified.verified) throw ApiError.unauthorized("No se pudo verificar la passkey.");

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: verified.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });
  await createSession(req, user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastIp: req.ip ?? null } });
  await audit(req, "auth.passkey.login", { entityType: "user", entityId: user.id });
  const { toPublicUser } = await import("../services/auth.service.js");
  return { user: toPublicUser(user) };
}

export async function deletePasskey(userId: string, id: string) {
  const row = await prisma.passkey.findFirst({ where: { id, userId } });
  if (!row) throw ApiError.notFound("Passkey no encontrada.");
  await prisma.passkey.delete({ where: { id } });
}
