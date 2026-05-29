import { NextResponse } from "next/server";
import { ping, isDriveConfigured, DriveError } from "@/lib/drive/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/ping
 *
 * Verifica que la service account de Google Drive está configurada y tiene
 * permisos sobre la carpeta raíz. Devuelve el email de la service account
 * (compartilo con la carpeta de Drive).
 */
export async function GET() {
  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Drive no configurado",
        hint: "Setea GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_DRIVE_ROOT_FOLDER_ID en .env.local",
      },
      { status: 503 }
    );
  }

  try {
    const result = await ping();
    return NextResponse.json({ ...result, checkedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        { ok: false, error: e.message },
        { status: e.status ?? 502 }
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
