/**
 * R-9 · Una sola fuente de verdad por concepto.
 *
 * `pricing/service-ui.ts` se creó copiando de `services-catalog.ts`, y la
 * copia divergió en tres puntos que llegan a la pantalla:
 *
 *  · `unitLabel` pasó de abreviaturas invariables ("hs", "pal", "un") a
 *    palabras en singular ("hora", "pallet", "unidad"), de modo que el wizard
 *    escribe "3 hora", "5 pallet" y "2 unidad".
 *  · La clave de categoría `admin` fue renombrada a `otros`, y como el
 *    catálogo sigue clasificando dos servicios como `admin`, el lookup falla
 *    y caen a un fallback que titula la sección con la clave cruda en
 *    minúscula.
 *  · Las definiciones originales quedaron sin consumidores, vivas y
 *    divergentes: exactamente la condición en que un cambio se pierde sin que
 *    nadie lo note.
 */
import { describe, expect, it } from "vitest";
import { SERVICE_CATEGORIES, unitLabel } from "@/lib/pricing/service-ui";
import { SERVICES_CATALOG } from "@/lib/services-catalog";

describe("R-9 · unitLabel no fuerza un plural incorrecto", () => {
  it("las unidades abreviadas sirven para cualquier cantidad", () => {
    // "3 hs" es correcto; "3 hora" no lo es. La abreviatura es invariable a
    // propósito: la UI la concatena con la cantidad sin poder pluralizarla.
    expect(unitLabel("hs")).toBe("hs");
    expect(unitLabel("pal")).toBe("pal");
    expect(unitLabel("un")).toBe("un");
  });

  it("conserva las unidades que ya eran correctas", () => {
    expect(unitLabel("km")).toBe("km");
    expect(unitLabel("mes")).toBe("mes");
    expect(unitLabel("m2")).toBe("m²");
    expect(unitLabel("m3")).toBe("m³");
  });

  it("una unidad desconocida se devuelve tal cual, sin inventar", () => {
    expect(unitLabel("qq")).toBe("qq");
  });
});

describe("R-9 · toda categoría del catálogo tiene su rótulo", () => {
  it("ningún servicio cae a un fallback con la clave cruda", () => {
    const claves = new Set<string>(SERVICE_CATEGORIES.map((c) => c.key));
    const huerfanas = [
      ...new Set(
        SERVICES_CATALOG.map((s) => String(s.category)).filter((c) => !claves.has(c)),
      ),
    ].sort();
    expect(huerfanas).toEqual([]);
  });

  it("la categoría administrativa conserva su clave y su rótulo", () => {
    const admin = SERVICE_CATEGORIES.find((c) => c.key === "admin");
    expect(admin).toBeDefined();
    expect(admin?.label).toBe("Administrativos");
  });

  it("los dos servicios administrativos del catálogo quedan rotulados", () => {
    const admins = SERVICES_CATALOG.filter((s) => s.category === "admin").map((s) => s.slug);
    expect(admins).toContain("admin-in");
    expect(admins).toContain("admin-out");
  });
});

describe("R-9 · no quedan definiciones duplicadas vivas", () => {
  it("services-catalog ya no reexporta los conceptos de presentación", async () => {
    const catalogo = await import("@/lib/services-catalog");
    expect("unitLabel" in catalogo).toBe(false);
    expect("SERVICE_CATEGORIES" in catalogo).toBe(false);
  });
});
