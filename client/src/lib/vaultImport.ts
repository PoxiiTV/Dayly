import { emptyVaultEntry, normalizePasswordHistory, normalizeVaultFields, normalizeVaultFolder, normalizeVaultKind, normalizeVaultTags, type VaultEntry, type VaultEntryKind } from "./vaultCrypto";

const MAX_IMPORT = 500;

export type VaultImportResult = {
  entries: VaultEntry[];
  skipped: number;
  source: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "";
  return "";
}

function hostnameTitle(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function finalize(partial: Partial<VaultEntry>, now: string): VaultEntry | null {
  const entry = {
    ...emptyVaultEntry(),
    title: (partial.title || "").trim(),
    username: (partial.username || "").trim(),
    password: partial.password || "",
    url: (partial.url || "").trim(),
    notes: (partial.notes || "").trim(),
    otpSecret: (partial.otpSecret || "").trim(),
    favorite: Boolean(partial.favorite),
    folder: normalizeVaultFolder(partial.folder || ""),
    tags: normalizeVaultTags(partial.tags || []),
    kind: normalizeVaultKind(partial.kind),
    fields: normalizeVaultFields(partial.fields),
    passwordChangedAt: partial.passwordChangedAt || (partial.password ? now : ""),
    passwordHistory: normalizePasswordHistory(partial.passwordHistory),
  };
  if (!entry.title) entry.title = hostnameTitle(entry.url) || entry.username || "";
  if (!entry.title && !entry.password && !entry.notes && !entry.username) return null;
  if (!entry.title) entry.title = "Importada";
  return entry;
}

function detectEncryptedBitwarden(raw: Record<string, unknown>): boolean {
  if (raw.encrypted === true) return true;
  if (typeof raw.data === "string" && (raw.data.includes("|") || raw.passwordProtected === true)) return true;
  return false;
}

function fromBitwardenJson(raw: Record<string, unknown>, now: string): VaultImportResult {
  const folders = new Map<string, string>();
  if (Array.isArray(raw.folders)) {
    for (const row of raw.folders) {
      const f = asRecord(row);
      if (!f) continue;
      const id = str(f.id);
      const name = str(f.name);
      if (id && name) folders.set(id, name);
    }
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const row of items) {
    if (entries.length >= MAX_IMPORT) { skipped++; continue; }
    const item = asRecord(row);
    if (!item) { skipped++; continue; }
    const type = typeof item.type === "number" ? item.type : 1;
    if (type === 4) { skipped++; continue; }
    let kind: VaultEntryKind = "login";
    let username = "";
    let password = "";
    let url = "";
    let otpSecret = "";
    let fields: VaultEntry["fields"] = [];
    if (type === 2) {
      kind = "note";
    } else if (type === 3) {
      kind = "card";
      const card = asRecord(item.card);
      username = str(card?.cardholderName);
      fields = normalizeVaultFields([
        { label: "Número", value: str(card?.number), hidden: true },
        { label: "Caducidad", value: [str(card?.expMonth), str(card?.expYear)].filter(Boolean).join("/"), hidden: false },
        { label: "CVV", value: str(card?.code), hidden: true },
        { label: "Marca", value: str(card?.brand), hidden: false },
      ]);
    } else {
      const login = asRecord(item.login);
      const uris = login && Array.isArray(login.uris) ? login.uris : [];
      url = uris.map((u) => asRecord(u)?.uri).map(str).find(Boolean) || "";
      username = str(login?.username);
      password = str(login?.password);
      otpSecret = str(login?.totp);
    }
    const entry = finalize({
      title: str(item.name),
      username,
      password,
      url,
      notes: str(item.notes),
      otpSecret,
      favorite: item.favorite === true || item.favorite === 1,
      folder: folders.get(str(item.folderId)) || "",
      kind,
      fields,
    }, now);
    if (!entry) { skipped++; continue; }
    entries.push(entry);
  }
  return { entries, skipped, source: "Bitwarden JSON" };
}

function fromOnePasswordPux(raw: Record<string, unknown>, now: string): VaultImportResult {
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const acc of accounts) {
    const account = asRecord(acc);
    const vaults = Array.isArray(account?.vaults) ? account!.vaults as unknown[] : [];
    for (const v of vaults) {
      const vault = asRecord(v);
      const items = Array.isArray(vault?.items) ? vault!.items as unknown[] : [];
      for (const row of items) {
        if (entries.length >= MAX_IMPORT) { skipped++; continue; }
        const item = asRecord(row);
        if (!item) { skipped++; continue; }
        const overview = asRecord(item.overview) || {};
        const details = asRecord(item.details) || {};
        const fields = Array.isArray(details.loginFields) ? details.loginFields : [];
        let username = "";
        let password = "";
        for (const f of fields) {
          const field = asRecord(f);
          if (!field) continue;
          const designation = str(field.designation).toLowerCase();
          const name = str(field.name).toLowerCase();
          const value = str(field.value);
          if (designation === "username" || name === "username") username = value;
          if (designation === "password" || name === "password") password = value;
        }
        let otp = "";
        const sections = Array.isArray(details.sections) ? details.sections : [];
        for (const s of sections) {
          const section = asRecord(s);
          const sfields = Array.isArray(section?.fields) ? section!.fields as unknown[] : [];
          for (const f of sfields) {
            const field = asRecord(f);
            if (!field) continue;
            const id = str(field.id).toLowerCase();
            const value = str(field.value);
            if (id.includes("totp") || value.startsWith("otpauth://")) otp = value;
          }
        }
        const historyRaw = Array.isArray(details.passwordHistory) ? details.passwordHistory : [];
        const passwordHistory = historyRaw.map((h) => {
          const rowH = asRecord(h);
          const pw = str(rowH?.value);
          const time = typeof rowH?.time === "number" ? new Date(rowH.time * (rowH.time < 1e12 ? 1000 : 1)).toISOString() : "";
          return { password: pw, changedAt: time };
        });
        const tags = Array.isArray(overview.tags) ? overview.tags.map(str) : [];
        const url = str(overview.url) || str(asRecord(Array.isArray(overview.urls) ? overview.urls[0] : null)?.url);
        const entry = finalize({
          title: str(overview.title),
          username,
          password,
          url,
          notes: str(details.notesPlain),
          otpSecret: otp,
          tags,
          passwordHistory,
        }, now);
        if (!entry) { skipped++; continue; }
        entries.push(entry);
      }
    }
  }
  if (!entries.length && !skipped) throw new Error("No se encontraron inicios de sesión en el JSON de 1Password.");
  return { entries, skipped, source: "1Password JSON" };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch;
    i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^\uFEFF/, "").replace(/[\s-]+/g, "_");
}

