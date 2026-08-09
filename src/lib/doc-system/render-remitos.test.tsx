import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";
import {
  RemitoEntradaPdfDocument,
  type RemitoEntradaData,
} from "@/lib/wms/pdf/RemitoEntradaPdfDocument";
import {
  RemitoSalidaPdfDocument,
  type RemitoSalidaData,
} from "@/lib/wms/pdf/RemitoSalidaPdfDocument";

/**
 * Render de muestras de los remitos WMS con datos ficticios (patrón
 * render-samples.test.tsx). Si DOC_SAMPLES_OUT está definido escribe los PDF
 * para validación visual contra las referencias de Dirección (REF-REMITO).
 */

const OUT = process.env.DOC_SAMPLES_OUT ?? "";

function maybeWrite(name: string, buf: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

const ENTRADA_MAGALDI: RemitoEntradaData = {
  numero: "REC-2026-0007",
  fecha: "24/07/2026",
  horaArribo: "10:35",
  depot: { label: "Magaldi · CABA", address: "Agustín Magaldi 1765 (C1286AFM)", depotCode: "MAGALDI" },
  remitenteRazon: "Laboratorio Demo S.A.",
  remitoOrigen: "R-0099123",
  referencia: "OC-4471",
  transportista: "Transporte Demo",
  chofer: "Chofer Demo",
  dominio: "AA000AA",
  lineas: [
    {
      descripcion: "Crema dermatológica 30 g",
      sku: "DEMO-3301",
      lote: "L-24081",
      bultos: null,
      unidades: "1.200",
    },
    {
      descripcion: "Gel post solar 200 ml",
      sku: "DEMO-2210",
      lote: "L-24102",
      bultos: null,
      unidades: "480",
    },
    {
      descripcion: "Protector solar FPS 50 · 150 ml",
      sku: "DEMO-1150",
      lote: "L-24115",
      bultos: null,
      unidades: "960",
    },
  ],
  observaciones: null,
  productoAnmat: true,
};

const SALIDA_LUJAN: RemitoSalidaData = {
  numero: "DSP-2026-0012",
  fecha: "25/07/2026",
  horaSalida: "14:20",
  depot: { label: "Pedro Luján · CABA", address: "Pedro de Luján 3159", depotCode: "LUJAN" },
  destinatarioRazon: "Farmacéutica Demo S.R.L.",
  ordenServicio: "PED-2026-0031",
  transportista: "Transporte Demo Sur",
  chofer: null,
  dominio: "AA111AA",
  lineas: [
    {
      descripcion: "Alcohol en gel 500 ml",
      sku: "DEMO-0500",
      lote: "L-24050",
      bultos: null,
      unidades: "720",
    },
    {
      descripcion: "Barbijo tricapa caja x50",
      sku: "DEMO-0850",
      lote: null,
      bultos: null,
      unidades: "300",
    },
  ],
  observaciones: "Entrega en depósito del cliente · turno tarde.",
  conformeDestinatario: null,
};

describe("doc-system render remitos", () => {
  it("renderiza el Remito de Entrada (Magaldi, con líneas)", async () => {
    const buf = await renderToBuffer(
      RemitoEntradaPdfDocument({ data: ENTRADA_MAGALDI })
    );
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "REMITO DE")).toBe(true);
    expect(hasPhrase(txt, "DOCUMENTO NO VÁLIDO COMO FACTURA")).toBe(true);
    maybeWrite("remito-entrada-sample.pdf", buf);
  });

  it("renderiza el Remito de Salida (Pedro Luján)", async () => {
    const buf = await renderToBuffer(
      RemitoSalidaPdfDocument({ data: SALIDA_LUJAN })
    );
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "REMITO DE")).toBe(true);
    expect(hasPhrase(txt, "DOCUMENTO NO VÁLIDO COMO FACTURA")).toBe(true);
    maybeWrite("remito-salida-sample.pdf", buf);
  });
});
