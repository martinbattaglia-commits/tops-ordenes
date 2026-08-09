import { NextResponse } from "next/server";
import { authorizeDocumentAccess } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { buildReciboPdf, getReciboData } from "@/lib/tesoreria/pdf/build";

/**
 * Recibo de cobranza on-demand (customer_receipts, 0053). Acepta id (uuid) o
 * public_id (REC-2026-000001 — prefijo compartido con recepciones WMS; acá se
 * consulta exclusivamente customer_receipts). Sin escritura a DB ni storage.
 *
 * Autorización con el permiso canónico del módulo, `tesoreria.view`, el mismo
 * que exige el layout de Tesorería. Al vivir bajo /api la ruta no hereda ese
 * layout, y el documento expone CUIT, domicilio y alias/CBU.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const authz = await authorizeDocumentAccess("tesoreria.view", { scope: "internal" });
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const data = await getReciboData(params.id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pdf = await buildReciboPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename(`recibo-${data.numero}`)}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    console.error("recibo-pdf", { id: params.id, error: String(e) });
    return NextResponse.json({ error: "No se pudo generar el recibo" }, { status: 500 });
  }
}
