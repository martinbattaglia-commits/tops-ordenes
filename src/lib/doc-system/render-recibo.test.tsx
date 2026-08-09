import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  ReciboPdfDocument,
  type ReciboData,
} from "@/lib/tesoreria/pdf/ReciboPdfDocument";
import { importeEnLetras } from "@/lib/tesoreria/pdf/importe-letras";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";

/**
 * Render de muestra del Recibo de cobranza con datos ficticios (patrón
 * render-samples.test.tsx). Si DOC_SAMPLES_OUT está definido escribe el PDF
 * para validación visual contra la referencia de Dirección (REF-RECIBO).
 */

const OUT = process.env.DOC_SAMPLES_OUT ?? "";

function maybeWrite(name: string, buf: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

const RECIBO_FIXTURE: ReciboData = {
  ingresosBrutos: "646677-10",
  numero: "REC-2026-000014",
  fecha: "24/07/2026",
  lugar: "CABA",
  moneda: "ARS",
  clienteRazon: "Distribuidora Demo S.A.",
  clienteCuit: "30-44444444-0",
  clienteDomicilio: "Av. Demo 1000 · CABA",
  comprobantes: [
    { comprobante: "Factura A 00003-00001234", fecha: "30/06/2026", importeImputado: 850_000 },
    { comprobante: "Factura A 00003-00001240", fecha: "07/07/2026", importeImputado: 400_000 },
  ],
  medioPago: "transferencia",
  bancoLinea: "Banco Demo · Cuenta Demo · demo.alias.cuenta",
  importeMedio: 1_215_000,
  retencion: 35_000,
  sumaImputada: 1_250_000,
  total: 1_250_000,
  observaciones: "Cancelación parcial cta. cte. junio/julio.",
  anulado: false,
};

describe("doc-system render recibo", () => {
  it("renderiza el Recibo con 2 comprobantes cancelados y transferencia", async () => {
    const buf = await renderToBuffer(ReciboPdfDocument({ data: RECIBO_FIXTURE }));
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "RECIBO")).toBe(true);
    expect(hasPhrase(txt, "REC-2026-000014")).toBe(true);
    expect(hasPhrase(txt, "30-44444444-0")).toBe(true);
    expect(hasPhrase(txt, "1.250.000")).toBe(true);
    expect(hasPhrase(txt, "646677-10")).toBe(true);
    expect(hasPhrase(txt, "DOCUMENTO NO VÁLIDO COMO FACTURA")).toBe(true);
    maybeWrite("recibo-sample.pdf", buf);
  });

  it("deriva el importe en letras sin inventar datos", () => {
    expect(importeEnLetras(1_250_000)).toBe(
      "Un millón doscientos cincuenta mil pesos con 00/100"
    );
    expect(importeEnLetras(1)).toBe("Un peso con 00/100");
    // Apócope: dos `.replace` anclados con `$` se pisaban y daba "veintiun".
    expect(importeEnLetras(21)).toBe("Veintiún pesos con 00/100");
    expect(importeEnLetras(121)).toBe("Ciento veintiún pesos con 00/100");
    expect(importeEnLetras(11)).toBe("Once pesos con 00/100");
    // Centavos: redondear después de `Math.floor` producía "con 100/100".
    expect(importeEnLetras(1.995)).toBe("Dos pesos con 00/100");
    expect(importeEnLetras(1.5)).toBe("Un peso con 50/100");
    // Múltiplo exacto de millón lleva preposición.
    expect(importeEnLetras(1_000_000)).toBe("Un millón de pesos con 00/100");
    expect(importeEnLetras(21_501.5)).toBe(
      "Veintiún mil quinientos un pesos con 50/100"
    );
    expect(importeEnLetras(0)).toBe("Cero pesos con 00/100");
  });
});
