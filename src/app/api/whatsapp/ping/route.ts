import { NextResponse } from "next/server";
import { ping, isWhatsappConfigured } from "@/lib/whatsapp/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/ping
 * Diagnóstico del número configurado: display phone, verified name, quality rating.
 */
export async function GET() {
  if (!isWhatsappConfigured()) {
    return NextResponse.json(
      { ok: false, error: "WhatsApp Meta no configurado" },
      { status: 503 }
    );
  }
  const result = await ping();
  return NextResponse.json(
    { ...result, checkedAt: new Date().toISOString() },
    { status: result.ok ? 200 : 502 }
  );
}
