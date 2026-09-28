import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";
import { generatePassword, generatePassphrase, parseVaultBackup, normalizeVaultTags, normalizeVaultFolder, withPasswordHistory, emptyVaultEntry, setVaultField, vaultFieldValue } from "../../client/src/lib/vaultCrypto.ts";
import { totpCode, normalizeTotpSecret } from "../../client/src/lib/totp.ts";
import { assessVaultHealth, isWeakPassword, passwordScore } from "../../client/src/lib/vaultHealth.ts";
import { parseVaultImport } from "../../client/src/lib/vaultImport.ts";
import { pwnedCountFromRange } from "../../client/src/lib/vaultPwned.ts";

describe("vault client helpers", () => {
  it("generates a password from the selected pools", () => {
    const pw = generatePassword({ length: 24, upper: true, lower: true, digits: true, symbols: false });
    expect(pw).toHaveLength(24);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(pw)).toBe(false);
  });

  it("matches otplib for a Base32 TOTP secret", async () => {
    const secret = authenticator.generateSecret();
    const expected = authenticator.generate(secret);
    const ours = await totpCode(secret);
    expect(ours).toBe(expected);
    expect(normalizeTotpSecret(`otpauth://totp/Dayly:a?secret=${secret}&issuer=K`)).toBe(secret.toUpperCase());
  });

  it("rejects a backup that is not a Cofre file", () => {
    expect(() => parseVaultBackup("{}")).toThrow(/copia/i);
    expect(() => parseVaultBackup("{not json")).toThrow(/JSON/i);
  });

  it("normalizes folders and tags without leaking empties", () => {
    expect(normalizeVaultFolder("  Trabajo  ")).toBe("Trabajo");
    expect(normalizeVaultTags("wifi, Casa, wifi, ")).toEqual(["wifi", "Casa"]);
  });

  it("keeps previous passwords when the current one changes", () => {
    const prev = { ...emptyVaultEntry(), password: "AntiguaClave1", passwordChangedAt: "2024-01-01T00:00:00.000Z" };
    const next = withPasswordHistory(prev, { ...prev, password: "NuevaClave99" }, "2026-08-29T00:00:00.000Z");
    expect(next.password).toBe("NuevaClave99");
    expect(next.passwordChangedAt).toBe("2026-08-29T00:00:00.000Z");
    expect(next.passwordHistory[0]).toEqual({ password: "AntiguaClave1", changedAt: "2024-01-01T00:00:00.000Z" });
    const same = withPasswordHistory(next, { ...next, favorite: true });
    expect(same.passwordHistory).toEqual(next.passwordHistory);
    expect(same.passwordChangedAt).toBe(next.passwordChangedAt);
  });

  it("flags weak, reused and old passwords locally", () => {
    expect(isWeakPassword("123456")).toBe(true);
    expect(isWeakPassword("abcdefghij")).toBe(true);
    expect(isWeakPassword("Tr0n-Segura-2026!")).toBe(false);
    const health = assessVaultHealth([
      { id: "a", createdAt: "2020-01-01T00:00:00.000Z", entry: { password: "123456", passwordChangedAt: "2020-01-01T00:00:00.000Z" } },
      { id: "b", createdAt: "2026-08-01T00:00:00.000Z", entry: { password: "123456", passwordChangedAt: "2026-08-01T00:00:00.000Z" } },
      { id: "c", createdAt: "2026-08-01T00:00:00.000Z", entry: { password: "Tr0n-Segura-2026!", passwordChangedAt: "2026-08-01T00:00:00.000Z" } },
    ], Date.parse("2026-08-29T00:00:00.000Z"));
    expect(health.weakIds).toEqual(["a", "b"]);
    expect(health.reusedIds).toEqual(["a", "b"]);
    expect(health.oldIds).toEqual(["a"]);
  });

  it("imports Bitwarden JSON and CSV, and rejects encrypted exports", () => {
    const bw = parseVaultImport(JSON.stringify({
      encrypted: false,
      folders: [{ id: "f1", name: "Trabajo" }],
      items: [
        { type: 1, name: "GitHub", folderId: "f1", favorite: true, notes: "dev", login: { username: "k", password: "SecretPass1", totp: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP", uris: [{ uri: "https://github.com" }] } },
        { type: 2, name: "PIN caja", notes: "4321" },
        { type: 3, name: "Visa", card: { cardholderName: "Ana", number: "4111111111111111", expMonth: "12", expYear: "28", code: "123" } },
        { type: 4, name: "Pasaporte" },
      ],
    }));
    expect(bw.source).toMatch(/Bitwarden/i);
    expect(bw.entries).toHaveLength(3);
    expect(bw.entries[0]).toMatchObject({ title: "GitHub", username: "k", folder: "Trabajo", favorite: true, url: "https://github.com", kind: "login" });
    expect(bw.entries[1]).toMatchObject({ title: "PIN caja", kind: "note", notes: "4321" });
    expect(bw.entries[2]).toMatchObject({ title: "Visa", kind: "card", username: "Ana" });
    expect(vaultFieldValue(bw.entries[2]!, "Número")).toBe("4111111111111111");
    expect(bw.skipped).toBe(1);

    const csv = parseVaultImport("title,username,password,url,folder\nBanco,ana,ClaveFuerte12,https://banco.test,Casa\n");
    expect(csv.entries[0]).toMatchObject({ title: "Banco", username: "ana", folder: "Casa" });

    expect(() => parseVaultImport(JSON.stringify({ encrypted: true, data: "2.xx|yy" }))).toThrow(/cifrado/i);
    expect(() => parseVaultImport(JSON.stringify({ kind: "dayly-cofre", version: 1 }))).toThrow(/Restaúrala/i);
  });

  it("builds a memorable passphrase and extra fields", () => {
    const phrase = generatePassphrase(5, true);
    expect(phrase.split("-")).toHaveLength(5);
    expect(/\d$/.test(phrase)).toBe(true);
    expect(passwordScore(phrase)).toBeGreaterThanOrEqual(3);
    const withField = setVaultField(emptyVaultEntry(), "PIN", "1234", true);
    expect(vaultFieldValue(withField, "PIN")).toBe("1234");
    expect(withField.fields[0]?.hidden).toBe(true);
  });

  it("matches HIBP range suffixes without sending the password", () => {
    expect(pwnedCountFromRange("ABCDEFFFFFF", "FFFFFF:12\nAAAAAA:1")).toBe(12);
    expect(pwnedCountFromRange("ABCDEFFFFFF", "111111:9")).toBe(0);
  });
});
