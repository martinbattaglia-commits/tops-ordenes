import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Storage layer para PDFs de OC.
 *
 * Usa Supabase Storage como backend principal (`po-pdfs-private`, creado por
 * 0243). El bucket público legado `po-pdfs` no se modifica. Drive queda como sync
 * secundario opcional (ver `src/lib/drive/client.ts`). La firma primaria
 * queda custodiada como bytes append-only en PostgreSQL; no se mantiene una
 * segunda copia mutable en Storage.
 */

export interface UploadResult {
  path: string;
  publicUrl: string | null;
  size: number;
}

export const PO_PDF_BUCKET = "po-pdfs-private";

/** Lee el PDF inmutable ya materializado; nunca lo regenera sin la firma. */
export async function downloadPoPdf(opts: {
  path: string;
  expectedSha256: string;
  expectedSize: number;
}): Promise<Buffer | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from(PO_PDF_BUCKET)
    .download(opts.path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  if (
    buffer.byteLength !== opts.expectedSize
    || createHash("sha256").update(buffer).digest("hex") !== opts.expectedSha256
  ) return null;
  return buffer;
}

/**
 * Sube el PDF firmado al bucket privado dedicado con path por contenido.
 * Una colisión sólo es idempotente si hash y tamaño coinciden exactamente.
 */
export async function uploadPoPdf(opts: {
  orderId: string;
  pdfSha256: string;
  pdfBuffer: Buffer;
}): Promise<UploadResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin client no disponible (falta SERVICE_ROLE_KEY)");

  const actualSha = createHash("sha256").update(opts.pdfBuffer).digest("hex");
  if (actualSha !== opts.pdfSha256) throw new Error("PO_PDF_HASH_MISMATCH");
  const path = `${opts.orderId}/${actualSha}.pdf`;
  const { error } = await admin.storage
    .from(PO_PDF_BUCKET)
    .upload(path, opts.pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "3600",
    });

  if (error) {
    const existing = await downloadPoPdf({
      path,
      expectedSha256: actualSha,
      expectedSize: opts.pdfBuffer.byteLength,
    });
    if (!existing) throw new Error("PO_PDF_IMMUTABLE_COLLISION");
  }
  return {
    path,
    publicUrl: null,
    size: opts.pdfBuffer.byteLength,
  };
}