const HEADER_MAP: Record<string, keyof VaultEntry | "ignore"> = {
  title: "title",
  name: "title",
  nombre: "title",
  username: "username",
  user: "username",
  login: "username",
  login_username: "username",
  password: "password",
  login_password: "password",
  url: "url",
  uri: "url",
  login_uri: "url",
  website: "url",
  sitio: "url",
  notes: "notes",
  note: "notes",
  notas: "notes",
  folder: "folder",
  carpeta: "folder",
  tags: "tags",
  etiquetas: "tags",
  totp: "otpSecret",
  login_totp: "otpSecret",
  otpauth: "otpSecret",
  otp: "otpSecret",
  otpsecret: "otpSecret",
  favorite: "favorite",
  favourites: "favorite",
};

function fromCsv(text: string, now: string): VaultImportResult {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("El CSV no tiene filas de datos.");
  const headers = table[0]!.map(normHeader);
  const mapped = headers.map((h) => HEADER_MAP[h] ?? null);
  if (!mapped.some((m) => m === "title" || m === "password" || m === "username" || m === "url")) {
    throw new Error("No reconozco las columnas. Usa un CSV de Bitwarden, 1Password o Chrome (título, usuario, contraseña, URL).");
  }
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    if (entries.length >= MAX_IMPORT) { skipped++; continue; }
    const partial: Partial<VaultEntry> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = mapped[i];
      if (!key || key === "ignore") continue;
      const value = cells[i] ?? "";
      if (key === "favorite") {
        partial.favorite = /^(1|true|yes|sí|si)$/i.test(value.trim());
      } else if (key === "tags") {
        partial.tags = normalizeVaultTags(value);
      } else {
        (partial as Record<string, unknown>)[key] = value;
      }
    }
    const typeIdx = headers.indexOf("type");
    if (typeIdx >= 0) {
      const t = (cells[typeIdx] || "").toLowerCase();
      if (t.includes("identity")) { skipped++; continue; }
      if (t.includes("card") || t.includes("tarjeta")) partial.kind = "card";
      else if (t.includes("note") || t.includes("nota") || t.includes("secure")) partial.kind = "note";
      else if (t.includes("wifi") || t.includes("wi-fi")) partial.kind = "wifi";
    }
    if (partial.kind === "card") {
      const col = (name: string) => {
        const i = headers.indexOf(name);
        return i >= 0 ? (cells[i] ?? "") : "";
      };
      const month = col("card_exp_month") || col("exp_month");
      const year = col("card_exp_year") || col("exp_year");
      partial.username = partial.username || col("cardholder_name");
      partial.fields = normalizeVaultFields([
        { label: "Número", value: col("card_number") || partial.password || "", hidden: true },
        { label: "Caducidad", value: [month, year].filter(Boolean).join("/"), hidden: false },
        { label: "CVV", value: col("card_code") || col("cvv") || "", hidden: true },
        { label: "Marca", value: col("card_brand") || col("brand") || "", hidden: false },
      ]);
    }
    const entry = finalize(partial, now);
    if (!entry) { skipped++; continue; }
    entries.push(entry);
  }
  return { entries, skipped, source: "CSV" };
}

export function parseVaultImport(text: string, now = new Date().toISOString()): VaultImportResult {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("El archivo está vacío.");
  if (trimmed.startsWith("PK")) {
    throw new Error("Ese archivo es un ZIP (1PUX). En 1Password exporta CSV, o descomprime y usa el data.json.");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data: unknown;
    try { data = JSON.parse(trimmed) as unknown; } catch {
      throw new Error("El JSON no es válido.");
    }
    const raw = asRecord(Array.isArray(data) ? { items: data } : data);
    if (!raw) throw new Error("El JSON no es un listado de entradas.");
    if (raw.kind === "kalendiario-cofre") {
      throw new Error("Esa es una copia cifrada de Kalendiario. Restaúrala con «Restaurar copia» en un Cofre vacío.");
    }
    if (detectEncryptedBitwarden(raw)) {
      throw new Error("Ese export de Bitwarden está cifrado. En Bitwarden exporta JSON o CSV sin cifrar e impórtalo aquí con el Cofre abierto.");
    }
    if (Array.isArray(raw.items) && (raw.encrypted === false || raw.folders || asRecord(raw.items[0] as unknown)?.login || typeof asRecord(raw.items[0] as unknown)?.type === "number")) {
      return fromBitwardenJson(raw, now);
    }
    if (Array.isArray(raw.accounts)) return fromOnePasswordPux(raw, now);
    if (Array.isArray(raw.items)) return fromBitwardenJson(raw, now);
    throw new Error("No reconozco este JSON. Prueba un export de Bitwarden (sin cifrar) o un CSV.");
  }
  return fromCsv(trimmed, now);
}
