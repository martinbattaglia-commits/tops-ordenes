import { NextResponse } from "next/server";
import { getTodayInfo } from "@/lib/ejecutivo/today";

export const runtime = "nodejs";
// La fecha/hora se calcula por request; el clima se cachea 15 min vía fetch.
export const dynamic = "force-dynamic";

/**
 * GET /api/today
 *
 * Contexto ejecutivo del día: fecha/hora local (CABA) + clima actual de Open-Meteo.
 * Sin parámetros, sin auth (no expone datos sensibles ni cuota de API key).
 */
export async function GET() {
  const info = await getTodayInfo();
  return NextResponse.json(info);
}
