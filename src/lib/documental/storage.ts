import { createAdminClient } from "@/lib/supabase/server";
import { createHash, randomUUID } from "crypto";

/**
 * Helpers para Centro Documental: upload a Supabase Storage (bucket PRIVADO)
 * + hash SHA-256 + path canonical tenant/grupo/versión + signed URLs.
 *
 * FASE 2 DOCUMENTS HARDENING: el bucket `documents` es privado. NO se usan
 * URLs públicas. La descarga se sirve siempre con `createSignedUrl` y queda
 * auditada vía `log_document_event` desde la capa de server actions.
 */

/** TTL recomendado para signed URLs de documentos (segundos). */
export const SIGNED_URL_TTL = 300; // 5 min

export function fileHashSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Genera un identificador de grupo de versiones (estable entre versiones). */
export function newDocumentGroupId(): string {
  return randomUUID();
}

/**
 * Path canónico, prefijado por tenant y agrupado por versión:
 *   {client_id|'_global'}/{yyyy}/{mm}/{document_group_id}/v{version}-{sha8}-{safeName}
 *
 * NOTA: el `type` NO se incluye en el path (vive en la columna `documents.type`),
 * para preservar la resiliencia de "subir antes de OCR" — al momento del upload
 * el tipo aún no se conoce.
 */
export function buildDocPath(opts: {
  originalName: string;
  groupId: string;
  version: number;
  hash: string;
  clientId?: string | null;
  date?: Date;
}): string {
  const now = opts.date ?? new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const tenant = opts.clientId ?? "_global";
  const safe = opts.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const sha8 = opts.hash.slice(0, 8);
  return `${tenant}/${year}/${month}/${opts.groupId}/v${opts.version}-${sha8}-${safe}`;
}

export interface UploadedDoc {
  bucket: string;
  path: string;
  size: number;
  hash: string;
  groupId: string;
  version: number;
}

/**
 * Sube el archivo al bucket privado `documents`. Devuelve metadata (sin URL:
 * la URL firmada se pide on-demand con `getSignedUrl`).
 */
export async function uploadDocument(opts: {
  buffer: Buffer;
  originalName: string;
  contentType: string;
  clientId?: string | null;
  groupId?: string;
  version?: number;
}): Promise<UploadedDoc> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase admin no disponible");

  const hash = fileHashSha256(opts.buffer);
  const groupId = opts.groupId ?? newDocumentGroupId();
  const version = opts.version ?? 1;
  const path = buildDocPath({
    originalName: opts.originalName,
    groupId,
    version,
    hash,
    clientId: opts.clientId ?? null,
  });

  const { error } = await admin.storage
    .from("documents")
    .upload(path, opts.buffer, {
      contentType: opts.contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  return {
    bucket: "documents",
    path,
    size: opts.buffer.byteLength,
    hash,
    groupId,
    version,
  };
}

/**
 * Borra un objeto del bucket privado. Se usa como COMPENSACIÓN (M-1/M-2):
 * si el upload a Storage tuvo éxito pero el INSERT en `documents` falla, el
 * blob quedaría huérfano. Esta función lo elimina para no dejar basura ni
 * archivos sin fila (que además quedarían fuera del scoping multi-tenant).
 * No lanza: el camino de error que la invoca ya está reportando otro fallo.
 */
export async function removeDocument(path: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await admin.storage.from("documents").remove([path]);
  } catch {
    // best-effort: no escalamos un fallo de limpieza sobre el error original.
  }
}

/**
 * Genera una URL firmada temporal para un objeto del bucket privado.
 * Devuelve null en demo mode (sin admin client).
 */
export async function getSignedUrl(
  path: string,
  expiresIn: number = SIGNED_URL_TTL,
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.storage
    .from("documents")
    .createSignedUrl(path, expiresIn);
  if (error) throw new Error(`Storage signed URL: ${error.message}`);
  return data?.signedUrl ?? null;
}
