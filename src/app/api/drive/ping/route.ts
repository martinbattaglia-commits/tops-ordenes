import { NextResponse, type NextRequest } from "next/server";
import { ping, isDriveConfigured, DriveError } from "@/lib/drive/client";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { requireDrivePermission } from "@/lib/rbac/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ping es diagnóstico — límite agresivo para evitar abuso (un usuario que pinguea
// constante para mapear cuando Drive entra/sale de configuración).
const RL_LIMIT = 20;
const RL_WINDOW_MS = 60_000;

function safeRequestId(raw: string | null): string {
  if (raw && /^[a-zA-Z0-9_\-]{1,64}$/.test(raw)) return raw;
  return `drive-ping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * GET /api/drive/ping
 *
 * Verifica que la service account de Google Drive está configurada y tiene
 * permisos sobre la carpeta raíz.
 *
 * Auth: requiere sesión + permiso `compliance.view`.
 * Rate-limit: 20 req/min por IP.
 */
export async function GET(req: NextRequest) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const rl = rateLimit(`drive-ping:${clientKey(ip)}`, {
    limit: RL_LIMIT,
    windowMs: RL_WINDOW_MS,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Rate limit excedido",
        retryAfterMs: rl.retryAfterMs,
        requestId,
      },
      {
        status: 429,
        headers: {
          "x-request-id": requestId,
          "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      }
    );
  }

  const auth = await requireDrivePermission(req, "compliance.view", requestId);
  if (auth instanceof NextResponse) return auth;

  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Drive no configurado",
        hint: "Setea GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_DRIVE_ROOT_FOLDER_ID en el entorno",
        requestId,
      },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }

  try {
    const result = await ping();
    return NextResponse.json(
      { ...result, checkedAt: new Date().toISOString(), requestId },
      { headers: { "x-request-id": requestId } }
    );
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        { ok: false, error: e.message, requestId },
        { status: e.status ?? 502, headers: { "x-request-id": requestId } }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        requestId,
      },
      { status: 502, headers: { "x-request-id": requestId } }
    );
  }
}
