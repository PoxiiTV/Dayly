import { describe, it, expect } from "vitest";
import { asMascotProvider, hydrateKeyVault, parseKeyVault, publicKeyStatus, keyEncFor } from "../src/lib/mascot/keys.js";

describe("mascot API keys por proveedor", () => {
  it("hidrata la clave antigua en el proveedor guardado", () => {
    const vault = hydrateKeyVault(null, "enc-legacy", "opencode");
    expect(keyEncFor(vault, "opencode")).toBe("enc-legacy");
    expect(keyEncFor(vault, "custom")).toBe(null);
    expect(publicKeyStatus(vault).opencode).toEqual({ hasKey: true, valid: false });
  });

  it("no pisa una clave ya guardada en el vault", () => {
    const raw = JSON.stringify({
      opencode: { enc: "enc-go", valid: true },
      custom: { enc: "enc-groq", valid: false },
    });
    const vault = hydrateKeyVault(raw, "enc-legacy", "opencode");
    expect(keyEncFor(vault, "opencode")).toBe("enc-go");
    expect(keyEncFor(vault, "custom")).toBe("enc-groq");
    expect(publicKeyStatus(vault).opencode.valid).toBe(true);
    expect(publicKeyStatus(vault).custom).toEqual({ hasKey: true, valid: false });
  });

  it("parsea basura como vault vacío", () => {
    const vault = parseKeyVault("no-json");
    expect(keyEncFor(vault, "openrouter")).toBe(null);
    expect(asMascotProvider("nope")).toBe("opencode");
  });
});
