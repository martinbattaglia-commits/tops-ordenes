import { NextResponse, type NextRequest } from "next/server";
import { getInvoice, getFiscalConfig } from "@/lib/invoicing/data";
import { buildInvoicePdf } from "@/lib/pdf/build";
import { COMPROBANTE_LETRA } from "@/lib/invoicing/types";

// react-pdf requiere node runtime (no edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoice = await getInvoice(params.id);
  if (!invoice) {
    return new NextResponse("Comprobante no encontrado", { status: 404 });
  }
  if (invoice.estado_arca !== "AUTORIZADO_ARCA") {
    return new NextResponse(
      "El comprobante aún no fue autorizado por ARCA — sin PDF fiscal.",
      { status: 409 }
    );
  }

  const config = await getFiscalConfig();
  const buf = await buildInvoicePdf(invoice, config);

  const letra = COMPROBANTE_LETRA[invoice.tipo_comprobante];
  const filename = `FAC-${letra}-${String(invoice.punto_venta).padStart(
    5,
    "0"
  )}-${String(invoice.numero_comprobante ?? 0).padStart(8, "0")}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
