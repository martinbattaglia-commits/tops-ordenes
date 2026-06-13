/**
 * QA visual del nuevo diseño de factura (Command Center).
 * Renderiza 2 PDFs de muestra SIN tocar la base:
 *  1. /tmp/factura-design-simple.pdf  — espejo de la factura real 2-3 (caso del handoff)
 *  2. /tmp/factura-design-larga.pdf   — 14 renglones (saltos de página + rail/footer fijos)
 * Ejecutar: npx tsx scripts/qa/render-factura-design.ts
 */
import React from "react";
// tsx compila JSX con el transform clásico fuera de Next — exponer React global.
(globalThis as { React?: typeof React }).React = React;
import { renderToFile } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { InvoicePdfDocument } from "../../src/lib/pdf/InvoicePdfDocument";
import type { CustomerInvoice, FiscalConfig, InvoiceItem } from "../../src/lib/invoicing/types";

const config: FiscalConfig = {
  id: 1,
  razon_social: "VEROTIN S.A.",
  nombre_fantasia: "Logística TOPS",
  cuit: "33-60489698-9",
  ingresos_brutos: "646677-10",
  inicio_actividades: "1985-03-01",
  domicilio_comercial: "Agustín Magaldi 1765",
  localidad: "CABA",
  provincia: "CABA",
  condicion_iva: "RESPONSABLE_INSCRIPTO",
  ambiente: "SANDBOX",
  cert_alias: null,
  default_punto_venta: 2,
  logo_url: null,
  pie_legal:
    "No abonándose esta factura a su vencimiento devengará intereses punitorios a razón de la tasa bancaria actual.",
  updated_at: new Date().toISOString(),
  updated_by: null,
};

function item(i: number, desc: string, neto: number): InvoiceItem {
  return {
    descripcion: desc,
    cantidad: 1,
    precio_unitario: neto,
    alicuota_iva: 21,
    alic_iva_id: 5,
    importe_neto: neto,
    importe_iva: Math.round(neto * 0.21 * 100) / 100,
    importe_total: Math.round(neto * 1.21 * 100) / 100,
    orden: i,
  };
}

function invoice(items: InvoiceItem[], nro: number): CustomerInvoice {
  const subtotal = items.reduce((a, i) => a + i.importe_neto, 0);
  const iva = Math.round(subtotal * 0.21 * 100) / 100;
  return {
    id: "qa-design",
    client_id: null,
    cuit_cliente: "33-60489698-9",
    razon_social: "Verotin SA",
    condicion_iva: "RESPONSABLE_INSCRIPTO",
    domicilio_cliente: "Magaldi 1765, CABA",
    doc_tipo: 80,
    tipo_comprobante: "FACTURA_A",
    cbte_tipo_arca: 1,
    concepto: 2,
    punto_venta: 2,
    numero_comprobante: nro,
    fch_serv_desde: "2026-06-01",
    fch_serv_hasta: "2026-06-01",
    fch_vto_pago: "2026-07-12",
    periodo: "2026-06",
    cae: "73866436956328",
    fecha_vencimiento_cae: "2026-06-22",
    fecha_autorizacion_arca: "2026-06-12T17:00:00Z",
    qr_data: null,
    qr_url: "https://www.afip.gob.ar/fe/qr/?p=TEST",
    qr_hash: null,
    subtotal,
    importe_no_gravado: 0,
    importe_exento: 0,
    iva,
    percepciones: 0,
    tributos: 0,
    total: Math.round((subtotal + iva) * 100) / 100,
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
    observ: null,
    emitido_por: null,
    created_at: "2026-06-12T15:00:00Z",
    updated_at: "2026-06-12T15:00:00Z",
    items,
  };
}

async function main() {
  const qrDataUrl = await QRCode.toDataURL("https://www.afip.gob.ar/fe/qr/?p=TEST", {
    margin: 1,
    color: { dark: "#0B1220", light: "#ffffff" },
    width: 300,
  });

  // Caso 1 — el del handoff (1 renglón, $854.260)
  const simple = invoice([item(0, "OS OS-201613 — 1/6/2026", 706000)], 3);
  await renderToFile(
    InvoicePdfDocument({ invoice: simple, config, qrDataUrl }),
    "/tmp/factura-design-simple.pdf"
  );
  console.log("✅ /tmp/factura-design-simple.pdf");

  // Caso 2 — factura larga (14 renglones, multipágina)
  const muchos = Array.from({ length: 14 }, (_, i) =>
    item(i, `OS OS-2016${20 + i} — Servicio logístico y almacenamiento ${i + 1}`, 125000 + i * 17500)
  );
  const larga = invoice(muchos, 99);
  await renderToFile(
    InvoicePdfDocument({ invoice: larga, config, qrDataUrl }),
    "/tmp/factura-design-larga.pdf"
  );
  console.log("✅ /tmp/factura-design-larga.pdf");
}

main();
