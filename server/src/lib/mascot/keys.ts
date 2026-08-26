import type { MascotProvider } from "./catalog.js";

export type ProviderKeySlot = { enc: string | null; valid: boolean };
export type ProviderKeyVault = Record<MascotProvider, ProviderKeySlot>;
export type ProviderKeyStatus = { hasKey: boolean; valid: boolean };

const PROVIDERS: MascotProvider[] = ["opencode", "openrouter", "custom"];

export function asMascotProvider(raw: string): MascotProvider {
  switch (raw) {
    case "opencode":
    case "openrouter":
    case "custom":
      return raw;
    default:
      return "opencode";
  }
}

export function emptyKeyVault(): ProviderKeyVault {
  return {
    opencode: { enc: null, valid: false },
    openrouter: { enc: null, valid: false },
    custom: { enc: null, valid: false },
  };
}

export function parseKeyVault(raw: string | null | undefined): ProviderKeyVault {
  const vault = emptyKeyVault();
  if (!raw) return vault;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<MascotProvider, { enc?: unknown; valid?: unknown }>>;
    for (const provider of PROVIDERS) {
      const slot = parsed[provider];
      if (!slot || typeof slot !== "object") continue;
      const enc = typeof slot.enc === "string" && slot.enc.trim() ? slot.enc : null;
      vault[provider] = { enc, valid: Boolean(enc) && Boolean(slot.valid) };
    }
  } catch {
    return emptyKeyVault();
  }
  return vault;
}

export function serializeKeyVault(vault: ProviderKeyVault): string {
  return JSON.stringify(vault);
}

export function hydrateKeyVault(
  raw: string | null | undefined,
  legacyEnc: string | null | undefined,
  savedProvider: string,
): ProviderKeyVault {
  const vault = parseKeyVault(raw);
  const provider = asMascotProvider(savedProvider);
  if (!vault[provider].enc && legacyEnc) {
    vault[provider] = { enc: legacyEnc, valid: vault[provider].valid };
  }
  return vault;
}

export function keyEncFor(vault: ProviderKeyVault, provider: MascotProvider): string | null {
  switch (provider) {
    case "opencode":
    case "openrouter":
    case "custom":
      return vault[provider].enc;
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}

export function publicKeyStatus(vault: ProviderKeyVault): Record<MascotProvider, ProviderKeyStatus> {
  const status = {} as Record<MascotProvider, ProviderKeyStatus>;
  for (const provider of PROVIDERS) {
    const hasKey = Boolean(vault[provider].enc);
    status[provider] = { hasKey, valid: hasKey && vault[provider].valid };
  }
  return status;
}
