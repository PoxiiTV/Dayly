import { describe, it, expect } from "vitest";
import { searchAllowed, searchTopic } from "../src/lib/mascot/search.js";

describe("mascot search allowlist", () => {
  it("permite comida, ejercicio y horarios de comercios", () => {
    expect(searchTopic("receta de lentejas")).toBe("food");
    expect(searchTopic("menú semanal vegetariano")).toBe("food");
    expect(searchTopic("qué puedo cenar esta noche")).toBe("food");
    expect(searchTopic("ejercicios de 10 minutos en casa")).toBe("exercise");
    expect(searchTopic("estiramientos para mantener la forma")).toBe("exercise");
    expect(searchTopic("horario de la farmacia")).toBe("place");
    expect(searchTopic("a qué hora abre el Mercadona")).toBe("place");
    expect(searchAllowed("horario Correos mañana")).toBe(true);
  });

  it("rechaza código, noticias y temas ajenos", () => {
    expect(searchAllowed("escribe código en python")).toBe(false);
    expect(searchAllowed("últimas noticias de política")).toBe(false);
    expect(searchAllowed("capital de Francia")).toBe(false);
    expect(searchAllowed("cómo hackear una cuenta")).toBe(false);
  });
});
