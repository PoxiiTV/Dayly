import type { VaultEntry } from "./vaultCrypto";

export const VAULT_OLD_MS = 365 * 24 * 60 * 60 * 1000;

export type VaultHealthKind = "weak" | "reused" | "old";

export type VaultHealthItem = {
  id: string;
  createdAt: string;
  entry: Pick<VaultEntry, "password" | "passwordChangedAt">;
};

export type VaultHealth = {
  weakIds: string[];
  reusedIds: string[];
  oldIds: string[];
  weak: number;
  reused: number;
  old: number;
};

const COMMON = new Set([
  "password", "password1", "passw0rd", "123456", "12345678", "1234567890", "111111",
  "qwerty", "qwerty123", "abc123", "admin", "letmein", "welcome", "monkey", "dragon",
  "master", "login", "secret", "iloveyou", "contraseña", "contrasena", "kalendiario",
  "dayly", "asdfgh", "000000", "123123", "password123",
]);

function onlyClass(pw: string): boolean {
  return /^[A-Za-z]+$/.test(pw) || /^[0-9]+$/.test(pw) || /^[^A-Za-z0-9]+$/.test(pw);
}

function isSequence(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (/^(.)\1{3,}$/.test(lower)) return true;
  const rows = ["01234567890", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (const row of rows) {
    if (row.includes(lower) || [...row].reverse().join("").includes(lower)) return true;
  }
  return false;
}

export function isWeakPassword(password: string): boolean {
  const pw = password.trim();
  if (!pw) return false;
  if (pw.length < 10) return true;
  if (COMMON.has(pw.toLowerCase())) return true;
  if (onlyClass(pw)) return true;
  if (isSequence(pw)) return true;
  return false;
}

export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  const pw = password.trim();
  if (!pw) return 0;
  if (isWeakPassword(pw) || pw.length < 10) return 1;
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (pw.length >= 20 && classes >= 3) return 4;
  if (pw.length >= 16 && classes >= 3) return 3;
  if (pw.includes("-") && pw.split("-").length >= 4) return 4;
  if (classes >= 3 && pw.length >= 12) return 3;
  return 2;
}

export function passwordScoreLabel(score: 0 | 1 | 2 | 3 | 4): string {
  return ["", "Débil", "Aceptable", "Buena", "Fuerte"][score]!;
}

function changedAtMs(item: VaultHealthItem): number | null {
  const iso = item.entry.passwordChangedAt?.trim() || item.createdAt;
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function assessVaultHealth(items: VaultHealthItem[], now = Date.now()): VaultHealth {
  const withPw = items.filter((it) => it.entry.password);
  const byPw = new Map<string, string[]>();
  for (const it of withPw) {
    const list = byPw.get(it.entry.password) ?? [];
    list.push(it.id);
    byPw.set(it.entry.password, list);
  }
  const reused = new Set<string>();
  for (const ids of byPw.values()) {
    if (ids.length > 1) for (const id of ids) reused.add(id);
  }
  const weakIds = withPw.filter((it) => isWeakPassword(it.entry.password)).map((it) => it.id);
  const reusedIds = withPw.filter((it) => reused.has(it.id)).map((it) => it.id);
  const oldIds = withPw.filter((it) => {
    const t = changedAtMs(it);
    return t != null && now - t >= VAULT_OLD_MS;
  }).map((it) => it.id);
  return {
    weakIds,
    reusedIds,
    oldIds,
    weak: weakIds.length,
    reused: reusedIds.length,
    old: oldIds.length,
  };
}

export function healthKindsFor(id: string, health: VaultHealth): VaultHealthKind[] {
  const kinds: VaultHealthKind[] = [];
  if (health.weakIds.includes(id)) kinds.push("weak");
  if (health.reusedIds.includes(id)) kinds.push("reused");
  if (health.oldIds.includes(id)) kinds.push("old");
  return kinds;
}
