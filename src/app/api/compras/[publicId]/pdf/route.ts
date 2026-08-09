import { NextResponse } from "next/server";
import { authorizeDocumentAccess, depotInScope } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { getPurchaseOrder } from "@/lib/compras/data";
import { buildPoPdf } from "@/lib/compras/pdf/build";

/**
 * Orden de Compra on-demand. Acepta id (uuid) o public_id (OC-2026-0348).
 *
 * Autorización explícita (R2-d): hasta ahora la ruta se apoyaba sólo en la
 * sesión del middleware y en la RLS de `purchase_orders`, permisiva para
 * cualquier `authenticated`. El documento expone proveedor, CUIT, precios
 * unitarios y condiciones de pago — el pricing de compra de la empresa.
 *
 * `scope: "internal"` porque una OC NO es un documento del cliente: ningún
 * usuario del portal tiene por qué alcanzarla.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { publicId: string } }
) {
  const authz = await authorizeDocumentAccess("compras.view", { scope: "internal" });
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const po = await getPurchaseOrder(params.publicId);
    // Ámbito: un jefe acotado a un depósito no alcanza OC de otro. Se responde
    // igual que "no existe" para no revelar la existencia del documento a
    // quien no lo alcanza.
    if (!po || !depotInScope(authz.scope, po.depot ?? null)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pdf = await buildPoPdf(po);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename(po.public_id)}.pdf"`,
        // Antes `max-age=300`: una vez que la ruta exige permiso, cachear 5
        // minutos deja servir el PDF desde el browser aun después de revocarlo.
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    // Sin contenido documental en el log: sólo el identificador del request.
    console.error("orden-compra-pdf", { publicId: params.publicId, error: String(e) });
    return NextResponse.json({ error: "No se pudo generar el documento" }, { status: 500 });
  }
}
