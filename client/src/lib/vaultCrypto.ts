/** Client-side vault crypto. The server never sees these keys or plaintext. */

export const VAULT_KDF = "pbkdf2-sha256" as const;
export const VAULT_ITERATIONS = 600_000;
export const VAULT_CHECK = { ok: true, v: 1 as const };

const text = new TextEncoder();
const textOut = new TextDecoder();

export const VAULT_HISTORY_MAX = 8;
export const VAULT_FIELDS_MAX = 8;
export const VAULT_KINDS = ["login", "note", "wifi", "card"] as const;
export type VaultEntryKind = (typeof VAULT_KINDS)[number];
export type VaultField = { label: string; value: string; hidden: boolean };

export type VaultPasswordHistoryItem = { password: string; changedAt: string };

export type VaultEntry = {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  otpSecret: string;
  favorite: boolean;
  folder: string;
  tags: string[];
  kind: VaultEntryKind;
  fields: VaultField[];
  passwordChangedAt: string;
  passwordHistory: VaultPasswordHistoryItem[];
};

export function emptyVaultEntry(): VaultEntry {
  return {
    title: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    otpSecret: "",
    favorite: false,
    folder: "",
    tags: [],
    kind: "login",
    fields: [],
    passwordChangedAt: "",
    passwordHistory: [],
  };
}

export type VaultBlob = { nonce: string; ciphertext: string };

export type VaultBackup = {
  version: 1;
  kind: "kalendiario-cofre";
  exportedAt: string;
  kdf: string;
  kdfIterations: number;
  salt: string;
  checkNonce: string;
  checkCipher: string;
  items: Array<VaultBlob & { version?: number }>;
};

const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveVaultKey(password: string, salt: string, iterations = VAULT_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64urlToBytes(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptVaultPayload(key: CryptoKey, payload: unknown): Promise<VaultBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, text.encode(JSON.stringify(payload)));
  return { nonce: bytesToB64url(nonce), ciphertext: bytesToB64url(new Uint8Array(buf)) };
}

export async function decryptVaultPayload<T>(key: CryptoKey, blob: VaultBlob): Promise<T> {
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlToBytes(blob.nonce) },
    key,
    b64urlToBytes(blob.ciphertext),
  );
  return JSON.parse(textOut.decode(data)) as T;
}

export async function encryptVaultEntry(key: CryptoKey, entry: VaultEntry): Promise<VaultBlob> {
  return encryptVaultPayload(key, {
    title: entry.title.trim(),
    username: entry.username.trim(),
    password: entry.password,
    url: entry.url.trim(),
    notes: entry.notes.trim(),
    otpSecret: entry.otpSecret.trim(),
    favorite: Boolean(entry.favorite),
    folder: normalizeVaultFolder(entry.folder),
    tags: normalizeVaultTags(entry.tags),
    kind: normalizeVaultKind(entry.kind),
    fields: normalizeVaultFields(entry.fields),
    passwordChangedAt: typeof entry.passwordChangedAt === "string" ? entry.passwordChangedAt : "",
    passwordHistory: normalizePasswordHistory(entry.passwordHistory),
  });
}

export async function decryptVaultEntry(key: CryptoKey, blob: VaultBlob): Promise<VaultEntry> {
  const raw = await decryptVaultPayload<Partial<VaultEntry>>(key, blob);
  return {
    ...emptyVaultEntry(),
    title: typeof raw.title === "string" ? raw.title : "",
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : "",
    url: typeof raw.url === "string" ? raw.url : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    otpSecret: typeof raw.otpSecret === "string" ? raw.otpSecret : "",
    favorite: Boolean(raw.favorite),
    folder: typeof raw.folder === "string" ? normalizeVaultFolder(raw.folder) : "",
    tags: normalizeVaultTags(Array.isArray(raw.tags) ? raw.tags : []),
    kind: normalizeVaultKind(raw.kind),
    fields: normalizeVaultFields(raw.fields),
    passwordChangedAt: typeof raw.passwordChangedAt === "string" ? raw.passwordChangedAt : "",
    passwordHistory: normalizePasswordHistory(raw.passwordHistory),
  };
}

