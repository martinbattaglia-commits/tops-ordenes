import { NextResponse } from "next/server";
import { authorizeDocumentAccess, depotInScope } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { buildRemitoEntradaPdf, getRemitoEntradaData, MAX_LINEAS_REMITO } from "@/lib/wms/pdf/build";

/**
 * Remito de ENTRADA on-demand (recepciones WMS). Acepta id (uuid) o public_id
 * (REC-2026-0001). Sin escritura a DB ni storage.
 *
 * Autorización explícita: la RLS de `receptions` y `reception_items` es
 * `auth.role() = 'authenticated'`, de modo que el middleware de sesión por sí
 * solo dejaría que cualquier usuario del ERP enumere `public_id` secuenciales
 * y baje el documento de cualquier cliente.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const authz = await authorizeDocumentAccess("wms.view", { scope: "internal" });
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const data = await getRemitoEntradaData(params.id);
    // Ámbito: un jefe acotado a un depósito no alcanza documentos de otro.
    // Se responde igual que "no existe" para no revelar la existencia del
    // documento a quien no lo alcanza.
    if (!data || !depotInScope(authz.scope, data.depot?.depotCode ?? null)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Capacidad: por encima del tope se rechaza con un error explícito en vez
    // de truncar líneas o dejar que la función muera por timeout.
    if (data.lineas.length > MAX_LINEAS_REMITO) {
      console.warn("remito-excede-capacidad", {
        id: params.id,
        lineasAlMenos: data.lineas.length,
        tope: MAX_LINEAS_REMITO,
      });
      return NextResponse.json(
        {
          error: `Este remito supera las ${MAX_LINEAS_REMITO} líneas que se pueden emitir en un solo documento. Dividí la recepción o solicitá la emisión asistida.`,
          lineas: data.lineas.length,
          maximo: MAX_LINEAS_REMITO,
        },
        { status: 413 }
      );
    }
    const pdf = await buildRemitoEntradaPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename(`remito-entrada-${data.numero}`)}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    console.error("remito-entrada-pdf", { id: params.id, error: String(e) });
    return NextResponse.json({ error: "No se pudo generar el remito" }, { status: 500 });
  }
}
