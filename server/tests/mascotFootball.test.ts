import { describe, it, expect } from "vitest";
import { extractTeamKey, footballIntent, footballLookup, normalizeTeamKey, resolveFootballApiKey } from "../src/lib/mascot/football.js";

describe("mascot football intent", () => {
  it("normaliza Barça y apodos", () => {
    expect(normalizeTeamKey("Barça")).toBe("barca");
    expect(extractTeamKey("próximo partido del Barça")).toBe("barca");
    expect(extractTeamKey("FC Barcelona")).toBe("barcelona");
  });

  it("detecta próximo partido", () => {
    expect(footballIntent("¿cuál es el próximo partido del Barça?")).toEqual({
      team: "barca",
      kind: "next",
    });
  });

  it("detecta resultado", () => {
    expect(footballIntent("¿cómo quedó el Barça?")).toEqual({
      team: "barca",
      kind: "last",
    });
  });

  it("no trata como fútbol una búsqueda genérica", () => {
    expect(footballIntent("capital de Francia")).toBe(null);
  });

  it("usa la clave del usuario y, si no hay, la del entorno", () => {
    expect(resolveFootballApiKey("  user-key  ")).toBe("user-key");
    const prev = process.env.FOOTBALL_DATA_API_KEY;
    process.env.FOOTBALL_DATA_API_KEY = "env-key";
    expect(resolveFootballApiKey("")).toBe("env-key");
    delete process.env.FOOTBALL_DATA_API_KEY;
    expect(resolveFootballApiKey("")).toBe("");
    if (prev !== undefined) process.env.FOOTBALL_DATA_API_KEY = prev;
  });

  it("pide configurar la key en Ajustes si no hay ninguna", async () => {
    const prev = process.env.FOOTBALL_DATA_API_KEY;
    delete process.env.FOOTBALL_DATA_API_KEY;
    const text = await footballLookup("barca", "next", "Europe/Madrid", "");
    expect(text).toMatch(/Ajustes/);
    if (prev !== undefined) process.env.FOOTBALL_DATA_API_KEY = prev;
  });
});
