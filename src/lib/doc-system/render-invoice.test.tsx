import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { CustomerInvoice, FiscalConfig } from "@/lib/invoicing/types";
import { InvoicePdfDocument } from "@/lib/pdf/InvoicePdfDocument";
import { pdfText, hasPhrase } from "@/lib/doc-system/pdf-text";

/**
 * Render de muestras del comprobante fiscal con el doc-system.
 * Smoke test de render + escritura opcional de PDFs (DOC_SAMPLES_OUT)
 * para validación visual contra la referencia de Dirección (REF-NC).
 */

const OUT = process.env.DOC_SAMPLES_OUT ?? "";

function maybeWrite(name: string, buf: Buffer) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

const CONFIG: FiscalConfig = {
  id: 1,
  razon_social: "Verotin S.A.",
  nombre_fantasia: "Logística TOPS",
  cuit: "33604896989",
  ingresos_brutos: "646677-10",
  inicio_actividades: "1985-01-01",
  domicilio_comercial: "Agustín Magaldi 1765",
  localidad: "Ciudad Autónoma de Buenos Aires",
  provincia: "CABA",
  condicion_iva: "RESPONSABLE_INSCRIPTO",
  ambiente: "SANDBOX",
  cert_alias: null,
  default_punto_venta: 2,
  logo_url: null,
  pie_legal:
    "No abonándose esta factura a su vencimiento devengará intereses punitorios a razón de la tasa bancaria actual. Cualquier reclamo u observación deberá efectuarse por escrito dentro de los 5 días hábiles de la fecha de recepción.",
  updated_at: "2026-07-13T00:00:00-03:00",
  updated_by: null,
};

const BASE: CustomerInvoice = {
  id: "inv-1",
  client_id: null,
  cuit_cliente: "30111111118",
  razon_social: "Cliente Demo S.R.L.",
  condicion_iva: "RESPONSABLE_INSCRIPTO",
  domicilio_cliente: null,
  doc_tipo: 80,
  tipo_comprobante: "NOTA_CREDITO_A",
  cbte_tipo_arca: 3,
  concepto: 2,
  punto_venta: 2,
  numero_comprobante: 23,
  fch_serv_desde: "2026-07-12T00:00:00-03:00",
  fch_serv_hasta: "2026-07-12T00:00:00-03:00",
  fch_vto_pago: null,
  periodo: "2026-07",
  cae: "70000000000001",
  fecha_vencimiento_cae: "2026-07-22T00:00:00-03:00",
  fecha_autorizacion_arca: "2026-07-13T00:00:00-03:00",
  qr_data: null,
  qr_url: "https://www.afip.gob.ar/fe/qr/?p=e30=",
  qr_hash: null,
  subtotal: 4_000_000,
  importe_no_gravado: 0,
  importe_exento: 0,
  iva: 840_000,
  percepciones: 0,
  tributos: 0,
  total: 4_840_000,
  moneda: "PES",
  cotizacion: 1,
  estado_arca: "AUTORIZADO_ARCA",
  request_arca: null,
  response_arca: null,
  ambiente: "SANDBOX",
  error_msg: null,
  comprobante_asociado_id: null,
  anulada: false,
  pdf_bucket: null,
  pdf_path: null,
  pdf_url: null,
  observ: "Según OS N° OS-000123 de fecha 13/7/2026.",
  emitido_por: null,
  created_at: "2026-07-13T12:00:00-03:00",
  updated_at: "2026-07-13T12:00:00-03:00",
  items: [
    {
      descripcion: "Autoelevador con uñas",
      cantidad: 5,
      precio_unitario: 79_000,
      alicuota_iva: 21,
      alic_iva_id: 5,
      importe_neto: 395_000,
      importe_iva: 82_950,
      importe_total: 477_950,
      orden: 1,
    },
    {
      descripcion: "Almacenamiento Cargas Generales · m²",
      cantidad: 200,
      precio_unitario: 20_000,
      alicuota_iva: 21,
      alic_iva_id: 5,
      importe_neto: 4_000_000,
      importe_iva: 840_000,
      importe_total: 4_840_000,
      orden: 2,
    },
    {
      descripcion: "Bonificación · Autoelevador con uñas",
      cantidad: 1,
      precio_unitario: -395_000,
      alicuota_iva: 21,
      alic_iva_id: 5,
      importe_neto: -395_000,
      importe_iva: -82_950,
      importe_total: -477_950,
      orden: 3,
    },
  ],
};

async function qr(): Promise<string> {
  return QRCode.toDataURL("https://www.afip.gob.ar/fe/qr/?p=e30=", { margin: 0, width: 240 });
}

