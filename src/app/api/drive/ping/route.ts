import { NextResponse } from "next/server";
import { checkDriveEnv, pingDrive } from "@/lib/google-drive";

// Esta ruta hace una llamada de red a Google → forzamos runtime Node.js y
// renderizado dinámico para que NO se intente prerenderizar en build.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/ping
 *
 * Valida que las tres variables de entorno estén presentes y prueba una
 * conexión real a Google Drive contra la carpeta raíz configurada.
 *
 * Respuestas:
 *   200 → { success: true,  connected: true,  ... }
 *   500 → { success: false, connected: false, error, env }
 *   400 → { success: false, connected: false, env, missing: [...] } si faltan vars
 */
export async function GET() {
  const env = checkDriveEnv();

  if (!env.ok) {
    const missing: string[] = [];
    if (!env.clientEmail) missing.push("GOOGLE_CLIENT_EMAIL");
    if (!env.privateKey) missing.push("GOOGLE_PRIVATE_KEY");
    if (!env.folderId) missing.push("GOOGLE_DRIVE_FOLDER_ID");

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: `Faltan variables de entorno: ${missing.join(", ")}`,
        env,
        missing,
        checkedAt: new Date().toISOString(),
      },
      { status: 400 }
    );
  }

  const result = await pingDrive();

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: result.error,
        env,
        checkedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      connected: true,
      folderId: result.folderId,
      folderName: result.folderName,
      env,
      checkedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}
