import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { PoPdfDocument } from "./PoPdfDocument";
import type { PurchaseOrder } from "@/lib/types-po";
import { env } from "@/lib/env";

/**
 * Render server-side de la OC a buffer PDF. Embebe firma (si hay) y QR
 * apuntando a la URL pública de verificación.
 */
export async function buildPoPdf(po: PurchaseOrder, signatureDataUrl?: string | null): Promise<Buffer> {
  const url = `${env.app.url}/compras/validar/${encodeURIComponent(po.public_id)}`;
  const qr = await QRCode.toDataURL(url, {
    margin: 1,
    width: 200,
    color: { dark: "#050555", light: "#FFFFFF" },
  });
  return renderToBuffer(
    PoPdfDocument({ po, signatureDataUrl, qrDataUrl: qr }) as unknown as React.ReactElement
  );
}
