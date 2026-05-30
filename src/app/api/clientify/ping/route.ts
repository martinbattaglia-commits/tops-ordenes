import { NextResponse } from "next/server";
import { ping, ClientifyError } from "@/lib/clientify/client";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clientify/ping
 *
 * Endpoint de diagnóstico: chequea que la API key esté configurada y
 * devuelve un snapshot mínimo del tenant (counts + nombre). Usado por
 * la UI del pipeline para mostrar estado de sync.
 *
 * Respuesta exitosa (200):
 *   { ok: true, contactsCount, dealsCount, pipelinesCount, tenant }
 *
 * Respuesta error (4xx/5xx):
 *   { ok: false, error, status }
 */
export async function GET() {
  if (!env.clientify.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "CLIENTIFY_API_KEY no configurada",
        hint: "Pegá la key en .env.local o en las env vars de Netlify",
      },
      { status: 503 }
    );
  }

  try {
    const result = await ping();
    return NextResponse.json({
      ...result,
      checkedAt: new Date().toISOString(),
      baseUrl: env.clientify.baseUrl,
    });
  } catch (e) {
    if (e instanceof ClientifyError) {
      return NextResponse.json(
        { ok: false, error: e.message, status: e.status, path: e.path },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 }
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
