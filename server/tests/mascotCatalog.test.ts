import { describe, it, expect } from "vitest";
import { pickAutoFree, isBlockedGoModel, isGoFreeId, listOpencodeModels, parsePublicHttpsUrl, resolveLane } from "../src/lib/mascot/catalog.js";

describe("selector auto-free de la mascota", () => {
  it("elige un id gratis y prioriza flash/alpha/mini/tiny", () => {
    const picked = pickAutoFree([
      "grok-4.5",
      "deepseek-v4-flash",
      "ox-alpha-free",
      "some-long-free-model",
    ]);
    expect(picked).toBe("ox-alpha-free");
  });

  it("prefiere flash frente a un *free* genérico", () => {
    expect(pickAutoFree(["slowpoke-free", "flash-free"])).toBe("flash-free");
  });

  it("nunca elige grok ni luna", () => {
    expect(isBlockedGoModel("grok-4.5")).toBe(true);
    expect(isBlockedGoModel("gpt-5.6-luna")).toBe(true);
    expect(pickAutoFree(["grok-free", "luna-free"])).toBe(null);
  });

  it("trata como gratis solo los ids oficiales (*free* o big-pickle), no los de pago de Go", () => {
    expect(isBlockedGoModel("muse-spark-1.2-contributor-free")).toBe(false);
    expect(isGoFreeId("muse-spark-1.2-contributor-free")).toBe(true);
    expect(isGoFreeId("muse-spark-1.2-contributor")).toBe(false);
    expect(isGoFreeId("mimo-v2.5")).toBe(false);
    expect(isGoFreeId("mimo-v2.5-free")).toBe(true);
    expect(isGoFreeId("ox-alpha-free")).toBe(true);
    expect(isGoFreeId("big-pickle")).toBe(true);
  });

  it("devuelve null si no hay ningún modelo a 0 $ (sin caer en uno de pago)", () => {
    expect(pickAutoFree(["deepseek-v4-flash", "gpt-4o"])).toBe(null);
  });

  it("lista ids oficiales tal cual: Zen free primero, luego Go, sin inventar -free", () => {
    const list = listOpencodeModels(
      [
        "glm-5",
        "hy3",
        "mimo-v2.5",
        "muse-spark-1.2-contributor",
        "ox-alpha-free",
        "grok-4.5",
      ],
      [
        "mimo-v2.5-free",
        "hy3-free",
        "muse-spark-1.2-contributor-free",
        "nemotron-3-ultra-free",
        "nemotron-3.5-lightning-free",
        "big-pickle",
        "gpt-5.5",
      ],
    );
    const ids = list.map((m) => m.id);
    expect(ids.slice(0, 6)).toEqual([
      "mimo-v2.5-free",
      "hy3-free",
      "muse-spark-1.2-contributor-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "big-pickle",
    ]);
    expect(ids).toContain("ox-alpha-free");
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("hy3");
    expect(ids).toContain("muse-spark-1.2-contributor");
    expect(ids).not.toContain("grok-4.5");
    expect(ids).not.toContain("gpt-5.5");
    expect(ids.indexOf("mimo-v2.5-free")).toBeLessThan(ids.indexOf("mimo-v2.5"));
    expect(ids.indexOf("ox-alpha-free")).toBeLessThan(ids.indexOf("glm-5"));
    expect(list.find((m) => m.id === "mimo-v2.5-free")?.lane).toBe("zen");
    expect(list.find((m) => m.id === "ox-alpha-free")?.lane).toBe("go");
    expect(list.find((m) => m.id === "mimo-v2.5")?.lane).toBe("go");
  });

  it("enruta ox-alpha-free a Go y los *-free de Zen a Zen", () => {
    const go = ["ox-alpha-free", "mimo-v2.5", "hy3"];
    const zen = ["mimo-v2.5-free", "hy3-free", "x-preview-f-free"];
    expect(resolveLane("ox-alpha-free", go, zen)).toBe("go");
    expect(resolveLane("mimo-v2.5", go, zen)).toBe("go");
    expect(resolveLane("mimo-v2.5-free", go, zen)).toBe("zen");
    expect(resolveLane("hy3-free", go, zen)).toBe("zen");
    expect(resolveLane("x-preview-f-free", go, zen)).toBe("zen");
  });
});

describe("URL pública de catálogo personalizado", () => {
  it("acepta un endpoint OpenAI-compatible https", () => {
    expect(parsePublicHttpsUrl("https://api.groq.com/openai/v1/models")?.href).toBe("https://api.groq.com/openai/v1/models");
  });

  it("rechaza http, localhost, IPs y credenciales en la URL", () => {
    expect(parsePublicHttpsUrl("http://api.groq.com/openai/v1/models")).toBe(null);
    expect(parsePublicHttpsUrl("https://localhost/v1/models")).toBe(null);
    expect(parsePublicHttpsUrl("https://127.0.0.1/v1/models")).toBe(null);
    expect(parsePublicHttpsUrl("https://192.168.1.10/v1/models")).toBe(null);
    expect(parsePublicHttpsUrl("https://user:pass@api.groq.com/openai/v1/models")).toBe(null);
  });
});
