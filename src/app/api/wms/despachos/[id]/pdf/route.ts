import { NextResponse } from "next/server";
import { authorizeDocumentAccess, depotInScope } from "@/lib/doc-system/authz";
import { safeFilename } from "@/lib/doc-system/filename";
import { buildRemitoSalidaPdf, getRemitoSalidaData, MAX_LINEAS_REMITO } from "@/lib/wms/pdf/build";

/**
 * Remito de SALIDA on-demand (despachos WMS). Acepta id (uuid) o public_id
 * (DSP-2026-0001). Sin escritura a DB ni storage.
 *
 * Autorización explícita: la RLS de `shipments`, `logistics_orders` y
 * `stock_allocations` es `auth.role() = 'authenticated'`, insuficiente para un
 * documento que expone cliente, mercadería y transporte.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const authz = await authorizeDocumentAccess("wms.view", { scope: "internal" });
  if (!authz.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: authz.status });
  }

  try {
    const data = await getRemitoSalidaData(params.id);
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
          error: `Este remito supera las ${MAX_LINEAS_REMITO} líneas que se pueden emitir en un solo documento. Dividí la despacho o solicitá la emisión asistida.`,
          lineas: data.lineas.length,
          maximo: MAX_LINEAS_REMITO,
        },
        { status: 413 }
      );
    }
    const pdf = await buildRemitoSalidaPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename(`remito-salida-${data.numero}`)}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    console.error("remito-salida-pdf", { id: params.id, error: String(e) });
    return NextResponse.json({ error: "No se pudo generar el remito" }, { status: 500 });
  }
}
