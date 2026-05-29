/**
 * Almacenamiento de PDFs fiscales en el bucket PRIVADO `invoices`.
 *
 * FASE E1 — Cierre de R4. El bucket `invoices` quedó aislado por tenant a
 * nivel storage (0013_invoices_storage_isolation.sql): el cliente solo puede
 * leer objetos cuyo PRIMER segmento del path == su client_id. Para que ese
 * scoping aplique, TODO PDF fiscal debe almacenarse con el path canónico que
 * arma `buildInvoicePdfPath` (primer segmento = client_id | '_global').
 *
 * Espejo deliberado de `lib/documental/storage.ts` (patrón gold standard):
 *  - bucket privado, sin URLs públicas;
 *  - upload vía service-role (createAdminClient, bypassa RLS);
 *  - descarga SIEMPRE por signed URL on-demand (TTL corto).
 *
 * Esta capa NO emite comprobantes ni cambia el flujo de `emit.ts`. Solo provee
 * el contrato de persistencia/lectura aislado por cliente, listo para cuando
 * se habilite la materialización de PDFs fiscales (gate aparte).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { createHash } from "crypto";

/** TTL recomendado para signed URLs de comprobantes (segundos). */
export const INVOICE_SIGNED_URL_TTL = 300; // 5 min

export const INVOICES_BUCKET = "invoices" as const;

export interface BuildInvoicePathInput {
  /** client_id del receptor; null/undefined ⇒ '_global' (sin cliente asociado). */
  clientId?: string | null;
  /** Código numérico de comprobante ARCA (cbte_tipo_arca). */
  cbteTipo: number;
  puntoVenta: number;
  numeroComprobante: number;
  /** Buffer del PDF (para el sufijo sha8, integridad/desambiguación). */
  pdfBuffer: Buffer;
  date?: Date;
}

/**
 * Path canónico, prefijado por tenant:
 *   {client_id|'_global'}/{yyyy}/{mm}/{cbteTipo}-{ptoVta}-{nro}-{sha8}.pdf
 *
 * El PRIMER segmento es el client_id — requisito para que la policy
 * "invoices read scoped" aísle al cliente a su propio prefijo.
 */
export function buildInvoicePdfPath(opts: BuildInvoicePathInput): string {
  const now = opts.date ?? new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const tenant = opts.clientId ?? "_global";
  const sha8 = createHash("sha256")
    .update(opts.pdfBuffer)
    .digest("hex")
    .slice(0, 8);
  const pv = String(opts.puntoVenta).padStart(5, "0");
  const nro = String(opts.numeroComprobante).padStart(8, "0");
  return `${tenant}/${year}/${month}/${opts.cbteTipo}-${pv}-${nro}-${sha8}.pdf`;
}

export interface StoredInvoicePdf {
  bucket: string;
  path: string;
  size: number;
}

/**
 * Sube el PDF fiscal al bucket privado `invoices` con path aislado por cliente.
 * Devuelve metadata (sin URL: se pide signed URL on-demand con
 * `getInvoicePdfSignedUrl`). NO sobreescribe por defecto (upsert=false): un
 * comprobante autorizado es inmutable.
 */
export async function storeInvoicePdf(opts: {
  pdfBuffer: Buffer;
  clientId?: string | null;
  cbteTipo: number;
  puntoVenta: number;
  numeroComprobante: number;
}): Promise<StoredInvoicePdf> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin no disponible");

  const path = buildInvoicePdfPath({
    clientId: opts.clientId ?? null,
    cbteTipo: opts.cbteTipo,
    puntoVenta: opts.puntoVenta,
    numeroComprobante: opts.numeroComprobante,
    pdfBuffer: opts.pdfBuffer,
  });

  const { error } = await admin.storage
    .from(INVOICES_BUCKET)
    .upload(path, opts.pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw new Error(`Invoice PDF upload: ${error.message}`);

  return { bucket: INVOICES_BUCKET, path, size: opts.pdfBuffer.byteLength };
}

/**
 * Genera una URL firmada temporal para un PDF fiscal del bucket privado.
 * Devuelve null en demo mode (sin admin client).
 */
export async function getInvoicePdfSignedUrl(
  path: string,
  expiresIn: number = INVOICE_SIGNED_URL_TTL
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from(INVOICES_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) throw new Error(`Invoice signed URL: ${error.message}`);
  return data?.signedUrl ?? null;
}
