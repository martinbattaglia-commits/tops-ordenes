import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { getLibroIvaCompras, type LibroIvaFilters } from "@/lib/erp/libro-iva-data";
import {
  buildLibroIvaCsv,
  buildLibroIvaXlsx,
  libroIvaFileName,
} from "@/lib/erp/libro-iva-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilters(searchParams: URLSearchParams): LibroIvaFilters {
  const alic = searchParams.get("alicuota");
  return {
    desde: searchParams.get("desde") || null,
    hasta: searchParams.get("hasta") || null,
    vendorId: searchParams.get("vendorId") || null,
    cuit: searchParams.get("cuit") || null,
    alicuota: alic != null && alic !== "" ? Number(alic) : null,
    costCenterId: searchParams.get("costCenterId") || null,
  };
}

export async function GET(req: NextRequest) {
  // Gate: exportar requiere cuentas_pagar.export.
  const check = await checkPermission(req, "cuentas_pagar.export");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "csv").toLowerCase();
  const filters = parseFilters(searchParams);

  let result;
  try {
    result = await getLibroIvaCompras(filters);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al generar el libro" },
      { status: 500 }
    );
  }

  if (format === "xlsx") {
    const buf = await buildLibroIvaXlsx(result);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${libroIvaFileName(filters, "xlsx")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Default: CSV UTF-8 con BOM.
  const csv = buildLibroIvaCsv(result);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${libroIvaFileName(filters, "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
