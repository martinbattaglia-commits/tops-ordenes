import { NextResponse, type NextRequest } from "next/server";
import {
  listChildren,
  searchFiles,
  getBreadcrumbs,
  listRecent,
  isDriveConfigured,
  DriveError,
} from "@/lib/drive/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/list?folderId=...&search=...&recent=1
 *
 * Devuelve hijos directos del folder solicitado (o root si no se pasa).
 * Si `search` está presente hace búsqueda global por nombre.
 * Si `recent=1` devuelve los últimos 10 modificados (ignora folderId).
 *
 * Respuesta: { ok, entries, breadcrumbs, configured }
 */
export async function GET(req: NextRequest) {
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
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId") ?? undefined;
  const search = url.searchParams.get("search") ?? "";
  const recent = url.searchParams.get("recent") === "1";

  try {
    if (recent) {
      const entries = await listRecent(15);
      return NextResponse.json({
        ok: true,
        configured: true,
        entries,
        breadcrumbs: [],
      });
    }
    if (search.trim()) {
      const entries = await searchFiles(search, 40);
      return NextResponse.json({
        ok: true,
        configured: true,
        entries,
        breadcrumbs: [],
        searchActive: true,
      });
    }

    const [entries, breadcrumbs] = await Promise.all([
      listChildren(folderId),
      folderId ? getBreadcrumbs(folderId) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      ok: true,
      configured: true,
      entries,
      breadcrumbs,
    });
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        { ok: false, configured: true, error: e.message, entries: [], breadcrumbs: [] },
        { status: e.status ?? 502 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : String(e),
        entries: [],
        breadcrumbs: [],
      },
      { status: 502 }
    );
  }
}
