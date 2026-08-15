import { NextResponse, type NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { authorizeDocumentAccess, clientInScope } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { getOrder } from "@/lib/data/orders";
import { env } from "@/lib/env";
import { OrderPdfDocument } from "@/lib/pdf/OrderPdfDocument";

/**
 * Orden de Servicio on-demand. Acepta id (uuid) o public_id (OS-2026-0001).
 *
 * Autorización explícita (R2-d): hasta ahora la ruta se apoyaba sólo en la
 * sesión del middleware y en la RLS de `orders`, permisiva para cualquier
 * `authenticated`. Cualquier usuario del ERP podía enumerar `public_id`
 * secuenciales y bajar la OS de cualquier cliente, con su CUIT y domicilio.
 *
 * `servicios.view` se concede TAMBIÉN a `cliente_b2b` a propósito: el portal
 * debe poder ver SU orden. Por eso NO se pide `scope: "internal"` y el
 * aislamiento entre clientes lo hace `clientInScope`.
 */

// Forzamos node runtime — react-pdf no corre en edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cuerpo único del 404. "No existe" y "existe pero no lo alcanzás" deben ser
 * indistinguibles: si difirieran, la ruta sería un oráculo de existencia de
 * órdenes ajenas.
 */
const NO_ENCONTRADA = "Orden no encontrada";

export async function GET(
  _req: NextRequest,
  { params }: { params: { publicId: string } }
) {
  const authz = await authorizeDocumentAccess("servicios.view");
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const order = await getOrder(params.publicId);
    // Ámbito: un usuario del portal sólo alcanza las órdenes de su cliente.
    // Se responde igual que "no existe" para no revelar la existencia del
    // documento a quien no lo alcanza.
    if (!order || !clientInScope(authz.scope, order.client_id ?? null)) {
      return new NextResponse(NO_ENCONTRADA, { status: 404 });
    }

    const publicUrl = `${env.app.url}/orders/${order.public_id}`;
    const qrDataUrl = await QRCode.toDataURL(publicUrl, {
      margin: 1,
      color: { dark: "#050555", light: "#ffffff" },
      width: 280,
    });

    const doc = OrderPdfDocument({ order, qrDataUrl });
    const stream = await renderToStream(doc);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      );
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    const buf = Buffer.concat(chunks);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename(order.public_id)}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    // Sin contenido documental en el log: sólo el identificador del request.
    console.error("orden-servicio-pdf", { publicId: params.publicId, code: "ORDER_PDF_FAILED" });
    return NextResponse.json({ error: "No se pudo generar el documento" }, { status: 500 });
  }
}
