import { google, type drive_v3 } from "googleapis";
import { JWT } from "google-auth-library";

/**
 * Cliente Google Drive — Service Account based.
 *
 * Configuración:
 *   1. En Google Cloud Console → IAM → Service accounts → crear nueva.
 *   2. Crear key JSON, descargar y pegar contenido en env var:
 *      `GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`
 *      (línea única, escapada). Alternativamente apuntar a archivo:
 *      `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
 *   3. Compartir carpeta raíz de Drive con el email de la service account
 *      (formato: `nombre@proyecto.iam.gserviceaccount.com`) con permiso editor.
 *   4. Setear `GOOGLE_DRIVE_ROOT_FOLDER_ID` con el ID de la carpeta
 *      (de la URL: drive.google.com/drive/folders/<ID>).
 */

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
];

let driveCached: drive_v3.Drive | null = null;
let serviceAccountEmail: string | null = null;

function getCredentials(): { email: string; key: string } | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { client_email: string; private_key: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return { email: parsed.client_email, key: parsed.private_key };
  } catch (e) {
    console.error("[drive] GOOGLE_SERVICE_ACCOUNT_JSON inválido:", (e as Error).message);
    return null;
  }
}

export function isDriveConfigured(): boolean {
  return getCredentials() !== null && Boolean(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

function getDriveSync(): drive_v3.Drive | null {
  if (driveCached) return driveCached;
  const creds = getCredentials();
  if (!creds) return null;
  const auth = new JWT({
    email: creds.email,
    key: creds.key,
    scopes: SCOPES,
  });
  driveCached = google.drive({ version: "v3", auth });
  serviceAccountEmail = creds.email;
  return driveCached;
}

export function getServiceAccountEmail(): string | null {
  if (serviceAccountEmail) return serviceAccountEmail;
  const creds = getCredentials();
  return creds?.email ?? null;
}

export class DriveError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "DriveError";
  }
}

function requireDrive(): drive_v3.Drive {
  const drive = getDriveSync();
  if (!drive) throw new DriveError("Google Drive no configurado (GOOGLE_SERVICE_ACCOUNT_JSON)", 503);
  return drive;
}

// ------------------------------------------------------------------
// Folder helpers
// ------------------------------------------------------------------

/**
 * Busca un folder por nombre dentro de un parent. Si no existe lo crea.
 * Cachea por path para que llamadas repetidas no re-consulten.
 */
const folderCache = new Map<string, string>();

export async function ensureFolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  const drive = requireDrive();
  const safeName = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let folderId = res.data.files?.[0]?.id;
  if (!folderId) {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    folderId = created.data.id ?? undefined;
    if (!folderId) throw new DriveError(`No se pudo crear folder "${name}"`);
  }

  folderCache.set(cacheKey, folderId);
  return folderId;
}

/**
 * Asegura la jerarquía `root/year/month/vendor` y devuelve el ID del folder más profundo.
 * En formato: `/Órdenes de Compra 2026/Mayo/Pallets Sur S.R.L./`
 */
export async function ensureVendorFolderPath(opts: {
  rootFolderId: string;
  year: number;
  monthName: string;
  vendorName: string;
}): Promise<string> {
  const yearFolder = await ensureFolder(`${opts.year}`, opts.rootFolderId);
  const monthFolder = await ensureFolder(opts.monthName, yearFolder);
  const vendorFolder = await ensureFolder(opts.vendorName, monthFolder);
  return vendorFolder;
}

// ------------------------------------------------------------------
// Upload
// ------------------------------------------------------------------

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink: string | null;
  webContentLink: string | null;
  size: string | null;
  mimeType: string | null;
}

export async function uploadPdf(opts: {
  name: string;
  folderId: string;
  buffer: Buffer;
  description?: string;
}): Promise<DriveUploadResult> {
  const drive = requireDrive();
  const { Readable } = await import("stream");
  const stream = Readable.from(opts.buffer);

  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.folderId],
      mimeType: "application/pdf",
      description: opts.description,
    },
    media: {
      mimeType: "application/pdf",
      body: stream,
    },
    fields: "id, name, webViewLink, webContentLink, size, mimeType",
    supportsAllDrives: true,
  });

  return {
    id: res.data.id ?? "",
    name: res.data.name ?? opts.name,
    webViewLink: res.data.webViewLink ?? null,
    webContentLink: res.data.webContentLink ?? null,
    size: res.data.size ?? null,
    mimeType: res.data.mimeType ?? null,
  };
}

