import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { http } from "./api";
import {
  decryptVaultEntry,
  decryptVaultPayload,
  deriveVaultKey,
  emptyVaultEntry,
  encryptVaultEntry,
  encryptVaultPayload,
  parseVaultBackup,
  randomSalt,
  VAULT_CHECK,
  VAULT_ITERATIONS,
  VAULT_KDF,
  vaultPasswordError,
  withPasswordHistory,
  type VaultBackup,
  type VaultBlob,
  type VaultEntry,
} from "./vaultCrypto";

export type VaultLockAfter = "off" | "60" | "240";
const LOCK_AFTER_KEY = "dayly.vault.lockAfter";

export function loadVaultLockAfter(): VaultLockAfter {
  try {
    const v = localStorage.getItem(LOCK_AFTER_KEY);
    if (v === "off" || v === "60" || v === "240") return v;
  } catch { /* private mode */ }
  return "off";
}

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  twoFactorEnabled: boolean;
  emailOtpRequired: boolean;
  kdf?: string;
  kdfIterations?: number;
  salt?: string;
  checkNonce?: string;
  checkCipher?: string;
};

export type VaultItemView = {
  id: string;
  createdAt: string;
  updatedAt: string;
  entry: VaultEntry;
};

type KdfPayload = {
  kdf: string;
  kdfIterations: number;
  salt: string;
  checkNonce: string;
  checkCipher: string;
  needsEmailOtp?: boolean;
};

function kdfFromStatus(status: VaultStatus): KdfPayload | null {
  if (!status.unlocked || !status.salt || !status.checkNonce || !status.checkCipher) return null;
  return {
    kdf: status.kdf || VAULT_KDF,
    kdfIterations: status.kdfIterations || VAULT_ITERATIONS,
    salt: status.salt,
    checkNonce: status.checkNonce,
    checkCipher: status.checkCipher,
  };
}

type Ctx = {
  status: VaultStatus | null;
  items: VaultItemView[];
  loading: boolean;
  unlocked: boolean;
  totpAccepted: boolean;
  emailOtpPending: boolean;
  kdfReady: boolean;
  sessionActive: boolean;
  lockAfter: VaultLockAfter;
  setLockAfter: (value: VaultLockAfter) => void;
  refreshStatus: () => Promise<VaultStatus>;
  setup: (twoFactorCode: string, password: string) => Promise<void>;
  beginUnlock: (twoFactorCode: string) => Promise<{ needsEmailOtp: boolean }>;
  confirmEmail: (emailCode: string) => Promise<void>;
  finishUnlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  lockHard: () => Promise<void>;
  saveItem: (entry: VaultEntry, id?: string) => Promise<void>;
  importEntries: (entries: VaultEntry[]) => Promise<{ imported: number; skipped: number }>;
  removeItem: (id: string) => Promise<void>;
  removeItems: (ids: string[]) => Promise<number>;
  changePassword: (current: string, next: string, twoFactorCode: string) => Promise<void>;
  exportBackup: () => Promise<VaultBackup>;
  importBackup: (twoFactorCode: string, password: string, text: string) => Promise<void>;
  touch: () => void;
};

const VaultCtx = createContext<Ctx | null>(null);

