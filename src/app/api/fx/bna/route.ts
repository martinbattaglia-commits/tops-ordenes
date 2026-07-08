import { NextResponse } from "next/server";
import { getBnaDollar } from "@/lib/fx/bna-dollar";

export const runtime = "nodejs";
// El provider cachea (módulo + Data Cache); igual dejamos que el route revalide
// para no recomputar en cada hit. 600 s = 10 min.
export const revalidate = 600;

/**
 * GET /api/fx/bna — cotización del dólar Banco Nación (venta).
 * Forma de respuesta estable (consumible por otras superficies):
 *   { source, pair, type, sell, buy, updatedAt, stale, status }
 * 200 cuando hay dato (fresco o stale); 503 cuando no hay dato disponible.
 */
export async function GET() {
  const q = await getBnaDollar();
  const httpStatus = q.status === "unavailable" ? 503 : 200;
  return NextResponse.json(
    {
      source: q.source,
      pair: q.pair,
      type: q.type,
      sell: q.sell,
      buy: q.buy,
      updatedAt: q.updatedAt,
      stale: q.stale,
      status: q.status,
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      },
    }
  );
}
