import { NextResponse } from "next/server";
import { getPublicVersion } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/version  (PÚBLICO)
 *
 * Diagnóstico mínimo de despliegue: { version (SHA corto), builtAt, environment }.
 * NO expone el SHA completo, la branch ni el contexto interno de infraestructura
 * — esa metadata completa queda solo en Administración → Versión y trazabilidad
 * (autenticado, RBAC). Ver docs/runbooks/RELEASE.md.
 */
export async function GET() {
  return NextResponse.json({
    ...getPublicVersion(),
    servedAt: new Date().toISOString(),
  });
}
