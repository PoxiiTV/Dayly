/**
 * Money helpers. Amounts travel and are stored as integer cents everywhere:
 * the only place a decimal exists is the text the user types.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  const key = currency || "EUR";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("es-ES", { style: "currency", currency: key });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(cents: number, currency = "EUR"): string {
  return formatterFor(currency).format((cents ?? 0) / 100);
}

/** Same amount without the cents, for headline figures. */
export function formatMoneyRounded(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 })
    .format((cents ?? 0) / 100);
}

/** What goes in the amount input when editing an existing amount. */
export function centsToInput(cents: number): string {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

/**
 * Parses what the user typed into cents. Accepts "12,99", "12.99", "12" and
 * "1.299,50"; returns null when it is not a usable amount so the caller can
 * complain instead of silently saving a zero.
 */
export function parseMoneyInput(raw: string): number | null {
  const text = (raw ?? "").trim().replace(/[€\s]/g, "");
  if (!text) return null;
  // With both separators, the last one is the decimal mark.
  let normalized = text;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    normalized = text.replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}
