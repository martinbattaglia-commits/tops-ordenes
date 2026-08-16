/**
 * A-6 · Sin posición no hay nave, y sin nave la línea no se puede ubicar.
 *
 * `reception_items.position_id` es nullable en el esquema (0025:92) y el
 * contrato de TypeScript lo declara opcional. Retirado el aislamiento por
 * sede, la jerarquía física que cuelga de esa posición es el ÚNICO lugar donde
 * vive la nave de la línea: ya no hay columna de cabecera que la supla.
 *
 * Hasta ahora el requisito lo sostenía sólo el formulario. Cualquier otro
 * llamador —o un payload construido a mano— dejaba la línea sin ubicar.
 */
import { describe, expect, it } from "vitest";
import { assertPositionRequired } from "@/lib/wms/receptions";

describe("A-6 · la posición es obligatoria en el servidor", () => {
  it("una línea con posición pasa", () => {
    expect(() =>
      assertPositionRequired({ sku: "SKU-1", position_id: "11111111-1111-4111-8111-111111111111" }),
    ).not.toThrow();
  });

  it("rechaza la posición ausente", () => {
    expect(() => assertPositionRequired({ sku: "SKU-1" })).toThrow(/necesita una posición/);
  });

  it("rechaza la posición nula y la vacía por igual", () => {
    expect(() => assertPositionRequired({ sku: "SKU-1", position_id: null })).toThrow(
      /necesita una posición/,
    );
    expect(() => assertPositionRequired({ sku: "SKU-1", position_id: "" })).toThrow(
      /necesita una posición/,
    );
  });

  it("el mensaje nombra la línea y explica por qué, en vez de un error de base", () => {
    try {
      assertPositionRequired({ sku: "SKU-CAFE", position_id: null });
      throw new Error("debió lanzar");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("SKU-CAFE");
      expect(msg).toContain("nave");
      expect(msg).not.toContain("sede WMS no autorizada");
    }
  });

  it("una línea sin SKU tampoco pasa, y el mensaje lo tolera", () => {
    expect(() => assertPositionRequired({})).toThrow(/sin SKU/);
  });
});
