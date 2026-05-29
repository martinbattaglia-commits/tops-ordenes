/**
 * Helper de Google Drive con Service Account.
 *
 * Variables de entorno requeridas (Netlify · Builds + Functions + Runtime):
 *  - GOOGLE_CLIENT_EMAIL   → email de la service account
 *  - GOOGLE_PRIVATE_KEY    → clave privada PEM (con \n escapados)
 *  - GOOGLE_DRIVE_FOLDER_ID→ ID de la carpeta raíz a leer
 *
 * Solo backend (route handlers / server components). NO importar desde código
 * cliente: la clave privada NO debe llegar al bundle del browser.
 */

import { google, type drive_v3 } from "googleapis";

export type DriveEnvCheck = {
  clientEmail: boolean;
  privateKey: boolean;
  folderId: boolean;
  /** true si las tres están presentes */
  ok: boolean;
};

export type DriveConfig = {
  clientEmail: string;
  privateKey: string;
  folderId: string;
};

/**
 * Reporta presencia/ausencia de cada variable sin filtrarlas al cliente.
 * Útil para `/api/drive/ping` y la página `/drive`.
 */
export function checkDriveEnv(): DriveEnvCheck {
  const clientEmail = Boolean(process.env.GOOGLE_CLIENT_EMAIL?.trim());
  const privateKey = Boolean(process.env.GOOGLE_PRIVATE_KEY?.trim());
  const folderId = Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID?.trim());
  return {
    clientEmail,
    privateKey,
    folderId,
    ok: clientEmail && privateKey && folderId,
  };
}

/**
 * Lee y devuelve la configuración tipada. Lanza error si falta algo.
 * No llamar desde código cliente.
 */
export function getDriveConfig(): DriveConfig {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

  if (!clientEmail) throw new Error("Falta GOOGLE_CLIENT_EMAIL");
  if (!privateKeyRaw) throw new Error("Falta GOOGLE_PRIVATE_KEY");
  if (!folderId) throw new Error("Falta GOOGLE_DRIVE_FOLDER_ID");

  // En Netlify la private key se guarda con \n escapados (literal "\\n"),
  // los newlines reales se preservan también — soportamos ambos casos.
  const privateKey = privateKeyRaw.includes("\\n")
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : privateKeyRaw;

  return { clientEmail, privateKey, folderId };
}

/**
 * Construye un cliente de Drive autenticado con la Service Account.
 * Scope: drive.readonly (sólo lectura).
 */
export function getDriveClient(config?: DriveConfig): drive_v3.Drive {
  const cfg = config ?? getDriveConfig();
  const jwt = new google.auth.JWT({
    email: cfg.clientEmail,
    key: cfg.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth: jwt });
}

export type DrivePingResult = {
  success: boolean;
  connected: boolean;
  folderId?: string;
  folderName?: string;
  error?: string;
};

/**
 * Intenta conectar a Google Drive y leer la metadata de la carpeta raíz.
 * Pensado para el endpoint `/api/drive/ping`.
 */
export async function pingDrive(): Promise<DrivePingResult> {
  try {
    const cfg = getDriveConfig();
    const drive = getDriveClient(cfg);
    const meta = await drive.files.get({
      fileId: cfg.folderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
    return {
      success: true,
      connected: true,
      folderId: meta.data.id ?? cfg.folderId,
      folderName: meta.data.name ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { success: false, connected: false, error: message };
  }
}
