import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Storage del archivo ORIGINAL de una factura de proveedor (flujo OCR · F2).
 *
 * Conserva el PDF/imagen que el usuario cargó y sobre el cual el OCR
 * precompletó la factura, vinculándolo al registro mediante
 * supplier_invoices.pdf_url (columna existente — no se agregan columnas).
 *
 * Bucket: `supplier-invoices` (privado; ver migration 0015, NO aplicada aún).
 *
 * Diseño BEST-EFFORT: si el admin client o el bucket no existen, NO lanza —
 * devuelve null y el alta de la factura sigue su curso. El adjunto nunca debe
 * bloquear el registro contable.
 *
 * Path canónico:
 *   {yyyy}/{mm}/{invoiceId}-{sha8}.{ext}
 */

const BUCKET = "supplier-invoices";
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB — alineado con el límite del OCR.

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface AttachResult {
  /** Path dentro del bucket (sirve como referencia estable). */
  path: string;
  /** Bytes subidos. */
  size: number;
  /** SHA-256 del contenido (para integridad/dedup). */
  sha256: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pathFor(invoiceId: string, sha256: string, ext: string, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  return `${yyyy}/${mm}/${invoiceId}-${sha256.slice(0, 8)}.${ext}`;
}

/**
 * Sube el archivo original al bucket `supplier-invoices`. Best-effort:
 * devuelve null (sin lanzar) si falta el admin client, el mime no está
 * soportado, el archivo supera el límite, o el bucket no existe todavía.
 */
export async function uploadSupplierInvoiceFile(opts: {
  invoiceId: string;
  bytes: Buffer;
  mime: string;
}): Promise<AttachResult | null> {
  const ext = EXT_BY_MIME[opts.mime];
  if (!ext) return null;
  if (!opts.bytes || opts.bytes.byteLength === 0) return null;
  if (opts.bytes.byteLength > MAX_BYTES) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
  const path = pathFor(opts.invoiceId, sha256, ext, new Date());

  const { error } = await admin.storage.from(BUCKET).upload(path, opts.bytes, {
    contentType: opts.mime,
    upsert: true,
    cacheControl: "3600",
  });
  // Bucket inexistente / RLS / red → degradar en silencio (best-effort).
  if (error) return null;

  return { path, size: opts.bytes.byteLength, sha256 };
}

/**
 * Genera una signed URL de corta duración para visualizar el archivo
 * original. Default 1 hora. Devuelve null si no se puede.
 */
export async function signedSupplierInvoiceUrl(
  path: string,
  expiresInSec = 3600
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}