export function normalizePasswordHistory(raw: unknown): VaultPasswordHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VaultPasswordHistoryItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const password = typeof item.password === "string" ? item.password.slice(0, 256) : "";
    if (!password) continue;
    const changedAt = typeof item.changedAt === "string" ? item.changedAt.slice(0, 40) : "";
    out.push({ password, changedAt });
    if (out.length >= VAULT_HISTORY_MAX) break;
  }
  return out;
}

/** Keep previous passwords inside the ciphertext when the current one changes. */
export function withPasswordHistory(prev: VaultEntry | null | undefined, next: VaultEntry, now = new Date().toISOString()): VaultEntry {
  if (!prev) {
    return {
      ...next,
      passwordChangedAt: next.password ? (next.passwordChangedAt || now) : "",
      passwordHistory: normalizePasswordHistory(next.passwordHistory),
    };
  }
  if (prev.password === next.password) {
    return {
      ...next,
      passwordChangedAt: prev.passwordChangedAt || next.passwordChangedAt || (next.password ? now : ""),
      passwordHistory: normalizePasswordHistory(prev.passwordHistory.length ? prev.passwordHistory : next.passwordHistory),
    };
  }
  const history = normalizePasswordHistory(prev.passwordHistory);
  if (prev.password) {
    history.unshift({ password: prev.password.slice(0, 256), changedAt: prev.passwordChangedAt || now });
  }
  return {
    ...next,
    passwordChangedAt: next.password ? now : "",
    passwordHistory: history.slice(0, VAULT_HISTORY_MAX),
  };
}

