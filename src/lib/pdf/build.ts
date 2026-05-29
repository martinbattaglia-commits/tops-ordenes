import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { OrderPdfDocument } from "@/lib/pdf/OrderPdfDocument";
import { InvoicePdfDocument } from "@/lib/pdf/InvoicePdfDocument";
import { env } from "@/lib/env";
import type { Order } from "@/lib/types";
import type { CustomerInvoice, FiscalConfig } from "@/lib/invoicing/types";

/**
 * Genera el PDF de una orden server-side y devuelve el Buffer listo
 * para subir a storage o servir en una response.
 */
export async function buildOrderPdf(order: Order): Promise<Buffer> {
  const publicUrl = `${env.app.url}/orders/${order.public_id}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    margin: 1,
    color: { dark: "#050555", light: "#ffffff" },
    width: 280,
  });
  const doc = OrderPdfDocument({ order, qrDataUrl });
  return renderToBuffer(doc);
}

/**
 * Genera el PDF fiscal de un comprobante autorizado. El QR codifica la URL
 * de verificación de ARCA (invoice.qr_url) tal cual exige RG 4892/2020.
 */
export async function buildInvoicePdf(
  invoice: CustomerInvoice,
  config: FiscalConfig
): Promise<Buffer> {
  const qrContent = invoice.qr_url ?? "";
  const qrDataUrl = qrContent
    ? await QRCode.toDataURL(qrContent, {
        margin: 1,
        color: { dark: "#0B1220", light: "#ffffff" },
        width: 300,
      })
    : "";
  const doc = InvoicePdfDocument({ invoice, config, qrDataUrl });
  return renderToBuffer(doc);
}
