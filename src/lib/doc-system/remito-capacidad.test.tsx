import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { RemitoEntradaPdfDocument } from "@/lib/wms/pdf/RemitoEntradaPdfDocument";
import { MAX_LINEAS_REMITO } from "@/lib/wms/pdf/build";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";

/**
 * Capacidad del remito (R3).
 *
 * El render es superlineal en la cantidad de líneas y la función serverless
 * corta a los 10 s, así que la ruta rechaza por encima de `MAX_LINEAS_REMITO`
 * en vez de truncar. Acá se verifica que:
 *   · dentro del tope se emiten TODAS las líneas (no se pierde ninguna);
 *   · el render en el tope entra cómodo en el presupuesto de tiempo.
 */

const BASE = {
  numero: "REC-2026-0007",
  fecha: "24/07/2026",
  horaArribo: "10:35",
  deposito: "Magaldi · CABA",
  depot: { label: "Magaldi · CABA", address: "Agustín Magaldi 1765 (C1286AFM)", depotCode: "MAGALDI" },
  referencia: null,
  remitenteRazon: "Laboratorio Demo S.A.",
  remitenteCuit: null,
  remitoOrigen: null,
  ordenServicio: null,
  transportista: "Transporte Demo",
  chofer: "Chofer Demo",
  dni: null,
  dominio: "AA000AA",
  observaciones: null,
  productoAnmat: true,
};

const linea = (i: number) => ({
  descripcion: `Producto de prueba ${i}`,
  sku: `DEMO-${String(i).padStart(4, "0")}`,
  lote: `L-${24000 + i}`,
  bultos: null,
  unidades: String(100 + i),
});

function conLineas(n: number) {
  return { ...BASE, lineas: Array.from({ length: n }, (_, i) => linea(i + 1)) };
}

describe("capacidad del remito", () => {
  it("emite todas las líneas dentro del tope, sin truncar", async () => {
    const n = 120;
    const buf = await renderToBuffer(
      RemitoEntradaPdfDocument({ data: conLineas(n) }) as never
    );
    const txt = await pdfText(buf);
    // La primera, una del medio y la última tienen que estar.
    expect(hasPhrase(txt, "DEMO-0001")).toBe(true);
    expect(hasPhrase(txt, `DEMO-${String(Math.floor(n / 2)).padStart(4, "0")}`)).toBe(true);
    expect(hasPhrase(txt, `DEMO-${String(n).padStart(4, "0")}`)).toBe(true);
  });

  it("renderiza el tope de capacidad dentro del presupuesto serverless", async () => {
    const t0 = Date.now();
    const buf = await renderToBuffer(
      RemitoEntradaPdfDocument({ data: conLineas(MAX_LINEAS_REMITO) }) as never
    );
    const ms = Date.now() - t0;
    // El límite de la función es 10 s. Se exige margen: el tope debe rendir
    // muy por debajo, porque la lambda es más lenta que la máquina de CI.
    expect(buf.byteLength).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(5_000);
  });
});
