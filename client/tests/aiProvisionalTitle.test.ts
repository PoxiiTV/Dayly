import { describe, expect, it } from "vitest";
import { provisionalTitle } from "../src/lib/ai";

describe("provisionalTitle", () => {
  it("keeps short descriptions whole and collapses whitespace", () => {
    expect(provisionalTitle("  llamar   al\n proveedor ")).toBe("llamar al proveedor");
    expect(provisionalTitle("revisar facturas")).toBe("revisar facturas");
  });

  it("cuts long text on a word boundary with an ellipsis", () => {
    const text = "revisar todas las facturas de proveedores del trimestre y preparar el resumen para la gestoría";
    const title = provisionalTitle(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(text.startsWith(title.slice(0, -1))).toBe(true);
  });
});