const emptyBroken: VaultEntry = { ...emptyVaultEntry(), title: "(no se pudo descifrar)" };

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [totpAccepted, setTotpAccepted] = useState(false);
  const [emailOtpPending, setEmailOtpPending] = useState(false);
  const [kdfReady, setKdfReady] = useState(false);
  const [lockAfter, setLockAfterState] = useState<VaultLockAfter>(() => loadVaultLockAfter());
  const keyRef = useRef<CryptoKey | null>(null);
  const kdfRef = useRef<KdfPayload | null>(null);
  const idleAt = useRef(Date.now());
  const lockAfterRef = useRef(lockAfter);

  const sessionActive = Boolean(status?.unlocked);

  const clearLocal = useCallback((opts?: { keepKdf?: boolean }) => {
    keyRef.current = null;
    setUnlocked(false);
    setEmailOtpPending(false);
    setItems([]);
    if (opts?.keepKdf && kdfRef.current) {
      setKdfReady(true);
      setTotpAccepted(true);
      return;
    }
    kdfRef.current = null;
    setTotpAccepted(false);
    setKdfReady(false);
  }, []);

  const adoptKdf = (kdf: KdfPayload) => {
    kdfRef.current = kdf;
    setKdfReady(true);
    setEmailOtpPending(false);
    setTotpAccepted(true);
  };

  const refreshStatus = useCallback(async () => {
    const next = await http.get<VaultStatus>("/api/vault");
    setStatus(next);
    if (!next.unlocked && keyRef.current) clearLocal();
    if (next.unlocked && !keyRef.current) {
      const kdf = kdfFromStatus(next);
      if (kdf && !kdfRef.current) adoptKdf(kdf);
    }
    setLoading(false);
    return next;
  }, [clearLocal]);

  useEffect(() => {
    void refreshStatus().catch(() => setLoading(false));
  }, [refreshStatus]);

  const lock = useCallback(async () => {
    clearLocal({ keepKdf: true });
    if (!kdfRef.current) {
      try {
        const next = await http.get<VaultStatus>("/api/vault");
        setStatus(next);
        const kdf = kdfFromStatus(next);
        if (kdf) adoptKdf(kdf);
      } catch { /* still locked locally */ }
    }
  }, [clearLocal]);

  const lockHard = useCallback(async () => {
    try { await http.post("/api/vault/lock"); } catch { /* still lock locally */ }
    clearLocal();
    setStatus((current) => current ? { ...current, unlocked: false, salt: undefined, checkNonce: undefined, checkCipher: undefined } : current);
  }, [clearLocal]);

  const touch = useCallback(() => { idleAt.current = Date.now(); }, []);

  const setLockAfter = useCallback((value: VaultLockAfter) => {
    try { localStorage.setItem(LOCK_AFTER_KEY, value); } catch { /* ignore */ }
    setLockAfterState(value);
    lockAfterRef.current = value;
    touch();
  }, [touch]);

  useEffect(() => { lockAfterRef.current = lockAfter; }, [lockAfter]);

  useEffect(() => {
    const onMove = () => { idleAt.current = Date.now(); };
    window.addEventListener("pointerdown", onMove);
    window.addEventListener("keydown", onMove);
    const tick = window.setInterval(() => {
      if (!keyRef.current) return;
      const after = lockAfterRef.current;
      if (after === "off") return;
      const ms = Number(after) * 60 * 1000;
      if (Date.now() - idleAt.current >= ms) void lock();
    }, 15_000);
    return () => {
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("keydown", onMove);
      window.clearInterval(tick);
    };
  }, [lock]);

  const loadItems = async (key: CryptoKey) => {
    const data = await http.get<{ items: Array<{ id: string; nonce: string; ciphertext: string; createdAt: string; updatedAt: string }> }>("/api/vault/items");
    const next: VaultItemView[] = [];
    for (const row of data.items) {
      try {
        const entry = await decryptVaultEntry(key, { nonce: row.nonce, ciphertext: row.ciphertext });
        next.push({ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, entry });
      } catch {
        next.push({ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, entry: { ...emptyBroken } });
      }
    }
    next.sort((a, b) => {
      if (a.entry.favorite !== b.entry.favorite) return a.entry.favorite ? -1 : 1;
      const folder = a.entry.folder.localeCompare(b.entry.folder, "es");
      if (folder) return folder;
      return a.entry.title.localeCompare(b.entry.title, "es");
    });
    setItems(next);
  };

  const setup = async (twoFactorCode: string, password: string) => {
    const err = vaultPasswordError(password);
    if (err) throw new Error(err);
    const salt = randomSalt();
    const key = await deriveVaultKey(password, salt, VAULT_ITERATIONS);
    const check = await encryptVaultPayload(key, VAULT_CHECK);
    const created = await http.post<KdfPayload>("/api/vault/setup", {
      twoFactorCode,
      kdf: VAULT_KDF,
      kdfIterations: VAULT_ITERATIONS,
      salt,
      checkNonce: check.nonce,
      checkCipher: check.ciphertext,
    });
    keyRef.current = key;
    kdfRef.current = {
      kdf: created.kdf || VAULT_KDF,
      kdfIterations: created.kdfIterations || VAULT_ITERATIONS,
      salt: created.salt || salt,
      checkNonce: created.checkNonce || check.nonce,
      checkCipher: created.checkCipher || check.ciphertext,
    };
    setUnlocked(true);
    setItems([]);
    await refreshStatus();
    touch();
  };

  const beginUnlock = async (twoFactorCode: string) => {
    const kdf = await http.post<KdfPayload>("/api/vault/unlock", { twoFactorCode });
    setTotpAccepted(true);
    if (kdf.needsEmailOtp) {
      setEmailOtpPending(true);
      return { needsEmailOtp: true };
    }
    adoptKdf(kdf);
    return { needsEmailOtp: false };
  };

  const confirmEmail = async (emailCode: string) => {
    const kdf = await http.post<KdfPayload>("/api/vault/unlock/email", { emailCode });
    adoptKdf(kdf);
  };

  const finishUnlock = async (password: string) => {
    const kdf = kdfRef.current;
    if (!kdf) throw new Error("Verifica primero los códigos de acceso.");
    const key = await deriveVaultKey(password, kdf.salt, kdf.kdfIterations);
    try {
      const check = await decryptVaultPayload<{ ok?: boolean }>(key, { nonce: kdf.checkNonce, ciphertext: kdf.checkCipher });
      if (!check.ok) throw new Error("fail");
    } catch {
      throw new Error("La contraseña del Cofre no es correcta.");
    }
    setKdfReady(false);
    setTotpAccepted(false);
    keyRef.current = key;
    setUnlocked(true);
    await loadItems(key);
    await refreshStatus();
    touch();
  };

  const saveItem = async (entry: VaultEntry, id?: string) => {
    const key = keyRef.current;
    if (!key) throw new Error("El Cofre está cerrado.");
    const prev = id ? items.find((row) => row.id === id)?.entry : undefined;
    const toStore = withPasswordHistory(prev, entry);
    const blob: VaultBlob = await encryptVaultEntry(key, toStore);
    if (id) await http.patch(`/api/vault/items/${id}`, { ...blob, version: 1 });
    else await http.post("/api/vault/items", { ...blob, version: 1 });
    await loadItems(key);
    touch();
  };

  const importEntries = async (entries: VaultEntry[]) => {
    const key = keyRef.current;
    if (!key) throw new Error("El Cofre está cerrado.");
    if (!entries.length) throw new Error("No hay entradas que importar.");
    const remaining = 500 - items.length;
    if (remaining <= 0) throw new Error("El Cofre ya tiene 500 entradas.");
    const seen = new Set(items.map((row) => `${row.entry.title}\0${row.entry.username}\0${row.entry.url}`));
    const blobs: Array<VaultBlob & { version: number }> = [];
    let skipped = 0;
    for (const raw of entries) {
      if (blobs.length >= remaining) { skipped++; continue; }
      const entry = withPasswordHistory(null, raw);
      if (!entry.title.trim()) { skipped++; continue; }
      const dup = `${entry.title}\0${entry.username}\0${entry.url}`;
      if (seen.has(dup)) { skipped++; continue; }
      seen.add(dup);
      blobs.push({ ...await encryptVaultEntry(key, entry), version: 1 });
      if (blobs.length % 25 === 0) touch();
    }
    if (!blobs.length) return { imported: 0, skipped };
    const result = await http.post<{ imported: number; skipped?: number }>("/api/vault/items/import", { items: blobs });
    await loadItems(key);
    touch();
    return { imported: result.imported, skipped: skipped + (result.skipped ?? 0) };
  };

  const removeItems = async (ids: string[]) => {
    const key = keyRef.current;
    if (!key) throw new Error("El Cofre está cerrado.");
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return 0;
    const result = await http.post<{ deleted: number }>("/api/vault/items/delete", { ids: unique });
    await loadItems(key);
    touch();
    return result.deleted;
  };

  const removeItem = async (id: string) => {
    await removeItems([id]);
  };

  const changePassword = async (current: string, next: string, twoFactorCode: string) => {
    const key = keyRef.current;
    const kdf = kdfRef.current;
    if (!key || !kdf) throw new Error("Abre el Cofre para cambiar la contraseña.");
    const err = vaultPasswordError(next);
    if (err) throw new Error(err);
    if (current === next) throw new Error("La nueva contraseña debe ser distinta.");
    try {
      const check = await decryptVaultPayload<{ ok?: boolean }>(key, { nonce: kdf.checkNonce, ciphertext: kdf.checkCipher });
      if (!check.ok) throw new Error("fail");
    } catch {
      throw new Error("La contraseña actual del Cofre no es correcta.");
    }
    const salt = randomSalt();
    const nextKey = await deriveVaultKey(next, salt, VAULT_ITERATIONS);
    const nextCheck = await encryptVaultPayload(nextKey, VAULT_CHECK);
    const items: Array<VaultBlob & { id: string; version?: number }> = [];
    for (const row of (await http.get<{ items: Array<{ id: string; nonce: string; ciphertext: string }> }>("/api/vault/items")).items) {
      const entry = await decryptVaultEntry(key, { nonce: row.nonce, ciphertext: row.ciphertext });
      const blob = await encryptVaultEntry(nextKey, entry);
      items.push({ id: row.id, ...blob, version: 1 });
    }
    const updated = await http.post<KdfPayload>("/api/vault/rekey", {
      twoFactorCode,
      kdf: VAULT_KDF,
      kdfIterations: VAULT_ITERATIONS,
      salt,
      checkNonce: nextCheck.nonce,
      checkCipher: nextCheck.ciphertext,
      items,
    });
    keyRef.current = nextKey;
    kdfRef.current = {
      kdf: updated.kdf || VAULT_KDF,
      kdfIterations: updated.kdfIterations || VAULT_ITERATIONS,
      salt: updated.salt || salt,
      checkNonce: updated.checkNonce || nextCheck.nonce,
      checkCipher: updated.checkCipher || nextCheck.ciphertext,
    };
    await loadItems(nextKey);
    await refreshStatus();
    touch();
  };

  const exportBackup = async () => {
    const data = await http.get<VaultBackup>("/api/vault/backup");
    touch();
    return data;
  };

  const importBackup = async (twoFactorCode: string, password: string, text: string) => {
    const backup = parseVaultBackup(text);
    const err = vaultPasswordError(password);
    if (err) throw new Error(err);
    const key = await deriveVaultKey(password, backup.salt, backup.kdfIterations);
    try {
      const check = await decryptVaultPayload<{ ok?: boolean }>(key, { nonce: backup.checkNonce, ciphertext: backup.checkCipher });
      if (!check.ok) throw new Error("fail");
    } catch {
      throw new Error("La contraseña no abre esta copia. Comprueba que es la del Cofre original.");
    }
    const imported = await http.post<KdfPayload>("/api/vault/import", {
      twoFactorCode,
      kdf: backup.kdf,
      kdfIterations: backup.kdfIterations,
      salt: backup.salt,
      checkNonce: backup.checkNonce,
      checkCipher: backup.checkCipher,
      items: backup.items,
    });
    keyRef.current = key;
    kdfRef.current = {
      kdf: imported.kdf || backup.kdf,
      kdfIterations: imported.kdfIterations || backup.kdfIterations,
      salt: imported.salt || backup.salt,
      checkNonce: imported.checkNonce || backup.checkNonce,
      checkCipher: imported.checkCipher || backup.checkCipher,
    };
    setUnlocked(true);
    await loadItems(key);
    await refreshStatus();
    touch();
  };

  return (
    <VaultCtx.Provider value={{
      status, items, loading, unlocked, totpAccepted, emailOtpPending, kdfReady, sessionActive,
      lockAfter, setLockAfter,
      refreshStatus, setup, beginUnlock, confirmEmail, finishUnlock, lock, lockHard, saveItem, importEntries, removeItem, removeItems, changePassword,
      exportBackup, importBackup, touch,
    }}>
      {children}
    </VaultCtx.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultCtx);
  if (!ctx) throw new Error("useVault");
  return ctx;
}
