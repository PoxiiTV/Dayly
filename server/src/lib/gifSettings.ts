import { decryptSecret, encryptSecret } from "./crypto.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

export type GifProvider = "giphy" | "klipy";

export type GifSettingsView = {
  enabled: boolean;
  /** Whether each key is stored. The keys themselves never leave the server. */
  hasGiphyKey: boolean;
  hasKlipyKey: boolean;
  giphyOn: boolean;
  klipyOn: boolean;
  updatedAt: string | null;
};

export async function getGifSettings(): Promise<GifSettingsView> {
  const row = await prisma.gifSetting.findUnique({ where: { id: 1 } });
  return {
    enabled: row?.enabled ?? false,
    hasGiphyKey: Boolean(row?.giphyKeyEnc),
    hasKlipyKey: Boolean(row?.klipyKeyEnc),
    giphyOn: row?.giphyOn ?? true,
    klipyOn: row?.klipyOn ?? true,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** True when at least one provider can answer a search. */
export async function isGifSearchAvailable(): Promise<boolean> {
  const row = await prisma.gifSetting.findUnique({ where: { id: 1 } });
  return Boolean(row?.enabled && ((row.giphyKeyEnc && row.giphyOn) || (row.klipyKeyEnc && row.klipyOn)));
}

/** Keys for the search proxy only. Never send these to a client. */
export async function getGifKeys(): Promise<Partial<Record<GifProvider, string>>> {
  const row = await prisma.gifSetting.findUnique({ where: { id: 1 } });
  if (!row?.enabled) return {};
  const keys: Partial<Record<GifProvider, string>> = {};
  const sources = [
    ["giphy", row.giphyKeyEnc, row.giphyOn],
    ["klipy", row.klipyKeyEnc, row.klipyOn],
  ] as const;
  for (const [provider, stored, on] of sources) {
    // A provider switched off keeps its key but answers nothing.
    if (!stored || !on) continue;
    try {
      keys[provider] = decryptSecret(stored);
    } catch {
      // A key that cannot be read is a key we do not have.
    }
  }
  return keys;
}

/**
 * Saves the provider settings. An omitted key keeps the stored one, so the panel
 * can flip the switch without re-typing anything; an empty string clears that one.
 */
export async function saveGifSettings(input: {
  enabled: boolean;
  giphyKey?: string;
  klipyKey?: string;
  giphyOn?: boolean;
  klipyOn?: boolean;
}): Promise<GifSettingsView> {
  const current = await prisma.gifSetting.findUnique({ where: { id: 1 } });
  const next = (value: string | undefined, stored: string | null | undefined) => (
    value === undefined ? stored ?? null : value.trim() ? encryptSecret(value.trim()) : null
  );
  const giphyKeyEnc = next(input.giphyKey, current?.giphyKeyEnc);
  const klipyKeyEnc = next(input.klipyKey, current?.klipyKeyEnc);
  const giphyOn = input.giphyOn ?? current?.giphyOn ?? true;
  const klipyOn = input.klipyOn ?? current?.klipyOn ?? true;
  const usable = (giphyKeyEnc && giphyOn) || (klipyKeyEnc && klipyOn);
  if (input.enabled && !usable) {
    throw ApiError.badRequest("Activa al menos un proveedor con su clave antes de habilitar los GIF.");
  }
  await prisma.gifSetting.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: input.enabled, giphyKeyEnc, klipyKeyEnc, giphyOn, klipyOn },
    update: { enabled: input.enabled, giphyKeyEnc, klipyKeyEnc, giphyOn, klipyOn },
  });
  return getGifSettings();
}
