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

export interface UploadExtractoResult {
  path: string;
  /** true si el objeto se creó en ESTA request (habilita compensación segura). */
  created: boolean;
}

/** Sube el archivo del extracto al bucket privado. Devuelve el path y si el
 *  objeto es nuevo, o null si el storage no está disponible.
 *  `created=false` ⇒ el objeto ya existía (histórico): NUNCA se compensa. */
export async function subirExtracto(opts: {
  bankAccountId: string;
  hash: string;
  sourceKind: "csv" | "xls" | "pdf";
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<UploadExtractoResult | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const path = `${opts.bankAccountId}/${opts.hash}.${opts.sourceKind}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, opts.bytes, {
    contentType: opts.contentType,
    upsert: false, // idempotencia: el mismo hash no se re-sube
  });
  if (error && /already exists/i.test(error.message)) return { path, created: false };
  if (error) return null;
  return { path, created: true };
}

/** Compensación segura (E2 · TREAS-RECON-001): elimina SOLO un objeto creado
 *  en esta misma request cuya persistencia falló. Los blobs históricos
 *  (`created=false`) jamás se tocan. Best-effort: si falla, se preserva el
 *  objeto y queda constancia por log (no rompe el flujo de error principal). */
export async function compensarExtractoSubido(res: UploadExtractoResult | null): Promise<boolean> {
  if (!res || !res.created) return false;
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.storage.from(BUCKET).remove([res.path]);
  if (error) {
    console.error("[recon-ingest] compensación de storage falló; se preserva el objeto", {
      path: res.path,
      error: error.message,
    });
    return false;
  }
  return true;
}

/** URL firmada de descarga (TTL corto). NUNCA pública. */
export async function urlFirmadaExtracto(path: string, ttlSec = 120): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, ttlSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}
