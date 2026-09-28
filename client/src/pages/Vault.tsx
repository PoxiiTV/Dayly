import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  KeyRound, Lock, Unlock, Plus, Search, Copy, Check, Trash2, Pencil, ShieldCheck, Globe, Eye, EyeOff,
  Download, Upload, RefreshCw, Timer, Star, LogIn, Folder, Tag, HeartPulse, History, AlertTriangle,
  StickyNote, Wifi, CreditCard, ChevronLeft, ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useVault, type VaultLockAfter } from "@/lib/vault";
import { emptyVaultEntry, generatePassword, generatePassphrase, vaultPasswordError, normalizeVaultFolder, normalizeVaultTags, setVaultField, removeVaultField, vaultFieldValue, type VaultEntry, type VaultEntryKind } from "@/lib/vaultCrypto";
import { assessVaultHealth, healthKindsFor, passwordScore, passwordScoreLabel, type VaultHealthKind } from "@/lib/vaultHealth";
import { parseVaultImport } from "@/lib/vaultImport";
import { checkPwnedPassword } from "@/lib/vaultPwned";
import { normalizeTotpSecret, totpCode, totpSecretError } from "@/lib/totp";
import { Button, Input, Textarea, Spinner, EmptyState, Modal, useToast, PageHeader, ConfirmDialog, Checkbox, Segmented } from "@/components/ui";

const CLIP_MS = 20_000;
const PAGE_SIZES = [10, 25, 50] as const;
type VaultPageSize = (typeof PAGE_SIZES)[number];
const PAGE_SIZE_KEY = "kalendiario.vault.pageSize";
const emptyEntry = (): VaultEntry => emptyVaultEntry();

function loadPageSize(): VaultPageSize {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (n === 10 || n === 25 || n === 50) return n;
  } catch { /* private mode */ }
  return 25;
}

const KIND_LABEL: Record<VaultEntryKind, string> = { login: "Acceso", note: "Nota", wifi: "Wi‑Fi", card: "Tarjeta" };

function lockLead(count: number, lockAfter: VaultLockAfter): string {
  const n = `${count} ${count === 1 ? "entrada" : "entradas"}`;
  if (lockAfter === "off") return `${n} · abierto hasta que salgas o bloquees`;
  if (lockAfter === "60") return `${n} · se bloquea a la 1 h de inactividad (solo la contraseña)`;
  return `${n} · se bloquea a las 4 h de inactividad (solo la contraseña)`;
}

