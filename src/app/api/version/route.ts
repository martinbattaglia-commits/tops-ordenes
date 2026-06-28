import { NextResponse } from "next/server";
import { getVersion } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/version
 *
 * Trazabilidad de despliegue: identifica EXACTAMENTE qué build está publicado.
 * Solo expone metadata de build (commit, branch, fecha, buildId, entorno) — sin
 * datos sensibles ni secretos —, por eso es público (útil para verificar deploys
 * y monitoreo externo). La misma info se muestra en Administración (RBAC).
 */
export async function GET() {
  return NextResponse.json({
    ...getVersion(),
    servedAt: new Date().toISOString(),
  });
}
