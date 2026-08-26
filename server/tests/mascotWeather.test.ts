import { describe, it, expect } from "vitest";
import { formatForecast, placeFromTz, weatherIntent, wmoLabel } from "../src/lib/mascot/weather.js";

describe("mascot weather", () => {
  it("traduce códigos WMO", () => {
    expect(wmoLabel(0)).toBe("despejado");
    expect(wmoLabel(61)).toBe("lluvia");
    expect(wmoLabel(95)).toBe("tormenta");
  });

  it("elige ciudad según zona de Ajustes", () => {
    expect(placeFromTz("Europe/Madrid")).toBe("Madrid");
    expect(placeFromTz("America/New_York")).toBe("Nueva York");
    expect(placeFromTz("Pacific/Honolulu")).toBe("Honolulu");
  });

  it("detecta intención de clima", () => {
    expect(weatherIntent("capital de Francia")).toBe(null);
    expect(weatherIntent("qué tiempo hace")).toEqual({ place: "", kind: "now" });
    expect(weatherIntent("clima mañana en Valencia")).toEqual({ place: "Valencia", kind: "tomorrow" });
    expect(weatherIntent("previsión de la semana")).toEqual({ place: "", kind: "week" });
  });

  it("formatea previsión actual", () => {
    const text = formatForecast("Madrid, España", "now", {
      current: {
        temperature_2m: 24.4,
        apparent_temperature: 23.1,
        relative_humidity_2m: 48,
        weather_code: 1,
        wind_speed_10m: 12,
        precipitation: 0,
      },
      daily: {
        time: ["2026-08-24", "2026-08-25"],
        weather_code: [1, 61],
        temperature_2m_max: [31, 28],
        temperature_2m_min: [19, 18],
        precipitation_probability_max: [10, 80],
      },
    });
    expect(text).toContain("24 °C");
    expect(text).toContain("mayormente despejado");
    expect(text).toContain("2026-08-25");
    expect(text).toContain("lluvia 80%");
  });
});