// ------------------------------------------------------------------
// Diagnostic
// ------------------------------------------------------------------

export interface DrivePing {
  ok: true;
  serviceAccountEmail: string;
  rootFolderId: string;
  rootFolderName: string | null;
  rootShared: boolean;
}

export async function ping(): Promise<DrivePing> {
  const drive = requireDrive();
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootId) throw new DriveError("GOOGLE_DRIVE_ROOT_FOLDER_ID no configurado", 503);

  const res = await drive.files.get({
    fileId: rootId,
    fields: "id, name, capabilities/canEdit, mimeType, ownedByMe",
    supportsAllDrives: true,
  });

  const data = res.data as drive_v3.Schema$File & { capabilities?: { canEdit?: boolean } };
  return {
    ok: true,
    serviceAccountEmail: getServiceAccountEmail() ?? "?",
    rootFolderId: rootId,
    rootFolderName: data.name ?? null,
    rootShared: Boolean(data.capabilities?.canEdit),
  };
}

// ------------------------------------------------------------------
// Browser / listing — usado por la sección DRIVE TOPS
// ------------------------------------------------------------------

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  parents: string[];
}

export interface DriveBreadcrumb {
  id: string;
  name: string;
}

const PAGE_SIZE_DEFAULT = 200;

function mapEntry(f: drive_v3.Schema$File): DriveEntry {
  return {
    id: f.id ?? "",
    name: f.name ?? "(sin nombre)",
    mimeType: f.mimeType ?? "",
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
    size: f.size ? Number(f.size) : null,
    modifiedAt: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null,
    iconLink: f.iconLink ?? null,
    parents: f.parents ?? [],
  };
}

/**
 * Lista hijos directos de un folder. Si folderId es undefined usa el root
 * configurado. Folders primero, luego archivos por modifiedTime desc.
 */
export async function listChildren(
  folderId?: string,
  opts: { pageSize?: number; query?: string } = {}
): Promise<DriveEntry[]> {
  const drive = requireDrive();
  const target =
    folderId && folderId.trim().length > 0
      ? folderId
      : process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!target) throw new DriveError("Sin folder de referencia (root no seteado)", 503);

  const q = opts.query?.trim();
  const baseQ = `'${target}' in parents and trashed=false`;
  const fullQ = q
    ? `${baseQ} and name contains '${q.replace(/'/g, "\\'")}'`
    : baseQ;

  const res = await drive.files.list({
    q: fullQ,
    fields:
      "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, parents)",
    orderBy: "folder,modifiedTime desc",
    pageSize: opts.pageSize ?? PAGE_SIZE_DEFAULT,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files ?? []).map(mapEntry);
}

/**
 * Búsqueda global por nombre dentro del Drive accesible por la service account.
 * Devuelve un mix de folders + files, máx pageSize entradas.
 */
export async function searchFiles(
  query: string,
  pageSize = 30
): Promise<DriveEntry[]> {
  if (!query.trim()) return [];
  const drive = requireDrive();
  const safe = query.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name contains '${safe}' and trashed=false`,
    fields:
      "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, parents)",
    orderBy: "modifiedTime desc",
    pageSize,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map(mapEntry);
}

/**
 * Reconstruye breadcrumbs desde el root hasta el folder dado.
 * Si el folder está fuera del root, devuelve solo el folder + sus ancestros directos.
 */
export async function getBreadcrumbs(folderId: string): Promise<DriveBreadcrumb[]> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const crumbs: DriveBreadcrumb[] = [];
  let current: string | undefined = folderId;
  let safety = 0;
  while (current && safety < 12) {
    safety += 1;
    const got = await drive.files.get({
      fileId: current,
      fields: "id, name, parents",
      supportsAllDrives: true,
    });
    const data: drive_v3.Schema$File = got.data;
    crumbs.unshift({ id: data.id ?? current, name: data.name ?? "(sin nombre)" });
    if (root && data.id === root) break;
    current = data.parents?.[0];
  }
  return crumbs;
}

/**
 * Top documentos modificados recientemente — útil como widget "Recientes".
 */
export async function listRecent(limit = 10): Promise<DriveEntry[]> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const q = root
    ? `'${root}' in parents and trashed=false`
    : "trashed=false";
  const res = await drive.files.list({
    q,
    fields:
      "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, parents)",
    orderBy: "modifiedTime desc",
    pageSize: limit,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map(mapEntry);
}