export function normalizeVaultFolder(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function normalizeVaultTags(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,;]/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tag = part.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

export function normalizeVaultKind(raw: unknown): VaultEntryKind {
  return typeof raw === "string" && (VAULT_KINDS as readonly string[]).includes(raw) ? raw as VaultEntryKind : "login";
}

export function normalizeVaultFields(raw: unknown): VaultField[] {
  if (!Array.isArray(raw)) return [];
  const out: VaultField[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const value = typeof item.value === "string" ? item.value.slice(0, 500) : "";
    out.push({ label, value, hidden: Boolean(item.hidden) });
    if (out.length >= VAULT_FIELDS_MAX) break;
  }
  return out;
}

export function vaultFieldValue(entry: Pick<VaultEntry, "fields">, label: string): string {
  const key = label.toLowerCase();
  return entry.fields.find((f) => f.label.toLowerCase() === key)?.value ?? "";
}

export function setVaultField(entry: VaultEntry, label: string, value: string, hidden = false): VaultEntry {
  const fields = [...entry.fields];
  const key = label.toLowerCase();
  const idx = fields.findIndex((f) => f.label.toLowerCase() === key);
  const next: VaultField = { label, value: value.slice(0, 500), hidden };
  if (idx >= 0) fields[idx] = next;
  else if (fields.length < VAULT_FIELDS_MAX) fields.push(next);
  return { ...entry, fields: normalizeVaultFields(fields) };
}

export function removeVaultField(entry: VaultEntry, label: string): VaultEntry {
  const key = label.toLowerCase();
  return { ...entry, fields: entry.fields.filter((f) => f.label.toLowerCase() !== key) };
}

export function vaultPasswordError(pw: string): string | null {
  if (!pw || pw.length < 10) return "La contraseña del Cofre debe tener al menos 10 caracteres.";
  if (!/[A-Z]/.test(pw)) return "Incluye al menos una letra mayúscula.";
  if (!/[a-z]/.test(pw)) return "Incluye al menos una letra minúscula.";
  if (!/[0-9]/.test(pw)) return "Incluye al menos un número.";
  return null;
}

export type PasswordGenOpts = {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
};

export function generatePassword(opts: PasswordGenOpts): string {
  const length = Math.min(64, Math.max(10, Math.round(opts.length)));
  const pools: string[] = [];
  if (opts.upper) pools.push("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  if (opts.lower) pools.push("abcdefghijklmnopqrstuvwxyz");
  if (opts.digits) pools.push("0123456789");
  if (opts.symbols) pools.push(SYMBOLS);
  if (!pools.length) throw new Error("Elige al menos un tipo de carácter.");
  const all = pools.join("");
  const out: string[] = pools.map((pool) => pool[randIndex(pool.length)]!);
  while (out.length < length) out.push(all[randIndex(all.length)]!);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join("");
}

const PASSPHRASE_WORDS = [
  "abeja", "aceite", "arena", "arroz", "barco", "bosque", "brazo", "cabra", "cacao", "cactus",
  "cafe", "calor", "campo", "canoa", "carta", "casco", "cedro", "cerca", "cielo", "circo",
  "clavo", "coche", "coral", "costa", "cuero", "danza", "delta", "diente", "drama", "duende",
  "faro", "fiesta", "foca", "fuego", "gallo", "gema", "globo", "grano", "guante", "huerto",
  "humo", "isla", "jardin", "juez", "lago", "lampara", "lente", "libro", "limon", "llave",
  "lobo", "luna", "madre", "mango", "mapa", "marco", "marea", "mesa", "metal", "molino",
  "monte", "nube", "nuez", "oasis", "ola", "oro", "padre", "pajaro", "papel", "pared",
  "pasta", "patio", "perla", "piano", "pino", "playa", "pluma", "pozo", "puente", "queso",
  "rama", "raton", "reloj", "rio", "roca", "rueda", "silla", "sobre", "sol", "sombra",
  "sopa", "taza", "techo", "tela", "tierra", "tigre", "tomate", "torre", "trigo", "tunel",
  "uva", "vaca", "valle", "vapor", "vela", "verano", "vidrio", "viento", "vino", "vista",
  "yate", "yema", "yogur", "zona", "zorro", "ancla", "brisa", "cueva", "duna", "esfera",
  "flauta", "gema", "huracan", "imán", "jade", "kiwi",
];

export function generatePassphrase(words = 5, extraDigit = true): string {
  const n = Math.min(8, Math.max(4, Math.round(words)));
  const picked: string[] = [];
  for (let i = 0; i < n; i++) picked.push(PASSPHRASE_WORDS[randIndex(PASSPHRASE_WORDS.length)]!);
  let phrase = picked.join("-");
  if (extraDigit) phrase += randIndex(10);
  return phrase;
}

function randIndex(max: number): number {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= limit);
  return n % max;
}

export function parseVaultBackup(text: string): VaultBackup {
  let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch {
    throw new Error("El archivo no es un JSON válido.");
  }
  if (!data || typeof data !== "object") throw new Error("Copia del Cofre no válida.");
  const raw = data as Record<string, unknown>;
  if (raw.kind !== "kalendiario-cofre") throw new Error("Este archivo no es una copia del Cofre de Kalendiario.");
  if (raw.version !== 1) throw new Error("Versión de copia no admitida.");
  if (raw.kdf !== "pbkdf2-sha256") throw new Error("KDF no admitido.");
  const salt = asB64(raw.salt, "salt");
  const checkNonce = asB64(raw.checkNonce, "checkNonce");
  const checkCipher = asB64(raw.checkCipher, "checkCipher");
  const kdfIterations = typeof raw.kdfIterations === "number" ? raw.kdfIterations : Number(raw.kdfIterations);
  if (!Number.isInteger(kdfIterations) || kdfIterations < 210_000 || kdfIterations > 1_000_000) {
    throw new Error("Iteraciones KDF no válidas.");
  }
  if (!Array.isArray(raw.items) || raw.items.length > 500) throw new Error("La copia tiene demasiadas entradas.");
  const items: VaultBackup["items"] = [];
  for (const row of raw.items) {
    if (!row || typeof row !== "object") throw new Error("Entrada de la copia no válida.");
    const item = row as Record<string, unknown>;
    items.push({
      nonce: asB64(item.nonce, "nonce"),
      ciphertext: asB64(item.ciphertext, "ciphertext"),
      version: typeof item.version === "number" ? item.version : 1,
    });
  }
  return {
    version: 1,
    kind: "kalendiario-cofre",
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
    kdf: "pbkdf2-sha256",
    kdfIterations,
    salt,
    checkNonce,
    checkCipher,
    items,
  };
}

function asB64(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Campo ${field} de la copia no válido.`);
  }
  return value;
}
