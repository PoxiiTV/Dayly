import { describe, expect, it } from "vitest";
import { asMascotId, mascotName, MASCOT_IDS } from "../src/lib/mascot/characters.js";

describe("mascot characters", () => {
  it("acepta las seis mascotas y conserva perfiles antiguos de Habi", () => {
    expect(MASCOT_IDS).toEqual(["calen", "tashi", "nubo", "foco", "posti", "orbi"]);
    expect(asMascotId("tashi")).toBe("tashi");
    expect(asMascotId("foco")).toBe("foco");
    expect(asMascotId("habi")).toBe("nubo");
    expect(asMascotId("posti")).toBe("posti");
    expect(asMascotId("orbi")).toBe("orbi");
    expect(asMascotId("nope")).toBe("calen");
    expect(asMascotId(null)).toBe("calen");
    expect(mascotName("calen")).toBe("Calen");
    expect(mascotName("nubo")).toBe("Nubo");
    expect(mascotName("posti")).toBe("Posti");
    expect(mascotName("orbi")).toBe("Orbi");
  });
});
