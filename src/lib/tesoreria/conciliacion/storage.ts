/**
 * Storage de extractos bancarios (S4). Bucket PRIVADO `bank-statements`.
 *
 * Sin lectura directa: la descarga se sirve SIEMPRE con `createSignedUrl`
 * (server-side, TTL corto). Datos sensibles (CBU/saldos) → nunca URL pública,
 * nunca PII en logs. Patrón espejo de compras/invoice-storage.
 *
 * NOTA: el bucket proviene de 0080 (DISEÑO, aún NO aplicado).
 */
import { createAdminClient } from "@/lib/supabase/server";

const BUCKET = "bank-statements";

/** Sube el archivo del extracto al bucket privado. Devuelve el path o null (best-effort). */
export async function subirExtracto(opts: {
  bankAccountId: string;
  hash: string;
  sourceKind: "csv" | "xls" | "pdf";
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const path = `${opts.bankAccountId}/${opts.hash}.${opts.sourceKind}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, opts.bytes, {
    contentType: opts.contentType,
    upsert: false, // idempotencia: el mismo hash no se re-sube
  });
  if (error && !/already exists/i.test(error.message)) return null;
  return path;
}

/** URL firmada de descarga (TTL corto). NUNCA pública. */
export async function urlFirmadaExtracto(path: string, ttlSec = 120): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, ttlSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}