export function Vault() {
  const {
    status, items, loading, unlocked, totpAccepted, emailOtpPending, kdfReady, sessionActive,
    lockAfter, setLockAfter,
    setup, beginUnlock, confirmEmail, finishUnlock, lock, lockHard, saveItem, importEntries, removeItem, removeItems, changePassword,
    exportBackup, importBackup, touch, refreshStatus,
  } = useVault();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [editor, setEditor] = useState<VaultEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [destroyCode, setDestroyCode] = useState("");
  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [rekeyCurrent, setRekeyCurrent] = useState("");
  const [rekeyNext, setRekeyNext] = useState("");
  const [rekeyNext2, setRekeyNext2] = useState("");
  const [rekeyCode, setRekeyCode] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [healthFilter, setHealthFilter] = useState<VaultHealthKind | "">("");
  const [kindFilter, setKindFilter] = useState<VaultEntryKind | "">("");
  const [copied, setCopied] = useState<string | null>(null);
  const clipTimer = useRef<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const plaintextImportRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<{ count: number; source: string; skipped: number; entries: VaultEntry[] } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<VaultPageSize>(loadPageSize);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState<"selected" | "all" | null>(null);

  useEffect(() => {
    touch();
    return () => {
      if (clipTimer.current) window.clearTimeout(clipTimer.current);
    };
  }, [touch]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const folder = it.entry.folder.trim();
      if (folder) set.add(folder);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [items]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const tag of it.entry.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [items]);

  const kindsPresent = useMemo(() => {
    const set = new Set<VaultEntryKind>();
    for (const it of items) set.add(it.entry.kind);
    return set;
  }, [items]);

  const health = useMemo(() => assessVaultHealth(items), [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      const e = it.entry;
      if (folderFilter === "none" && e.folder) return false;
      if (folderFilter !== "all" && folderFilter !== "none" && e.folder !== folderFilter) return false;
      if (tagFilter && !e.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) return false;
      if (healthFilter && !healthKindsFor(it.id, health).includes(healthFilter)) return false;
      if (kindFilter && e.kind !== kindFilter) return false;
      if (!needle) return true;
      const fieldText = e.fields.map((f) => f.label).join(" ");
      return [e.title, e.username, e.url, e.notes, e.folder, fieldText, KIND_LABEL[e.kind], ...e.tags].some((v) => v.toLowerCase().includes(needle));
    });
  }, [items, q, folderFilter, tagFilter, healthFilter, health, kindFilter]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [q, folderFilter, tagFilter, healthFilter, kindFilter, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(filtered.length / pageSize) || 1)));
  }, [filtered.length, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageIds = pageItems.map((it) => it.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));

  const toggleSelected = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePageSelected = (on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const changePageSize = (size: VaultPageSize) => {
    setPageSize(size);
    try { localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* private mode */ }
  };

  const onBulkDelete = async () => {
    const ids = bulkTarget === "all" ? items.map((it) => it.id) : [...selected];
    setBulkTarget(null);
    if (!ids.length) return;
    setBusy(true);
    try {
      const deleted = await removeItems(ids);
      setSelected(new Set());
      push("success", deleted === 1 ? "Entrada eliminada." : `Eliminadas ${deleted} entradas.`);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo borrar.");
    } finally { setBusy(false); }
  };

  const copy = async (label: string, value: string, token: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(token);
      if (clipTimer.current) window.clearTimeout(clipTimer.current);
      clipTimer.current = window.setTimeout(() => {
        void navigator.clipboard.writeText("").catch(() => undefined);
        setCopied(null);
      }, CLIP_MS);
      const clipHint = " Se borra del portapapeles en 20 s.";
      const msg = label === "Contraseña" ? "Contraseña copiada." : label === "Acceso" ? "Usuario y contraseña copiados." : `${label} copiado.`;
      push("success", msg + clipHint);
    } catch {
      push("error", "No se pudo copiar.");
    }
  };

  const onSetup = async () => {
    const pwErr = vaultPasswordError(password);
    if (pwErr) { setError(pwErr); return; }
    if (password !== password2) { setError("Las contraseñas del Cofre no coinciden."); return; }
    setBusy(true); setError(null);
    try {
      await setup(code.trim(), password);
      setCode(""); setPassword(""); setPassword2("");
      push("success", "Cofre creado. Recuerda esta contraseña: no se puede recuperar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el Cofre.");
    } finally { setBusy(false); }
  };

  const onBeginUnlock = async () => {
    setBusy(true); setError(null);
    try {
      const r = await beginUnlock(code.trim());
      setCode("");
      setEmailCode("");
      if (r.needsEmailOtp) push("success", "Te hemos enviado un código al correo de la cuenta.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar el código.");
    } finally { setBusy(false); }
  };

  const onConfirmEmail = async () => {
    setBusy(true); setError(null);
    try {
      await confirmEmail(emailCode.trim());
      setEmailCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar el correo.");
    } finally { setBusy(false); }
  };

  const onFinishUnlock = async () => {
    setBusy(true); setError(null);
    try {
      await finishUnlock(password);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el Cofre.");
    } finally { setBusy(false); }
  };

  const onSave = async () => {
    if (!editor || !editor.title.trim()) { push("error", "Pon un título a la entrada."); return; }
    const otpErr = totpSecretError(editor.otpSecret);
    if (otpErr) { push("error", otpErr); return; }
    setBusy(true);
    try {
      await saveItem({
        ...editor,
        otpSecret: normalizeTotpSecret(editor.otpSecret),
        folder: normalizeVaultFolder(editor.folder),
        tags: normalizeVaultTags(tagDraft),
      }, editingId ?? undefined);
      setEditor(null); setEditingId(null);
      push("success", editingId ? "Entrada actualizada" : "Entrada guardada");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally { setBusy(false); }
  };

  const onDestroy = async () => {
    setBusy(true);
    try {
      await http.post("/api/vault/destroy", { twoFactorCode: destroyCode.trim() });
      await lockHard();
      await refreshStatus();
      setDestroyOpen(false); setDestroyCode("");
      push("success", "Cofre eliminado.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo borrar el Cofre.");
    } finally { setBusy(false); }
  };

  const onRekey = async () => {
    const pwErr = vaultPasswordError(rekeyNext);
    if (pwErr) { push("error", pwErr); return; }
    if (rekeyNext !== rekeyNext2) { push("error", "Las contraseñas nuevas no coinciden."); return; }
    if (rekeyCode.trim().length !== 6) { push("error", "Introduce el código de 6 dígitos de la app."); return; }
    setBusy(true);
    try {
      await changePassword(rekeyCurrent, rekeyNext, rekeyCode.trim());
      setRekeyOpen(false);
      setRekeyCurrent(""); setRekeyNext(""); setRekeyNext2(""); setRekeyCode("");
      push("success", "Contraseña del Cofre cambiada. Las copias anteriores usan la clave vieja.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar la contraseña.");
    } finally { setBusy(false); }
  };

  const onExport = async () => {
    setBusy(true);
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kalendiario-cofre-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      push("success", "Copia cifrada descargada. Guárdala fuera de este servidor.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo exportar.");
    } finally { setBusy(false); }
  };

  const onImportFile = async (file: File) => {
    const pwErr = vaultPasswordError(password);
    if (pwErr) { setError(pwErr); return; }
    if (code.trim().length !== 6) { setError("Introduce el código de 6 dígitos de la app."); return; }
    setBusy(true); setError(null);
    try {
      const text = await file.text();
      await importBackup(code.trim(), password, text);
      setCode(""); setPassword(""); setPassword2("");
      push("success", "Copia restaurada. El servidor sigue sin ver las claves.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar la copia.");
    } finally { setBusy(false); }
  };

  const onPlaintextImportFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseVaultImport(text);
      if (!parsed.entries.length) {
        push("error", parsed.skipped ? "El archivo no tenía inicios de sesión importables." : "No hay entradas que importar.");
        return;
      }
      setImportPreview({ count: parsed.entries.length, source: parsed.source, skipped: parsed.skipped, entries: parsed.entries });
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally { setBusy(false); }
  };

  const onConfirmImport = async () => {
    if (!importPreview) return;
    setBusy(true);
    try {
      const result = await importEntries(importPreview.entries);
      setImportPreview(null);
      const extra = result.skipped ? ` (${result.skipped} repetidas o sin título se omitieron)` : "";
      push("success", `Importadas ${result.imported} entradas desde ${importPreview.source}.${extra} El servidor solo recibió blobs cifrados.`);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo importar.");
    } finally { setBusy(false); }
  };

  if (loading || !status) {
    return <div className="page-shell grid place-items-center min-h-[40vh]"><Spinner size={28} className="text-accent" /></div>;
  }

  if (!status.twoFactorEnabled) {
    return (
      <div className="page-shell">
        <PageHeader title="Kontraseñas" />
        <div className="card p-6 max-w-lg">
          <EmptyState
            icon={<ShieldCheck className="w-6 h-6" />}
            title="Activa primero la verificación en dos pasos"
            hint="El Cofre exige Authy, Google Authenticator o Aegis. Sin ese segundo factor no se abre ni se crea."
            action={<Link to="/settings" className="btn-primary"><ShieldCheck className="w-4 h-4" />Ir a Ajustes</Link>}
          />
        </div>
      </div>
    );
  }

  if (!status.exists) {
    return (
      <div className="page-shell">
        <PageHeader title="Kontraseñas" lead="Contraseñas cifradas en tu navegador. El servidor no puede leerlas." />
        <div className="card p-5 max-w-lg space-y-4">
          <p className="text-sm text-muted">
            Esta contraseña es <strong className="text-text">distinta</strong> de la de tu cuenta. Si la olvidas, restaura una copia cifrada o borra el Cofre y empieza de cero.
          </p>
          <Input label="Código de 6 dígitos (Authy / Authenticator)" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
          <Input label="Contraseña del Cofre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Mín. 10, mayúscula, minúscula y número" />
          <Input label="Repite la contraseña del Cofre" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onSetup()} disabled={busy || code.trim().length !== 6}>{busy ? "Creando…" : "Crear Cofre"}</Button>
            <Button variant="secondary" onClick={() => importRef.current?.click()} disabled={busy || code.trim().length !== 6 || !password}>
              <Upload className="w-4 h-4" />Restaurar copia
            </Button>
          </div>
          <input ref={importRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onImportFile(f);
          }} />
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="page-shell">
        <PageHeader title="Kontraseñas" lead={
          kdfReady || sessionActive
            ? "Sesión activa en este dispositivo. Solo hace falta la contraseña del Cofre."
            : status.emailOtpRequired
              ? "Primera apertura en este dispositivo: app de autenticación, código del correo y contraseña del Cofre."
              : "Primera apertura en este dispositivo: código TOTP y contraseña del Cofre."
        } />
        <div className="card p-5 max-w-lg space-y-4">
          {emailOtpPending ? (
            <>
              <p className="text-sm text-ok">Código de la app verificado. Introduce el código que te hemos enviado al correo de la cuenta.{import.meta.env.VITE_APP_DEMO === "1" ? " En la demo es 654321." : ""}</p>
              <Input key="vault-unlock-email" label="Código del correo" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" onKeyDown={(e) => e.key === "Enter" && void onConfirmEmail()} />
            </>
          ) : kdfReady ? (
            <p className="text-sm text-ok">Códigos verificados. Introduce solo la contraseña del Cofre.</p>
          ) : totpAccepted && !emailOtpPending ? (
            <p className="text-sm text-ok">Código verificado. Introduce solo la contraseña del Cofre.</p>
          ) : (
            <Input key="vault-unlock-totp" label="Código de 6 dígitos (Authy / Authenticator)" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
          )}
          {kdfReady && (
            <>
              <Input key="vault-unlock-password" label="Contraseña del Cofre" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && void onFinishUnlock()} />
              <p className="text-xs text-faint -mt-2">Authy y el correo no se piden otra vez hasta que cierres el Cofre del todo o salgas de la cuenta.</p>
            </>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {emailOtpPending ? (
              <Button onClick={() => void onConfirmEmail()} disabled={busy || emailCode.trim().length !== 6}>
                <Unlock className="w-4 h-4" />{busy ? "Comprobando…" : "Confirmar correo"}
              </Button>
            ) : kdfReady ? (
              <Button onClick={() => void onFinishUnlock()} disabled={busy || !password}>
                <Unlock className="w-4 h-4" />{busy ? "Abriendo…" : "Abrir"}
              </Button>
            ) : (
              <Button onClick={() => void onBeginUnlock()} disabled={busy || code.trim().length !== 6}>
                <Unlock className="w-4 h-4" />{busy ? "Comprobando…" : "Continuar"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setDestroyOpen(true); setDestroyCode(""); }}>Borrar Cofre…</Button>
          </div>
        </div>
        <DestroyModal open={destroyOpen} code={destroyCode} setCode={setDestroyCode} busy={busy} onClose={() => setDestroyOpen(false)} onConfirm={() => void onDestroy()} />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Kontraseñas"
        lead={lockLead(items.length, lockAfter)}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-xs text-muted inline-flex items-center gap-2">
              Auto-cierre
              <select
                className="input h-9 py-0 text-xs w-[9.5rem]"
                value={lockAfter}
                onChange={(e) => setLockAfter(e.target.value as VaultLockAfter)}
                aria-label="Cuándo bloquear el Cofre"
              >
                <option value="off">Al salir de la cuenta</option>
                <option value="60">Tras 1 hora</option>
                <option value="240">Tras 4 horas</option>
              </select>
            </label>
            <Button size="sm" onClick={() => { setEditingId(null); setEditor(emptyEntry()); setTagDraft(""); }}><Plus className="w-4 h-4" />Nueva</Button>
            <Button size="sm" variant="secondary" onClick={() => { setRekeyOpen(true); setRekeyCurrent(""); setRekeyNext(""); setRekeyNext2(""); setRekeyCode(""); }}><KeyRound className="w-4 h-4" />Clave</Button>
            <Button size="sm" variant="secondary" onClick={() => void onExport()} disabled={busy}><Download className="w-4 h-4" />Copia</Button>
            <Button size="sm" variant="secondary" onClick={() => plaintextImportRef.current?.click()} disabled={busy}><Upload className="w-4 h-4" />Importar</Button>
            <Button size="sm" variant="secondary" onClick={() => void lock()}><Lock className="w-4 h-4" />Bloquear</Button>
          </div>
        }
      />
      <div className="relative mb-3">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar en este dispositivo…" className="pl-9" />
      </div>
      {(folders.length > 0 || tags.length > 0 || health.weak + health.reused + health.old > 0 || kindsPresent.size > 1 || kindFilter) && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <FilterChip active={folderFilter === "all" && !tagFilter && !healthFilter && !kindFilter} onClick={() => { setFolderFilter("all"); setTagFilter(""); setHealthFilter(""); setKindFilter(""); }}>Todas</FilterChip>
          {health.weak + health.reused + health.old > 0 && (
            <>
              {health.weak > 0 && (
                <FilterChip active={healthFilter === "weak"} onClick={() => setHealthFilter(healthFilter === "weak" ? "" : "weak")}>
                  <HeartPulse className="w-3 h-3" />Débiles {health.weak}
                </FilterChip>
              )}
              {health.reused > 0 && (
                <FilterChip active={healthFilter === "reused"} onClick={() => setHealthFilter(healthFilter === "reused" ? "" : "reused")}>
                  <AlertTriangle className="w-3 h-3" />Repetidas {health.reused}
                </FilterChip>
              )}
              {health.old > 0 && (
                <FilterChip active={healthFilter === "old"} onClick={() => setHealthFilter(healthFilter === "old" ? "" : "old")}>
                  <History className="w-3 h-3" />Antiguas {health.old}
                </FilterChip>
              )}
            </>
          )}
          {([...kindsPresent] as VaultEntryKind[]).filter((k) => k !== "login" || kindFilter === "login" || kindsPresent.size > 1).map((k) => (
            <FilterChip key={k} active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? "" : k)}>
              {KIND_LABEL[k]}
            </FilterChip>
          ))}
          {folders.length > 0 && <FilterChip active={folderFilter === "none"} onClick={() => setFolderFilter("none")}>Sin carpeta</FilterChip>}
          {folders.map((folder) => (
            <FilterChip key={folder} active={folderFilter === folder} onClick={() => setFolderFilter(folderFilter === folder ? "all" : folder)}>
              <Folder className="w-3 h-3" />{folder}
            </FilterChip>
          ))}
          {tags.map((tag) => (
            <FilterChip key={tag} active={tagFilter.toLowerCase() === tag.toLowerCase()} onClick={() => setTagFilter(tagFilter.toLowerCase() === tag.toLowerCase() ? "" : tag)}>
              <Tag className="w-3 h-3" />{tag}
            </FilterChip>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="w-6 h-6" />}
          title={items.length === 0 ? "El Cofre está vacío" : "Nada coincide"}
          hint={items.length === 0 ? "Accesos, Wi‑Fi, tarjetas o notas. Solo tu navegador puede leerlos." : "Prueba otro texto. La búsqueda no sale de este dispositivo."}
          action={items.length === 0 ? <Button onClick={() => { setEditingId(null); setEditor(emptyEntry()); setTagDraft(""); }}><Plus className="w-4 h-4" />Añadir entrada</Button> : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
            <Checkbox
              checked={allPageSelected}
              onChange={togglePageSelected}
              className="shrink-0"
              label={<span className="sr-only">Seleccionar esta página</span>}
            />
            {somePageSelected && !allPageSelected && (
              <span className="text-[11px] text-faint -ml-1">Algunas</span>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={busy || selected.size === 0}
              onClick={() => setBulkTarget("selected")}
            >
              <Trash2 className="w-3.5 h-3.5" />Eliminar {selected.size > 0 ? selected.size : ""}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || items.length === 0}
              onClick={() => setBulkTarget("all")}
            >
              Eliminar todas
            </Button>
            {filtered.length > pageIds.length && (
              <button
                type="button"
                className="text-xs text-accent-strong hover:underline"
                onClick={() => setSelected(new Set(filtered.map((it) => it.id)))}
              >
                Seleccionar las {filtered.length} de esta vista
              </button>
            )}
            <div className="flex-1" />
            <label className="text-xs text-muted inline-flex items-center gap-1.5">
              Por página
              <select
                className="input h-8 py-0 text-xs w-[4.5rem]"
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value) as VaultPageSize)}
                aria-label="Entradas por página"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="inline-flex items-center gap-1 text-xs text-muted">
              <button
                type="button"
                className="btn-ghost btn-icon-sm"
                disabled={safePage <= 1}
                aria-label="Página anterior"
                onClick={() => setPage(Math.max(1, safePage - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="min-w-[7.5rem] text-center tabular-nums">
                {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} de {filtered.length}
              </span>
              <button
                type="button"
                className="btn-ghost btn-icon-sm"
                disabled={safePage >= pageCount}
                aria-label="Página siguiente"
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {pageItems.map((it) => (
              <VaultRow
                key={it.id}
                entry={it.entry}
                kinds={healthKindsFor(it.id, health)}
                copied={copied}
                selected={selected.has(it.id)}
                onSelected={(on) => toggleSelected(it.id, on)}
                onCopy={copy}
                onFavorite={() => void saveItem({ ...it.entry, favorite: !it.entry.favorite }, it.id).catch((e) => push("error", e instanceof Error ? e.message : "No se pudo guardar."))}
                onTag={(tag) => setTagFilter(tag)}
                onFolder={(folder) => setFolderFilter(folder || "none")}
                onEdit={() => { setEditingId(it.id); setEditor({ ...emptyEntry(), ...it.entry }); setTagDraft(it.entry.tags.join(", ")); }}
                onDelete={() => void removeItem(it.id).then(() => { setSelected((prev) => { const next = new Set(prev); next.delete(it.id); return next; }); push("success", "Entrada eliminada"); }).catch((e) => push("error", e instanceof Error ? e.message : "No se pudo borrar."))}
              />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-faint mt-6">
        Kalen, la búsqueda global y la exportación de agenda no ven el Cofre. La copia del Cofre sigue cifrada. Importar CSV/JSON de Bitwarden o 1Password se cifra en este navegador.{" "}
        <button type="button" className="underline hover:text-text" onClick={() => { setRekeyOpen(true); setRekeyCurrent(""); setRekeyNext(""); setRekeyNext2(""); setRekeyCode(""); }}>Cambiar la contraseña del Cofre</button>
        {" · "}
        <button type="button" className="underline hover:text-text" onClick={() => void lockHard()}>Cerrar el Cofre del todo</button>
        {" · "}
        <button type="button" className="underline hover:text-danger" onClick={() => { setDestroyOpen(true); setDestroyCode(""); }}>Eliminar el Cofre por completo</button>
      </p>
      <Modal
        open={!!editor}
        onClose={() => { setEditor(null); setEditingId(null); }}
        title={editingId ? "Editar entrada" : "Nueva entrada"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEditor(null); setEditingId(null); }}>Cancelar</Button>
            <Button onClick={() => void onSave()} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </>
        }
      >
        {editor && (
          <div className="space-y-5">
            <Segmented
              className="flex-wrap w-full"
              value={editor.kind}
              onChange={(kind) => setEditor({ ...editor, kind })}
              options={[
                { value: "login", label: "Acceso" },
                { value: "note", label: "Nota" },
                { value: "wifi", label: "Wi‑Fi" },
                { value: "card", label: "Tarjeta" },
              ]}
            />
            <Input
              label={editor.kind === "wifi" ? "Red (SSID)" : "Título"}
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              autoFocus
              placeholder={editor.kind === "wifi" ? "MiFibra" : editor.kind === "card" ? "Visa, banco…" : "Banco, correo, Wi‑Fi…"}
            />
            {editor.kind === "login" && (
              <>
                <div className="modal-grid">
                  <Input label="Usuario o email" value={editor.username} onChange={(e) => setEditor({ ...editor, username: e.target.value })} autoComplete="off" />
                  <Input label="Contraseña" type="password" value={editor.password} onChange={(e) => setEditor({ ...editor, password: e.target.value })} autoComplete="off" />
                </div>
                <PasswordSafety password={editor.password} />
                <PasswordGenerator onFill={(pw) => setEditor({ ...editor, password: pw })} />
                <div className="modal-grid">
                  <Input label="URL" value={editor.url} onChange={(e) => setEditor({ ...editor, url: e.target.value })} placeholder="https://" />
                  <Input label="Clave TOTP (opcional)" value={editor.otpSecret} onChange={(e) => setEditor({ ...editor, otpSecret: e.target.value })} autoComplete="off" placeholder="Base32 o otpauth://…" />
                </div>
                <p className="text-xs text-faint -mt-3">La clave de Authy/Authenticator del sitio. Se cifra con la entrada; el servidor no la ve.</p>
              </>
            )}
            {editor.kind === "wifi" && (
              <>
                <Input label="Clave Wi‑Fi" type="password" value={editor.password} onChange={(e) => setEditor({ ...editor, password: e.target.value })} autoComplete="off" />
                <PasswordSafety password={editor.password} />
                <PasswordGenerator onFill={(pw) => setEditor({ ...editor, password: pw })} />
                <Input label="Seguridad" value={vaultFieldValue(editor, "Seguridad") || "WPA2"} onChange={(e) => setEditor(setVaultField(editor, "Seguridad", e.target.value))} placeholder="WPA2, WPA3…" autoComplete="off" />
              </>
            )}
            {editor.kind === "card" && (
              <>
                <Input label="Titular" value={editor.username} onChange={(e) => setEditor({ ...editor, username: e.target.value })} autoComplete="off" />
                <Input label="Número" type="password" value={vaultFieldValue(editor, "Número")} onChange={(e) => setEditor(setVaultField(editor, "Número", e.target.value, true))} autoComplete="off" inputMode="numeric" />
                <div className="modal-grid">
                  <Input label="Caducidad" value={vaultFieldValue(editor, "Caducidad")} onChange={(e) => setEditor(setVaultField(editor, "Caducidad", e.target.value))} placeholder="12/28" autoComplete="off" />
                  <Input label="CVV" type="password" value={vaultFieldValue(editor, "CVV")} onChange={(e) => setEditor(setVaultField(editor, "CVV", e.target.value, true))} autoComplete="off" inputMode="numeric" />
                </div>
              </>
            )}
            <div className="modal-grid">
              <Input label="Carpeta" value={editor.folder} onChange={(e) => setEditor({ ...editor, folder: e.target.value })} list="vault-folders" placeholder="Trabajo, Casa, Banco…" autoComplete="off" />
              <Input label="Etiquetas" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="wifi, personal…" autoComplete="off" />
            </div>
            <datalist id="vault-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
            <p className="text-xs text-faint -mt-3">Separadas por coma. Quedan cifradas con la entrada.</p>
            {editor.kind !== "note" && (
              <ExtraFields editor={editor} setEditor={setEditor} reserved={editor.kind === "card" ? ["Número", "Caducidad", "CVV", "Marca"] : editor.kind === "wifi" ? ["Seguridad"] : []} />
            )}
            <Checkbox label="Favorito (arriba de la lista)" checked={editor.favorite} onChange={(favorite) => setEditor({ ...editor, favorite })} />
            <Textarea label="Notas" value={editor.notes} onChange={(e) => setEditor({ ...editor, notes: e.target.value })} rows={editor.kind === "note" ? 8 : 3} />
            {editor.passwordHistory.length > 0 && editor.kind !== "card" && editor.kind !== "note" && (
              <div className="rounded-xl border border-border bg-bg p-3 space-y-2">
                <p className="text-xs font-medium text-muted inline-flex items-center gap-1"><History className="w-3.5 h-3.5" />Contraseñas anteriores</p>
                <ul className="space-y-1.5">
                  {editor.passwordHistory.map((row, i) => (
                    <li key={`${row.changedAt}-${i}`} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-text truncate flex-1">{row.password}</span>
                      {row.changedAt && <span className="text-[11px] text-faint shrink-0">{row.changedAt.slice(0, 10)}</span>}
                      <button type="button" className="text-[11px] text-accent-strong hover:underline shrink-0" onClick={() => setEditor({ ...editor, password: row.password })}>Usar</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
      <DestroyModal open={destroyOpen} code={destroyCode} setCode={setDestroyCode} busy={busy} onClose={() => setDestroyOpen(false)} onConfirm={() => void onDestroy()} />
      <ConfirmDialog
        open={bulkTarget !== null}
        onClose={() => setBulkTarget(null)}
        onConfirm={() => void onBulkDelete()}
        title={bulkTarget === "all" ? "Eliminar todas las claves" : "Eliminar seleccionadas"}
        message={
          bulkTarget === "all"
            ? `¿Borrar las ${items.length} entradas del Cofre? El Cofre sigue existiendo; solo se vacía. Esta acción no se puede deshacer.`
            : `¿Borrar ${selected.size} ${selected.size === 1 ? "entrada" : "entradas"} del Cofre? Esta acción no se puede deshacer.`
        }
        confirmLabel={bulkTarget === "all" ? "Vaciar el Cofre" : "Eliminar"}
        busy={busy}
      />
      <RekeyModal
        open={rekeyOpen}
        busy={busy}
        current={rekeyCurrent} setCurrent={setRekeyCurrent}
        next={rekeyNext} setNext={setRekeyNext}
        next2={rekeyNext2} setNext2={setRekeyNext2}
        code={rekeyCode} setCode={setRekeyCode}
        onClose={() => setRekeyOpen(false)}
        onConfirm={() => void onRekey()}
      />
      <input ref={plaintextImportRef} type="file" accept="application/json,.json,.csv,text/csv" className="sr-only" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void onPlaintextImportFile(f);
      }} />
      <Modal
        open={!!importPreview}
        onClose={() => setImportPreview(null)}
        title="Importar entradas"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportPreview(null)}>Cancelar</Button>
            <Button onClick={() => void onConfirmImport()} disabled={busy}>{busy ? "Importando…" : `Añadir ${importPreview?.count ?? 0}`}</Button>
          </>
        }
      >
        {importPreview && (
          <p className="text-sm text-muted">
            {importPreview.source}: se cifrarán <strong className="text-text">{importPreview.count}</strong> {importPreview.count === 1 ? "entrada" : "entradas"} en este navegador y se subirán en un solo envío.
            {importPreview.skipped ? ` Se omitieron ${importPreview.skipped} filas vacías o no importables.` : ""} El servidor no verá usuarios ni contraseñas. Las que ya existan (mismo título, usuario y URL) se saltan.
          </p>
        )}
      </Modal>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border transition-colors",
        active ? "bg-accent-soft text-accent-strong border-accent/30" : "border-border text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function RekeyModal({ open, busy, current, setCurrent, next, setNext, next2, setNext2, code, setCode, onClose, onConfirm }: {
  open: boolean;
  busy: boolean;
  current: string; setCurrent: (v: string) => void;
  next: string; setNext: (v: string) => void;
  next2: string; setNext2: (v: string) => void;
  code: string; setCode: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar la contraseña del Cofre"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={busy || code.trim().length !== 6 || !current || !next}>{busy ? "Cifrando…" : "Cambiar"}</Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-3">Se vuelven a cifrar todas las entradas en este navegador. El servidor no ve la clave nueva. Las copias descargadas antes siguen con la anterior.</p>
      <div className="space-y-3">
        <Input label="Contraseña actual" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <Input label="Nueva contraseña" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="Mín. 10, mayúscula, minúscula y número" />
        <Input label="Repite la nueva contraseña" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" />
        <Input label="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
      </div>
    </Modal>
  );
}

function PasswordGenerator({ onFill }: { onFill: (pw: string) => void }) {
  const [mode, setMode] = useState<"chars" | "phrase">("chars");
  const [length, setLength] = useState(20);
  const [words, setWords] = useState(5);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [preview, setPreview] = useState("");

  const roll = () => {
    try {
      const pw = mode === "phrase" ? generatePassphrase(words, true) : generatePassword({ length, upper, lower, digits, symbols });
      setPreview(pw);
      onFill(pw);
    } catch (e) {
      setPreview(e instanceof Error ? e.message : "");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">Generar</p>
        <Button size="sm" variant="secondary" onClick={roll}><RefreshCw className="w-3.5 h-3.5" />Generar</Button>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[{ value: "chars", label: "Clave" }, { value: "phrase", label: "Frase" }]}
      />
      {mode === "chars" ? (
        <>
          <label className="flex items-center gap-3 text-xs text-muted">
            <span className="w-16">Largo {length}</span>
            <input type="range" min={10} max={48} value={length} onChange={(e) => setLength(Number(e.target.value))} className="flex-1" />
          </label>
          <div className="flex flex-wrap gap-3">
            <Checkbox label="A–Z" checked={upper} onChange={setUpper} />
            <Checkbox label="a–z" checked={lower} onChange={setLower} />
            <Checkbox label="0–9" checked={digits} onChange={setDigits} />
            <Checkbox label="Símbolos" checked={symbols} onChange={setSymbols} />
          </div>
        </>
      ) : (
        <label className="flex items-center gap-3 text-xs text-muted">
          <span className="w-20">{words} palabras</span>
          <input type="range" min={4} max={8} value={words} onChange={(e) => setWords(Number(e.target.value))} className="flex-1" />
        </label>
      )}
      {preview && <p className="font-mono text-xs text-text break-all">{preview}</p>}
    </div>
  );
}

function PasswordSafety({ password }: { password: string }) {
  const score = passwordScore(password);
  const [pwned, setPwned] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPwned(null); setErr(null); }, [password]);
  if (!password) return null;
  const bar = ["bg-border", "bg-danger", "bg-warn", "bg-ok/70", "bg-ok"][score];
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div className={clsx("h-full transition-all", bar)} style={{ width: `${score * 25}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {score > 0 && <p className={clsx("text-[11px]", score <= 1 ? "text-danger" : "text-muted")}>{passwordScoreLabel(score)}</p>}
        <button
          type="button"
          className="text-[11px] text-accent-strong hover:underline"
          disabled={busy}
          onClick={() => {
            setBusy(true); setErr(null);
            void checkPwnedPassword(password).then((n) => setPwned(n)).catch((e) => setErr(e instanceof Error ? e.message : "No se pudo comprobar.")).finally(() => setBusy(false));
          }}
        >
          {busy ? "Comprobando…" : "¿Filtrada?"}
        </button>
      </div>
      {pwned === 0 && <p className="text-[11px] text-ok">No aparece en filtraciones conocidas. Solo se envía un prefijo del hash, no la clave.</p>}
      {pwned != null && pwned > 0 && <p className="text-[11px] text-danger">Aparece en {pwned.toLocaleString("es")} filtraciones. Cámbiala.</p>}
      {err && <p className="text-[11px] text-danger">{err}</p>}
    </div>
  );
}

function ExtraFields({ editor, setEditor, reserved }: {
  editor: VaultEntry;
  setEditor: (e: VaultEntry) => void;
  reserved: string[];
}) {
  const [draftLabel, setDraftLabel] = useState("");
  const reservedSet = new Set(reserved.map((r) => r.toLowerCase()));
  const extras = editor.fields.filter((f) => !reservedSet.has(f.label.toLowerCase()));
  return (
    <div className="space-y-2">
      {extras.map((f) => (
        <div key={f.label} className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Input
              label={f.label}
              type={f.hidden ? "password" : "text"}
              value={f.value}
              onChange={(e) => setEditor(setVaultField(editor, f.label, e.target.value, f.hidden))}
              autoComplete="off"
            />
          </div>
          <button type="button" className="btn-ghost btn-icon-sm text-danger mb-0.5" aria-label={`Quitar ${f.label}`} onClick={() => setEditor(removeVaultField(editor, f.label))}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Campo extra" value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="PIN, recuperación…" autoComplete="off" />
        </div>
        <Button size="sm" variant="secondary" disabled={!draftLabel.trim() || extras.length + reserved.length >= 8} onClick={() => {
          const label = draftLabel.trim();
          if (!label) return;
          setEditor(setVaultField(editor, label, "", false));
          setDraftLabel("");
        }}>Añadir</Button>
      </div>
    </div>
  );
}

function DestroyModal({ open, code, setCode, busy, onClose, onConfirm }: {
  open: boolean; code: string; setCode: (v: string) => void; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Borrar el Cofre"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy || code.trim().length !== 6}>
            {busy ? "Borrando…" : "Borrar del todo"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-3">Se eliminan todas las entradas. El servidor no tiene copia en claro. Confirma con el código de 6 dígitos de tu app. Si tienes una copia cifrada, podrás restaurarla después.</p>
      <Input label="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
    </Modal>
  );
}

function VaultRow({ entry, kinds, copied, selected, onSelected, onCopy, onEdit, onDelete, onFavorite, onTag, onFolder }: {
  entry: VaultEntry;
  kinds: VaultHealthKind[];
  copied: string | null;
  selected: boolean;
  onSelected: (on: boolean) => void;
  onCopy: (label: string, value: string, token: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onTag: (tag: string) => void;
  onFolder: (folder: string) => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const tokenU = `u:${entry.title}`;
  const tokenP = `p:${entry.title}`;
  const tokenO = `o:${entry.title}`;
  const tokenL = `l:${entry.title}`;
  const href = safeHref(entry.url);
  const login = entry.kind === "login" ? [entry.username, entry.password].filter(Boolean).join("\n") : "";
  const cardNumber = vaultFieldValue(entry, "Número");
  const cardCvv = vaultFieldValue(entry, "CVV");
  const cardLast4 = cardNumber.replace(/\s+/g, "").slice(-4);
  const KindIcon = entry.kind === "note" ? StickyNote : entry.kind === "wifi" ? Wifi : entry.kind === "card" ? CreditCard : KeyRound;
  const subtitle = entry.kind === "card" && cardLast4
    ? (showPw && cardNumber ? cardNumber : `•••• ${cardLast4}`)
    : entry.kind === "note"
      ? entry.notes.replace(/\s+/g, " ").trim()
      : entry.username;

  return (
    <li className={clsx("flex items-center gap-2 px-3 py-1.5 min-h-11 hover:bg-elevated/70", selected && "bg-accent-soft/40")}>
      <Checkbox checked={selected} onChange={onSelected} className="shrink-0" label={<span className="sr-only">Seleccionar {entry.title || "entrada"}</span>} />
      <button
        type="button"
        aria-label={entry.favorite ? "Quitar de favoritos" : "Marcar favorito"}
        title={entry.favorite ? "Quitar de favoritos" : "Marcar favorito"}
        onClick={onFavorite}
        className={clsx("w-7 h-7 rounded-lg grid place-items-center shrink-0", entry.favorite ? "text-accent-strong" : "text-faint hover:text-accent-strong")}
      >
        <Star className={clsx("w-3.5 h-3.5", entry.favorite && "fill-current")} />
      </button>
      {entry.kind !== "login" && <KindIcon className="w-3.5 h-3.5 text-faint shrink-0" />}
      <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.9fr)] gap-x-3 items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text truncate">{entry.title || "Sin título"}</p>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 empty:hidden">
            {kinds.includes("weak") && <span className="text-[10px] text-danger">Débil</span>}
            {kinds.includes("reused") && <span className="text-[10px] text-danger">Repetida</span>}
            {kinds.includes("old") && <span className="text-[10px] text-muted">Antigua</span>}
            {entry.folder && (
              <button type="button" onClick={() => onFolder(entry.folder)} className="inline-flex items-center gap-0.5 text-[10px] text-accent-strong hover:underline">
                <Folder className="w-2.5 h-2.5" />{entry.folder}
              </button>
            )}
            {entry.tags.slice(0, 2).map((tag) => (
              <button type="button" key={tag} onClick={() => onTag(tag)} className="text-[10px] text-muted hover:text-text">
                #{tag}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted truncate hidden sm:block">{subtitle || "—"}</p>
        <div className="min-w-0 hidden lg:block">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-strong hover:underline max-w-full">
              <Globe className="w-3 h-3 shrink-0" /><span className="truncate">{entry.url}</span>
            </a>
          ) : (
            <span className="text-xs text-faint">{showPw && entry.password && entry.kind !== "card" ? entry.password : entry.otpSecret ? "TOTP" : ""}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 max-w-[46vw] overflow-x-auto no-scrollbar sm:max-w-none">
        {login && (
          <IconBtn label="Copiar usuario y contraseña" onClick={() => onCopy("Acceso", login, tokenL)}>
            {copied === tokenL ? <Check className="w-3.5 h-3.5 text-ok" /> : <LogIn className="w-3.5 h-3.5" />}
          </IconBtn>
        )}
        {entry.username && (
          <IconBtn label={entry.kind === "card" ? "Copiar titular" : "Copiar usuario"} onClick={() => onCopy(entry.kind === "card" ? "Titular" : "Usuario", entry.username, tokenU)}>
            {copied === tokenU ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
          </IconBtn>
        )}
        {entry.kind === "card" && cardNumber && (
          <IconBtn label="Copiar número" onClick={() => onCopy("Número", cardNumber, `n:${entry.title}`)}>
            {copied === `n:${entry.title}` ? <Check className="w-3.5 h-3.5 text-ok" /> : <CreditCard className="w-3.5 h-3.5" />}
          </IconBtn>
        )}
        {entry.kind === "card" && cardCvv && (
          <IconBtn label="Copiar CVV" onClick={() => onCopy("CVV", cardCvv, `c:${entry.title}`)}>
            {copied === `c:${entry.title}` ? <Check className="w-3.5 h-3.5 text-ok" /> : <KeyRound className="w-3.5 h-3.5" />}
          </IconBtn>
        )}
        {entry.password && entry.kind !== "card" && (
          <>
            <IconBtn label="Copiar contraseña" onClick={() => onCopy("Contraseña", entry.password, tokenP)}>
              {copied === tokenP ? <Check className="w-3.5 h-3.5 text-ok" /> : <KeyRound className="w-3.5 h-3.5" />}
            </IconBtn>
            <IconBtn label={showPw ? "Ocultar contraseña" : "Ver contraseña"} onClick={() => setShowPw((v) => !v)}>
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </IconBtn>
          </>
        )}
        {entry.kind === "card" && cardNumber && (
          <IconBtn label={showPw ? "Ocultar número" : "Ver número"} onClick={() => setShowPw((v) => !v)}>
            {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </IconBtn>
        )}
        {entry.otpSecret && (
          <TotpCopy secret={entry.otpSecret} copied={copied === tokenO} onCopy={(code) => onCopy("Código", code, tokenO)} />
        )}
        <IconBtn label="Editar" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Eliminar" onClick={() => setConfirm(true)} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); onDelete(); }}
        title="Eliminar entrada"
        message={`¿Borrar «${entry.title || "esta entrada"}» del Cofre?`}
      />
    </li>
  );
}

function TotpCopy({ secret, copied, onCopy }: { secret: string; copied: boolean; onCopy: (code: string) => void }) {
  return (
    <IconBtn label="Copiar código TOTP" onClick={() => { void totpCode(secret).then(onCopy).catch(() => undefined); }}>
      {copied ? <Check className="w-4 h-4 text-ok" /> : <Timer className="w-4 h-4" />}
    </IconBtn>
  );
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={clsx("btn-ghost btn-icon-sm", danger && "text-danger hover:text-danger")}>
      {children}
    </button>
  );
}

function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}
