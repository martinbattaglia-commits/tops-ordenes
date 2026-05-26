import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { OrderPdfDocument } from "@/lib/pdf/OrderPdfDocument";
import { env } from "@/lib/env";
import type { Order } from "@/lib/types";

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
