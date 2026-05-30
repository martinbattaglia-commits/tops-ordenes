import { NextResponse, type NextRequest } from "next/server";
import {
  listChildren,
  searchFiles,
  getBreadcrumbs,
  listRecent,
  isDriveConfigured,
  DriveError,
} from "@/lib/drive/client";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { requireDrivePermission } from "@/lib/rbac/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Límite efectivo: 60 requests por minuto por IP. Suficiente para uso humano
// del browser (incluso con paginación + búsqueda interactiva ~5 req/min típico)
// y bloquea automation casera o bucles accidentales que saturan la cuota Drive
// de la SA (1.000 req/100seg por usuario en Drive API).
const RL_LIMIT = 60;
const RL_WINDOW_MS = 60_000;

// Sanitiza request-id del cliente para evitar log injection (R6 — cierre
// proactivo en este turno aunque no estaba en A1/A2; trivial).
function safeRequestId(raw: string | null): string {
  if (raw && /^[a-zA-Z0-9_\-]{1,64}$/.test(raw)) return raw;
  return `drive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * GET /api/drive/list
 *
 * Query params:
 *   · folderId  → carpeta a listar (default: root)
 *   · pageToken → cursor para paginar resultados (devuelto en `nextPageToken`)
 *   · pageSize  → 1..200 (default 50)
 *   · search    → modo búsqueda por nombre (ignora folderId)
 *   · recent=1  → últimos N archivos modificados (ignora folderId/search)
 *   · bounded=0 → permite búsqueda fuera del root (default true = solo dentro)
 *
 * Respuesta:
 *   { ok, configured, entries[], breadcrumbs[], nextPageToken?, searchActive?, bounded?, rootScoped? }
 */
export async function GET(req: NextRequest) {
  const requestId = safeRequestId(req.headers.get("x-request-id"));

  // R3: rate limit por IP. 60 req/min.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const rl = rateLimit(`drive-list:${clientKey(ip)}`, {
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

  // R4: RBAC server-side. Requiere compliance.view (Drive TOPS está bajo Compliance).
  const auth = await requireDrivePermission(req, "compliance.view", requestId);
  if (auth instanceof NextResponse) return auth;

  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        entries: [],
        breadcrumbs: [],
        error: "Drive no configurado",
        hint:
          "Setea GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_DRIVE_ROOT_FOLDER_ID en el entorno",
        requestId,
      },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId") ?? undefined;
  const pageToken = url.searchParams.get("pageToken") ?? undefined;
  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
  const search = url.searchParams.get("search") ?? "";
  const recent = url.searchParams.get("recent") === "1";
  const bounded = url.searchParams.get("bounded") !== "0";

  try {
    if (recent) {
      const entries = await listRecent(15, { bounded });
      return NextResponse.json(
        {
          ok: true,
          configured: true,
          entries,
          breadcrumbs: [],
          requestId,
        },
        { headers: { "x-request-id": requestId } }
      );
    }
    if (search.trim()) {
      const result = await searchFiles(search, { pageSize: pageSize ?? 40, bounded });
      return NextResponse.json(
        {
          ok: true,
          configured: true,
          entries: result.entries,
          breadcrumbs: [],
          searchActive: true,
          bounded: result.bounded,
          rootScoped: result.rootScoped,
          requestId,
        },
        { headers: { "x-request-id": requestId } }
      );
    }

    const [page, breadcrumbs] = await Promise.all([
      listChildren(folderId, { pageSize, pageToken }),
      folderId ? getBreadcrumbs(folderId) : Promise.resolve([]),
    ]);
    return NextResponse.json(
      {
        ok: true,
        configured: true,
        entries: page.entries,
        breadcrumbs,
        nextPageToken: page.nextPageToken,
        requestId,
      },
      { headers: { "x-request-id": requestId } }
    );
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          error: e.message,
          entries: [],
          breadcrumbs: [],
          requestId,
        },
        { status: e.status ?? 502, headers: { "x-request-id": requestId } }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : String(e),
        entries: [],
        breadcrumbs: [],
        requestId,
      },
      { status: 502, headers: { "x-request-id": requestId } }
    );
  }
}
