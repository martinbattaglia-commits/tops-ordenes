/**
 * R-6 · Las reglas operativas del tarifario son contenido comercial y legal.
 *
 * `service-ui.ts` nació para que el navegador del encargado no reciba tarifas,
 * y al copiar `TRANSPORT_RULES` desde `pricing/vehicles.ts` la copia quedó
 * truncada: de siete reglas pasaron cuatro. Se perdieron los porcentajes
 * concretos de recargo fuera de horario, la regla completa de hora extra de
 * peón, el tratamiento de peajes y el aviso de que los precios no incluyen
 * IVA. El wizard comercial las mostraba antes y dejó de mostrarlas.
 *
 * Ninguna de las siete contiene una tarifa: son texto normativo con
 * porcentajes relativos. Sin el precio base, un porcentaje no revela ningún
 * importe, así que la fuente única no reintroduce nada al encargado. El
 * aislamiento real vive en el servidor (`data/service-pricing.ts`), que para
 * un principal devuelve el catálogo con `rate: null` y `pricesVisible: false`.
 */
import { describe, expect, it } from "vitest";
import { TRANSPORT_RULES } from "@/lib/pricing/service-ui";

describe("R-6 · TRANSPORT_RULES conserva el contenido comercial y legal", () => {
  it("son siete reglas, no cuatro", () => {
    expect(TRANSPORT_RULES).toHaveLength(7);
  });

  it("declara los porcentajes de recargo fuera de horario para camión", () => {
    const texto = TRANSPORT_RULES.join(" | ");
    expect(texto).toContain("17–19 hs +25%");
    expect(texto).toContain("19–21 hs +50%");
    expect(texto).toContain("después de 21 hs +100%");
  });

  it("conserva la regla de hora extra de peón, que había desaparecido entera", () => {
    const texto = TRANSPORT_RULES.join(" | ");
    expect(texto).toContain("hora extra (peón)");
    expect(texto).toContain("17–19 hs +50%");
  });

  it("informa que los peajes se cotizan aparte", () => {
    expect(TRANSPORT_RULES.join(" | ")).toContain("Peajes");
  });

  it("advierte que los valores NO incluyen IVA", () => {
    // Es la que tiene consecuencia legal directa: sin este aviso, el importe
    // exhibido se lee como final.
    expect(TRANSPORT_RULES.join(" | ")).toContain("NO incluyen IVA");
  });

  it("no contiene ningún importe: la fuente única no filtra tarifas", () => {
    const texto = TRANSPORT_RULES.join(" | ");
    expect(texto).not.toMatch(/\$/);
    // Ningún número de cuatro o más dígitos, que es la forma de un precio.
    expect(texto).not.toMatch(/\d{4,}/);
  });

  it("hay UNA sola definición viva: la copia divergente no sobrevive", async () => {
    const vehicles = await import("@/lib/pricing/vehicles");
    expect("TRANSPORT_RULES" in vehicles).toBe(false);
  });
});
