import { NextResponse, type NextRequest } from "next/server";
import { authorizeDocumentAccess, clientInScope } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { getInvoice, getFiscalConfig } from "@/lib/invoicing/data";
import { buildInvoicePdf } from "@/lib/pdf/build";
import { COMPROBANTE_LETRA } from "@/lib/invoicing/types";

/**
 * Comprobante fiscal (factura / nota) on-demand.
 *
 * Autorización explícita (R2-d): hasta ahora la ruta se apoyaba sólo en la
 * sesión del middleware y en la RLS de `customer_invoices`. `analytics.view`
 * es el mismo permiso que ya gatea el módulo /billing
 * (`src/app/(app)/billing/layout.tsx`), de modo que la API no queda más
 * abierta que la UI que la ofrece.
 *
 * ── Eliminación del oráculo documental ──────────────────────────────────────
 * La versión anterior distinguía tres respuestas para un `id` cualquiera:
 *   404 → el comprobante no existe
 *   409 → existe pero ARCA todavía no lo autorizó
 *   200 → existe y está autorizado
 * Eso convertía la ruta en un oráculo: enumerando uuids se podía inferir qué
 * comprobantes existen y cuáles están pendientes de CAE, sin ver el PDF.
 *
 * Ahora la distinción 409 vs 200 sólo la ve quien YA pasó permiso y ámbito.
 * Para todos los demás, inexistente y fuera de ámbito colapsan en el MISMO
 * 404 con el MISMO cuerpo.
 */

// react-pdf requiere node runtime (no edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuerpo único del 404: no existe y fuera de ámbito son indistinguibles. */
const NO_ENCONTRADO = "Comprobante no encontrado";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authz = await authorizeDocumentAccess("analytics.view");
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const invoice = await getInvoice(params.id);
    // Ámbito: un usuario del portal sólo alcanza los comprobantes de su
    // cliente. Fail-closed también cuando el comprobante no declara cliente.
    if (!invoice || !clientInScope(authz.scope, invoice.client_id ?? null)) {
      return new NextResponse(NO_ENCONTRADO, { status: 404 });
    }

    // A partir de acá el solicitante ya está autorizado Y en ámbito: recién
    // entonces tiene sentido — y es seguro — distinguir el estado fiscal.
    if (invoice.estado_arca !== "AUTORIZADO_ARCA") {
      return new NextResponse(
        "El comprobante aún no fue autorizado por ARCA — sin PDF fiscal.",
        { status: 409 }
      );
    }

    const config = await getFiscalConfig();
    const buf = await buildInvoicePdf(invoice, config);

    const letra = COMPROBANTE_LETRA[invoice.tipo_comprobante];
    const filename = safeFilename(
      `FAC-${letra}-${String(invoice.punto_venta).padStart(5, "0")}-${String(
        invoice.numero_comprobante ?? 0
      ).padStart(8, "0")}`,
      "comprobante"
    );

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    // Sin contenido documental en el log: sólo el identificador del request.
    console.error("comprobante-fiscal-pdf", { id: params.id, error: String(e) });
    return NextResponse.json({ error: "No se pudo generar el documento" }, { status: 500 });
  }
}
