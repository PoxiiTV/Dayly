import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { isSpotifyClientId } from "./spotifyClientId.js";

export { isSpotifyClientId };

export async function getSpotifyClientId(): Promise<string> {
  const stored = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
  const fromDb = stored?.clientId.trim() ?? "";
  return stored?.enabled && isSpotifyClientId(fromDb) ? fromDb : "";
}

export async function getSpotifySettings() {
  const stored = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
  const clientId = stored?.clientId.trim() ?? "";
  const configured = isSpotifyClientId(clientId);
  const available = Boolean(stored?.enabled && configured);
  return {
    enabled: Boolean(stored?.enabled),
    configured,
    available,
    operational: Boolean(available && stored?.validatedAt),
    clientId: configured ? clientId : "",
    validatedAt: stored?.validatedAt?.toISOString() ?? null,
  };
}

export async function saveSpotifySettings(input: { clientId?: string; enabled?: boolean; confirmReconnect?: boolean }) {
  const current = await prisma.spotifySetting.findUnique({ where: { id: 1 } });
  const clientId = input.clientId === undefined ? current?.clientId.trim() ?? "" : input.clientId.trim();
  if (clientId && !isSpotifyClientId(clientId)) {
    throw ApiError.badRequest("El Client ID de Spotify no es válido.");
  }
  const enabled = input.enabled ?? current?.enabled ?? Boolean(clientId);
  if (enabled && !isSpotifyClientId(clientId)) throw ApiError.badRequest("Indica un Client ID válido antes de habilitar Spotify.");
  const identityChanged = Boolean(current?.clientId.trim() && current.clientId.trim() !== clientId);
  const affectedConnections = identityChanged
    ? await prisma.spotifyConnection.count({ where: { status: "ACTIVE" } })
    : 0;
  if (affectedConnections && !input.confirmReconnect) {
    throw ApiError.conflict("Cambiar el Client ID obliga a volver a conectar las cuentas de Spotify.", {
      reason: "RECONNECT_REQUIRED",
      affectedConnections,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.spotifySetting.upsert({
      where: { id: 1 },
      create: { id: 1, clientId, enabled, importedFromEnvAt: new Date() },
      update: { clientId, enabled, validatedAt: identityChanged ? null : undefined },
    });
    if (affectedConnections) {
      await tx.spotifyConnection.updateMany({
        where: { status: "ACTIVE" },
        data: { status: "ERROR", refreshTokenEnc: "", lastError: "La aplicación de Spotify ha cambiado. Vuelve a conectar." },
      });
    }
  });
  return getSpotifySettings();
}
