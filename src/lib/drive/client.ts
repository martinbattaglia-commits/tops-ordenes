import { google, type drive_v3 } from "googleapis";
import { JWT } from "google-auth-library";

/**
 * Cliente Google Drive — Service Account based.
 *
 * Configuración:
 *   1. En Google Cloud Console → IAM → Service accounts → crear nueva.
 *   2. Crear key JSON, descargar y pegar contenido en env var:
 *      `GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`
 *      (línea única, escapada).
 *   3. Compartir carpetas de Drive con el email de la service account
 *      (formato: `nombre@proyecto.iam.gserviceaccount.com`):
 *        · Lector  — Compliance Engine + Drive TOPS browser (lectura)
 *        · Editor  — solo carpetas donde NEXUS sube PDFs (módulo Compras OC)
 *   4. Setear `GOOGLE_DRIVE_ROOT_FOLDER_ID` con el ID de la carpeta raíz
 *      (de la URL: drive.google.com/drive/folders/<ID>).
 *
 * Scopes mínimos aplicados (principio de menor privilegio):
 *   · drive.readonly — listar/leer todo lo compartido con la SA
 *   · drive.file     — crear archivos solo en folders compartidos como editor
 *
 * NO se usa `https://www.googleapis.com/auth/drive` (full read/write/delete)
 * porque concede más permiso del necesario. Si en el futuro NEXUS tiene que
 * BORRAR archivos en Drive, evaluar agregar scope específico y rotar SA.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

let driveCached: drive_v3.Drive | null = null;
let serviceAccountEmail: string | null = null;
// Map<`${parentId}/${name}`, folderId> — caché in-process del lookup ensureFolder.
const folderCache = new Map<string, string>();

/**
 * Reset del cache del cliente Drive. Útil tras rotar la SA o cambiar env vars
 * sin reiniciar el proceso. Llamable desde un endpoint admin / health-check.
 */
export function resetDriveCache(): void {
  driveCached = null;
  serviceAccountEmail = null;
  folderCache.clear();
}

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
// Structured logging
// ------------------------------------------------------------------
//
// Formato JSON one-line en stdout — compatible con cualquier log shipper
// (Netlify Logs, Logflare, Datadog, Sentry breadcrumbs).
//   { ts, level, mod: "drive", op, ms, ok, err?, ...meta }
//
// En F4 se reemplaza por adapter pluggable (envió real a Sentry).

type LogLevel = "info" | "warn" | "error";

interface LogMeta {
  op: string;
  ms?: number;
  ok?: boolean;
  err?: string;
  // dato libre por operación (folderId, query, count)
  [k: string]: unknown;
}

function logDrive(level: LogLevel, meta: LogMeta): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    mod: "drive",
    ...meta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Wrap async ops para medir duración + capturar errores con structured logging.
 * Re-lanza el error sin tocarlo (caller mantiene el control del flow).
 */
async function timed<T>(op: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const out = await fn();
    logDrive("info", { op, ms: Date.now() - start, ok: true, ...meta });
    return out;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logDrive("error", { op, ms: Date.now() - start, ok: false, err, ...meta });
    throw e;
  }
}

// ------------------------------------------------------------------
// Folder helpers
// ------------------------------------------------------------------

/**
 * Busca un folder por nombre dentro de un parent. Si no existe lo crea.
 * Cachea por path para que llamadas repetidas no re-consulten.
 */
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

  return timed("ping", { rootId }, async () => {
    const res = await drive.files.get({
      fileId: rootId,
      // canRead = lectura mínima, canEdit = escritura, ownedByMe = propietario.
      // Con SA leemos un share: ownedByMe será false y canRead/canEdit indican el nivel.
      fields: "id, name, capabilities/canRead, capabilities/canEdit, mimeType, ownedByMe",
      supportsAllDrives: true,
    });

    const data = res.data as drive_v3.Schema$File & {
      capabilities?: { canRead?: boolean; canEdit?: boolean };
    };
    return {
      ok: true,
      serviceAccountEmail: getServiceAccountEmail() ?? "?",
      rootFolderId: rootId,
      rootFolderName: data.name ?? null,
      // "rootShared" = true si la SA tiene al menos lectura confirmada por Drive.
      rootShared: Boolean(data.capabilities?.canRead ?? data.capabilities?.canEdit),
    };
  });
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

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// fields() reutilizable — single source of truth de qué metadata pedimos.
const FILE_FIELDS =
  "files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, parents)";

