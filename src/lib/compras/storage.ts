import { createAdminClient } from "@/lib/supabase/server";

/**
 * Storage layer para PDFs y firmas de OC.
 *
 * Usa Supabase Storage como backend principal (buckets `po-pdfs` y
 * `po-signatures` creados en migration 0008). Drive queda como sync
 * secundario opcional (ver `src/lib/drive/client.ts`).
 *
 * Estructura del path en `po-pdfs`:
 *   {year}/{month}/{public_id}.pdf
 *
 * Ejemplo: `2026/05/OC-2026-0349.pdf`
 *
 * Las firmas (PNG) van en `po-signatures` con path simple `{order_id}.png`.
 */

export interface UploadResult {
  path: string;
  publicUrl: string | null;
  size: number;
}

const MONTHS = [
  "01-enero",
  "02-febrero",
  "03-marzo",
  "04-abril",
  "05-mayo",
  "06-junio",
  "07-julio",
  "08-agosto",
  "09-septiembre",
  "10-octubre",
  "11-noviembre",
  "12-diciembre",
];

function pathForPdf(publicId: string, date: Date): string {
  const year = date.getFullYear();
  const month = MONTHS[date.getMonth()];
  return `${year}/${month}/${publicId}.pdf`;
}

/**
 * Sube el PDF firmado al bucket `po-pdfs`. Devuelve la URL pública.
 * Idempotente: si ya existe en ese path, lo sobrescribe (upsert).
 */
export async function uploadPoPdf(opts: {
  publicId: string;
  date: Date;
  pdfBuffer: Buffer;
}): Promise<UploadResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin client no disponible (falta SERVICE_ROLE_KEY)");

  const path = pathForPdf(opts.publicId, opts.date);
  const { error } = await admin.storage
    .from("po-pdfs")
    .upload(path, opts.pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "3600",
    });

  if (error) throw new Error(`uploadPoPdf: ${error.message}`);

  const { data: pub } = admin.storage.from("po-pdfs").getPublicUrl(path);
  return {
    path,
    publicUrl: pub?.publicUrl ?? null,
    size: opts.pdfBuffer.byteLength,
  };
}

/**
 * Sube el PNG de firma al bucket privado `po-signatures`.
 * Acceso solo vía signed URLs con expiración.
 */
export async function uploadSignature(opts: {
  orderId: string;
  pngBuffer: Buffer;
}): Promise<UploadResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin client no disponible (falta SERVICE_ROLE_KEY)");

  const path = `${opts.orderId}.png`;
  const { error } = await admin.storage
    .from("po-signatures")
    .upload(path, opts.pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) throw new Error(`uploadSignature: ${error.message}`);

  return {
    path,
    publicUrl: null, // bucket privado
    size: opts.pngBuffer.byteLength,
  };
}

/**
 * Genera signed URL de corta duración para descargar una firma.
 * Default: 1 hora.
 */
export async function signedSignatureUrl(orderId: string, expiresInSec = 3600): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from("po-signatures")
    .createSignedUrl(`${orderId}.png`, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}