describe("doc-system render invoice", () => {
  it("renderiza la Nota de Crédito A (sandbox, ítem negativo) — réplica REF-NC", async () => {
    const buf = await renderToBuffer(
      <InvoicePdfDocument invoice={BASE} config={CONFIG} qrDataUrl={await qr()} />
    );
    const txt = await pdfText(buf);
    // Datos fiscales que no pueden faltar en un comprobante ARCA.
    expect(hasPhrase(txt, "NOTA DE")).toBe(true);
    expect(hasPhrase(txt, "00002-00000023")).toBe(true);
    expect(hasPhrase(txt, "70000000000001")).toBe(true); // CAE
    expect(hasPhrase(txt, "22/07/2026")).toBe(true); // vencimiento del CAE
    expect(hasPhrase(txt, "30-11111111-8")).toBe(true); // CUIT del receptor
    expect(hasPhrase(txt, "4.840.000,00")).toBe(true); // total
    expect(hasPhrase(txt, "-395.000,00")).toBe(true); // ítem negativo preservado
    expect(hasPhrase(txt, "SANDBOX")).toBe(true); // ambiente no productivo señalizado
    maybeWrite("invoice-nc-a.pdf", buf);
  });

  it("renderiza una Factura A normal (producción)", async () => {
    const invoice: CustomerInvoice = {
      ...BASE,
      tipo_comprobante: "FACTURA_A",
      cbte_tipo_arca: 1,
      numero_comprobante: 1042,
      ambiente: "PRODUCCION",
      fch_vto_pago: "2026-08-12T00:00:00-03:00",
      items: (BASE.items ?? []).filter((i) => i.importe_neto > 0),
      subtotal: 4_395_000,
      iva: 922_950,
      total: 5_317_950,
    };
    const buf = await renderToBuffer(
      <InvoicePdfDocument
        invoice={invoice}
        config={{ ...CONFIG, ambiente: "PRODUCCION" }}
        qrDataUrl={await qr()}
      />
    );
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "FACTURA")).toBe(true);
    expect(hasPhrase(txt, "00002-00001042")).toBe(true);
    expect(hasPhrase(txt, "5.317.950,00")).toBe(true);
    expect(hasPhrase(txt, "SIN VALIDEZ FISCAL")).toBe(false);
    maybeWrite("invoice-fa-a.pdf", buf);
  });

  it("renderiza una Factura A en sandbox con el banner sin validez fiscal", async () => {
    const invoice: CustomerInvoice = {
      ...BASE,
      tipo_comprobante: "FACTURA_A",
      cbte_tipo_arca: 1,
      numero_comprobante: 7,
      ambiente: "SANDBOX",
    };
    const buf = await renderToBuffer(
      <InvoicePdfDocument invoice={invoice} config={CONFIG} qrDataUrl={await qr()} />
    );
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "SIN VALIDEZ FISCAL")).toBe(true);
    maybeWrite("invoice-fa-sandbox.pdf", buf);
  });

  it("marca el comprobante ANULADO de forma inequívoca y en todas las páginas", async () => {
    const invoice: CustomerInvoice = { ...BASE, anulada: true };
    const buf = await renderToBuffer(
      <InvoicePdfDocument invoice={invoice} config={CONFIG} qrDataUrl={await qr()} />
    );
    const txt = await pdfText(buf);
    // R4: la anulación tiene efecto fiscal y no puede quedar como un subtítulo
    // tenue en el encabezado.
    expect(hasPhrase(txt, "COMPROBANTE ANULADO")).toBe(true);
    expect(hasPhrase(txt, "SIN EFECTO FISCAL")).toBe(true);
    // El comprobante no anulado NO debe llevar el sello.
    const limpio = await pdfText(
      await renderToBuffer(
        <InvoicePdfDocument invoice={BASE} config={CONFIG} qrDataUrl={await qr()} />
      )
    );
    expect(hasPhrase(limpio, "COMPROBANTE ANULADO")).toBe(false);
    maybeWrite("invoice-anulada.pdf", buf);
  });

  it("renderiza una Nota de Débito A", async () => {
    const invoice: CustomerInvoice = {
      ...BASE,
      tipo_comprobante: "NOTA_DEBITO_A",
      cbte_tipo_arca: 2,
      numero_comprobante: 88,
      ambiente: "PRODUCCION",
      items: (BASE.items ?? []).filter((i) => i.importe_neto > 0),
      subtotal: 4_395_000,
      iva: 922_950,
      total: 5_317_950,
    };
    const buf = await renderToBuffer(
      <InvoicePdfDocument
        invoice={invoice}
        config={{ ...CONFIG, ambiente: "PRODUCCION" }}
        qrDataUrl={await qr()}
      />
    );
    const txt = await pdfText(buf);
    expect(hasPhrase(txt, "D\u00c9BITO")).toBe(true);
    expect(hasPhrase(txt, "00002-00000088")).toBe(true);
    maybeWrite("invoice-nd-a.pdf", buf);
  });
});