/**
 * Escape de literales en Google Drive Query Language.
 * Doc: https://developers.google.com/drive/api/guides/search-files#query_string_examples
 * Solo `'` y `\` son metacaracteres dentro de un string literal.
 */
function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

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

export interface ListChildrenPage {
  entries: DriveEntry[];
  nextPageToken: string | null;
  total: number; // count en esta página, no global (Drive API no devuelve total)
}

/**
 * Lista hijos directos de un folder, con paginación.
 * Si folderId es undefined usa el root configurado.
 * Folders primero, luego archivos por modifiedTime desc.
 *
 * SCOPE ENFORCEMENT (R1, remediation 2026-05-29):
 *   Si `folderId` es provisto y distinto del root, valida con `isUnderRoot()`
 *   que ese folder esté dentro del subtree autorizado. Falla con 403 si NO.
 *   Esto impide enumerar carpetas accesibles por la SA fuera del scope NEXUS.
 */
export async function listChildren(
  folderId?: string,
  opts: { pageSize?: number; pageToken?: string; query?: string } = {}
): Promise<ListChildrenPage> {
  const drive = requireDrive();
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const trimmedFolder = folderId?.trim();
  const target = trimmedFolder && trimmedFolder.length > 0 ? trimmedFolder : rootId;
  if (!target) throw new DriveError("Sin folder de referencia (root no seteado)", 503);

  // Guard de scope: si el caller pidió un folder distinto del root, debe estar
  // dentro del subtree del root. Cubre R1.
  if (trimmedFolder && trimmedFolder !== rootId) {
    const allowed = await isUnderRoot(trimmedFolder);
    if (!allowed) {
      logDrive("warn", { op: "listChildren.scope-denied", folderId: trimmedFolder });
      throw new DriveError("Folder fuera del scope autorizado", 403);
    }
  }

  const q = opts.query?.trim();
  const baseQ = `'${escapeDriveQuery(target)}' in parents and trashed=false`;
  const fullQ = q ? `${baseQ} and name contains '${escapeDriveQuery(q)}'` : baseQ;

  const pageSize = Math.min(Math.max(opts.pageSize ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

  return timed("listChildren", { target, hasQuery: !!q, pageSize }, async () => {
    const res = await drive.files.list({
      q: fullQ,
      fields: `nextPageToken, ${FILE_FIELDS}`,
      orderBy: "folder,modifiedTime desc",
      pageSize,
      pageToken: opts.pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const entries = (res.data.files ?? []).map(mapEntry);
    return {
      entries,
      nextPageToken: res.data.nextPageToken ?? null,
      total: entries.length,
    };
  });
}

/**
 * Búsqueda por nombre dentro del Drive accesible por la service account.
 *
 * IMPORTANTE — alcance:
 *   · Google Drive API NO soporta búsqueda recursiva nativa por ancestro.
 *   · Por default acotamos a archivos cuyo PARENT DIRECTO está dentro del root,
 *     o cuyo parent[0] coincide con uno de los hijos directos del root.
 *   · Si `bounded=false`, hace búsqueda global en TODO el Drive accesible
 *     por la SA (puede incluir archivos compartidos de otras orgs).
 *
 * Para búsqueda recursiva profunda, ver `searchRecursive` (no implementado v1).
 */
export async function searchFiles(
  query: string,
  opts: { pageSize?: number; bounded?: boolean } = {}
): Promise<{ entries: DriveEntry[]; bounded: boolean; rootScoped: boolean }> {
  if (!query.trim()) return { entries: [], bounded: false, rootScoped: false };
  const drive = requireDrive();
  const safe = escapeDriveQuery(query);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 30, 1), PAGE_SIZE_MAX);
  const bounded = opts.bounded ?? true;
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  return timed("searchFiles", { q: query, bounded, pageSize }, async () => {
    // Si tenemos rootId y queremos bounded, hacemos primero el listado de
    // hijos directos del root para filtrar resultados que estén en ese set.
    let rootChildrenIds: Set<string> | null = null;
    if (bounded && rootId) {
      const rootKids = await drive.files.list({
        q: `'${escapeDriveQuery(rootId)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
        fields: "files(id)",
        pageSize: PAGE_SIZE_MAX,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      rootChildrenIds = new Set((rootKids.data.files ?? []).map((f) => f.id ?? ""));
      rootChildrenIds.add(rootId); // incluir el root mismo
    }

    const res = await drive.files.list({
      q: `name contains '${safe}' and trashed=false`,
      fields: FILE_FIELDS,
      orderBy: "modifiedTime desc",
      pageSize,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    let entries = (res.data.files ?? []).map(mapEntry);

    if (rootChildrenIds) {
      // Filter: keep solo los que tengan al menos un parent en el set.
      // Cubre 2 niveles (root y nietos directos). Para más profundidad
      // habría que caminar el árbol — v2.
      entries = entries.filter((e) =>
        e.parents.some((p) => rootChildrenIds!.has(p))
      );
    }

    return {
      entries,
      bounded,
      rootScoped: Boolean(rootChildrenIds),
    };
  });
}

/**
 * Reconstruye breadcrumbs desde el root hasta el folder dado.
 * Si el folder está fuera del root, devuelve solo el folder + sus ancestros directos.
 * Guard de 12 niveles por safety + structured log.
 *
 * SCOPE ENFORCEMENT (R2, remediation 2026-05-29):
 *   Valida con `isUnderRoot()` que el folderId esté dentro del subtree
 *   autorizado. Falla con 403 si NO. Impide reconstruir paths de carpetas
 *   ajenas accesibles por la SA.
 */
export async function getBreadcrumbs(folderId: string): Promise<DriveBreadcrumb[]> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const trimmed = folderId?.trim();
  if (!trimmed) return [];

  // Guard de scope: el folder debe estar bajo el root configurado. Cubre R2.
  if (trimmed !== root) {
    const allowed = await isUnderRoot(trimmed);
    if (!allowed) {
      logDrive("warn", { op: "getBreadcrumbs.scope-denied", folderId: trimmed });
      throw new DriveError("Folder fuera del scope autorizado", 403);
    }
  }

  return timed("getBreadcrumbs", { folderId: trimmed }, async () => {
    const crumbs: DriveBreadcrumb[] = [];
    let current: string | undefined = trimmed;
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
    if (safety === 12) {
      logDrive("warn", { op: "getBreadcrumbs", folderId: trimmed, err: "depth-cap-12-reached" });
    }
    return crumbs;
  });
}

/**
 * Top documentos modificados recientemente.
 *
 * Estrategia:
 *   · Query global (no acotada por parents) para captar modifs en subcarpetas profundas.
 *   · Filter out folders del resultado (queremos archivos modificados, no carpetas).
 *   · Si `bounded=true` (default) y hay root configurado, filtra a los que tengan
 *     parent directo en el root o en uno de los hijos directos del root.
 *
 * Trade-off vs versión anterior:
 *   · Antes: solo top-level del root (perdía modificaciones en subcarpetas).
 *   · Ahora: captura modificaciones en profundidad pero 1 query extra por bounded.
 */
export async function listRecent(
  limit = 10,
  opts: { bounded?: boolean } = {}
): Promise<DriveEntry[]> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const bounded = opts.bounded ?? true;
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  return timed("listRecent", { limit: safeLimit, bounded, hasRoot: !!root }, async () => {
    // Si bounded + root: precarga IDs de hijos directos del root para filtro.
    let scopeIds: Set<string> | null = null;
    if (bounded && root) {
      const rootKids = await drive.files.list({
        q: `'${escapeDriveQuery(root)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
        fields: "files(id)",
        pageSize: PAGE_SIZE_MAX,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      scopeIds = new Set((rootKids.data.files ?? []).map((f) => f.id ?? ""));
      scopeIds.add(root);
    }

    // Drive no admite `mimeType !=` con NOT en algunos casos; usamos exclusión
    // post-query para simplicidad.
    const res = await drive.files.list({
      q: "trashed=false",
      fields: FILE_FIELDS,
      orderBy: "modifiedTime desc",
      // Pedimos más entries del límite para tener colchón post-filter.
      pageSize: Math.min(safeLimit * 4, PAGE_SIZE_MAX),
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    let entries = (res.data.files ?? []).map(mapEntry).filter((e) => !e.isFolder);

    if (scopeIds) {
      entries = entries.filter((e) => e.parents.some((p) => scopeIds!.has(p)));
    }

    return entries.slice(0, safeLimit);
  });
}

/**
 * Verifica si un archivo o folder está dentro del subtree del root configurado.
 * Util para validación post-query y para enforce de scope en endpoints sensibles.
 * Camina hacia arriba hasta `maxDepth` niveles.
 */
export async function isUnderRoot(fileId: string, maxDepth = 6): Promise<boolean> {
  const drive = requireDrive();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root) return false;
  if (fileId === root) return true;

  let current: string | undefined = fileId;
  for (let i = 0; i < maxDepth && current; i += 1) {
    const got = await drive.files.get({
      fileId: current,
      fields: "id, parents",
      supportsAllDrives: true,
    });
    const parents: string[] = got.data.parents ?? [];
    if (parents.includes(root)) return true;
    current = parents[0];
  }
  return false;
}

// ==================================================================
// SYNC — lectura recursiva, descarga y export
// (módulo CRM Comercial → Contratos · ingesta diaria desde Drive)
// ==================================================================
//
// Reutiliza la MISMA service account, cliente y logging que el resto del módulo.
// No crea una integración nueva: agrega las operaciones de lectura profunda y
// descarga/export que el motor de sincronización contractual necesita.

/** Metadata extendida para detección de cambios (incluye md5Checksum). */
const SYNC_FILE_FIELDS =
  "files(id, name, mimeType, size, modifiedTime, md5Checksum, webViewLink, parents, trashed)";

export interface DriveSyncEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  modifiedAt: string | null;
  /** Checksum MD5 de Drive (sólo archivos binarios; null en Google-native). */
  md5Checksum: string | null;
  webViewLink: string | null;
  parents: string[];
}

function mapSyncEntry(f: drive_v3.Schema$File): DriveSyncEntry {
  return {
    id: f.id ?? "",
    name: f.name ?? "(sin nombre)",
    mimeType: f.mimeType ?? "",
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
    size: f.size ? Number(f.size) : null,
    modifiedAt: f.modifiedTime ?? null,
    md5Checksum: (f as drive_v3.Schema$File & { md5Checksum?: string }).md5Checksum ?? null,
    webViewLink: f.webViewLink ?? null,
    parents: f.parents ?? [],
  };
}

/**
 * Resuelve una carpeta por ruta de NOMBRES desde un parent (default: root de la SA).
 * Ej.: findFolderByPath(["Comercial","Cynthia","Clientes"]). Devuelve el id de la
 * carpeta más profunda, o null si algún tramo no existe.
 */
export async function findFolderByPath(parts: string[], fromFolderId?: string): Promise<string | null> {
  const drive = requireDrive();
  let current = (fromFolderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "").trim();
  if (!current) return null;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const res = await drive.files.list({
      q: `'${escapeDriveQuery(current)}' in parents and name='${escapeDriveQuery(part)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const id = res.data.files?.[0]?.id;
    if (!id) return null;
    current = id;
  }
  return current;
}

/** Nombre de un archivo/carpeta por id (metadata mínima). NO aplica el guard de root:
 *  pensado para contenedores configurados explícitamente (Contratos), que viven fuera
 *  del root de la SA. */
export async function getFileName(fileId: string): Promise<string | null> {
  const drive = requireDrive();
  const res = await drive.files.get({ fileId, fields: "name", supportsAllDrives: true });
  return res.data.name ?? null;
}

/**
 * Resuelve la(s) carpeta(s) contenedora(s) de Contratos: id(s) directo(s) de env
 * (CONTRATOS_DRIVE_FOLDER_ID, separados por coma), o por ruta de nombres.
 *
 * Cada contenedor es una carpeta de CATEGORÍA («CLIENTES DE ANMAT», «CLIENTES
 * CARGAS GENERALES»…) cuyos hijos directos son los dossiers de cliente.
 *
 * IMPORTANTE: NO degrada al root de la Service Account. Ese root es la carpeta de
 * Compliance (AGENCIA GUBERNAMENTAL DE CONTROL); caer ahí hacía que el sync de
 * Contratos ingiriera el árbol equivocado en silencio (docs ANMAT como "contratos")
 * y se reportara verde. Si no resuelve, devuelve { ids: [] } y el motor falla fuerte.
 */
export async function resolveContratosFolderIds(): Promise<{
  ids: string[];
  via: "env-id" | "path" | "none";
}> {
  // 1) ID(s) explícito(s) en env: se confía (secreto de servidor, no input de usuario).
  //    Sólo requiere que la SA tenga acceso (carpeta compartida como Lector). NO se exige
  //    que estén bajo el root: la carpeta de clientes vive en otro subtree (Comercial/…).
  const directRaw = process.env.CONTRATOS_DRIVE_FOLDER_ID?.trim();
  if (directRaw) {
    const ids = directRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) return { ids, via: "env-id" };
  }
  // 2) Resolución por ruta de NOMBRES desde el root de la SA (un solo contenedor).
  const subpath = (process.env.CONTRATOS_DRIVE_PATH?.trim() || "Comercial/Cynthia/Clientes")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const byPath = subpath.length ? await findFolderByPath(subpath) : null;
  if (byPath) return { ids: [byPath], via: "path" };
  // 3) Sin id ni ruta resuelta → NO caer al root (= carpeta de Compliance). Misconfig.
  return { ids: [], via: "none" };
}

/** Lista todos los hijos directos de un folder (paginado completo) con metadata de sync. */
export async function listFolderForSync(folderId: string): Promise<DriveSyncEntry[]> {
  const drive = requireDrive();
  const out: DriveSyncEntry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${escapeDriveQuery(folderId)}' in parents and trashed=false`,
      fields: `nextPageToken, ${SYNC_FILE_FIELDS}`,
      pageSize: PAGE_SIZE_MAX,
      pageToken,
      orderBy: "folder,name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) out.push(mapSyncEntry(f));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export interface DriveWalkFile extends DriveSyncEntry {
  /** Ruta de carpetas (nombres) desde la raíz del walk hasta el archivo. */
  folderPath: string[];
  /** Id de la carpeta contenedora directa. */
  folderId: string;
}

/** Concurrencia del listado de carpetas durante el walk (round-trips a Drive en paralelo). */
const WALK_CONCURRENCY = 6;

/**
 * Ejecuta `fn` sobre cada item con un tope de concurrencia, preservando el orden
 * del resultado. Sin dependencias externas (no p-limit). Ante error de un item,
 * el rechazo se propaga (Promise.all) — el caller decide cómo manejarlo.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

/**
 * Recorre recursivamente un folder (BFS) devolviendo sólo ARCHIVOS con su ruta.
 * Acotado por `maxDepth` (default 4), `maxFiles` (default 5000) y opcionalmente
 * por `deadlineMs` (epoch ms); cualquier corte marca `truncated`.
 *
 * El recorrido es BFS POR NIVELES con listado de carpetas en PARALELO
 * (`WALK_CONCURRENCY`): cada nivel resuelve todas sus carpetas concurrentemente,
 * reduciendo ~N round-trips secuenciales a ~N/concurrencia. Es la diferencia
 * entre terminar bajo el límite de las funciones serverless o hacer timeout.
 */
export async function walkFolderForSync(
  rootFolderId: string,
  opts: { maxDepth?: number; maxFiles?: number; deadlineMs?: number } = {},
): Promise<{ files: DriveWalkFile[]; folders: number; truncated: boolean }> {
  const maxDepth = opts.maxDepth ?? 4;
  const maxFiles = opts.maxFiles ?? 5000;
  const deadlineMs = opts.deadlineMs ?? Infinity;
  const files: DriveWalkFile[] = [];
  let folders = 0;
  let truncated = false;
  const visited = new Set<string>(); // guarda contra ciclos (atajos/shortcuts de Drive)
  type Node = { id: string; path: string[]; depth: number };
  let level: Node[] = [{ id: rootFolderId, path: [], depth: 0 }];

  return timed("walkFolderForSync", { rootFolderId, maxDepth }, async () => {
    while (level.length) {
      if (Date.now() > deadlineMs) {
        truncated = true;
        break;
      }
      // Deduplicar el nivel contra lo ya visto (shortcuts/ciclos).
      const nodes = level.filter((n) => !visited.has(n.id));
      for (const n of nodes) visited.add(n.id);
      if (!nodes.length) break;

      // Listar todas las carpetas del nivel en paralelo (acotado).
      const listings = await mapWithConcurrency(nodes, WALK_CONCURRENCY, async (n) => ({
        node: n,
        entries: await listFolderForSync(n.id),
      }));

      const next: Node[] = [];
      for (const { node, entries } of listings) {
        for (const e of entries) {
          if (e.isFolder) {
            folders += 1;
            if (node.depth < maxDepth && !visited.has(e.id)) {
              next.push({ id: e.id, path: [...node.path, e.name], depth: node.depth + 1 });
            }
          } else if (files.length >= maxFiles) {
            truncated = true;
          } else {
            files.push({ ...e, folderPath: node.path, folderId: node.id });
          }
        }
      }
      level = next;
    }
    return { files, folders, truncated };
  });
}

/** Descarga el contenido binario de un archivo (PDF/XLSX/DOCX). */
export async function downloadFileBuffer(fileId: string): Promise<Buffer> {
  const drive = requireDrive();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Exporta un archivo Google-native (Doc/Sheet) a texto (text/plain, text/csv). */
export async function exportGoogleFile(fileId: string, mimeType: string): Promise<string> {
  const drive = requireDrive();
  const res = await drive.files.export({ fileId, mimeType }, { responseType: "text" });
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}
