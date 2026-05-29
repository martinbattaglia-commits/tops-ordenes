"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  uploadDocument,
  getSignedUrl,
  newDocumentGroupId,
  removeDocument,
} from "@/lib/documental/storage";
import { extractFromPdf, extractFromImage, OcrError } from "@/lib/ocr/openai";
import type { ExtractedDocument } from "@/lib/ocr/types";
import { env } from "@/lib/env";

interface ProcessOk {
  ok: true;
  documentId: string;
  extract: ExtractedDocument;
  /** URL firmada temporal (bucket privado). null en demo mode. */
  signedUrl: string | null;
}

interface ProcessErr {
  ok: false;
  error: string;
  extract?: ExtractedDocument;
}

export type ProcessResult = ProcessOk | ProcessErr;

/** Roles internos habilitados a subir/versionar documentos (espejo de la RLS). */
const INTERNAL_ROLES = ["admin", "operaciones", "supervisor"] as const;

/**
 * MIME types aceptados — DEBE coincidir con el `check` de `documents.mime_type`
 * y con `allowed_mime_types` del bucket (M-3). Antes la app aceptaba cualquier
 * `image/*` (incl. svg ⇒ vector XSS) y fallaba recién en DB.
 */
const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
] as const;

/**
 * A-1 (GATE 1C): AUTORIZACIÓN TEMPRANA. Debe ejecutarse ANTES de tocar Storage,
 * OCR u OpenAI. Sin esto, un usuario sin rol interno podía disparar uploads y
 * consumo de tokens de OpenAI (DoS por costo) aunque el INSERT fallara luego.
 * En demo mode (sin Supabase) no hay sesión ni costos de prod: se permite.
 */
async function authorizeInternal(): Promise<
  { ok: true; userId: string | null } | { ok: false; error: string }
> {
  if (!env.supabase.configured) return { ok: true, userId: null };
  const supabase = createClient();
  if (!supabase) return { ok: true, userId: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = profile?.role as (typeof INTERNAL_ROLES)[number] | undefined;
  if (!role || !INTERNAL_ROLES.includes(role)) {
    return {
      ok: false,
      error:
        "No autorizado: se requiere rol interno (admin/operaciones/supervisor) para subir documentos",
    };
  }
  return { ok: true, userId: user.id };
}

/** Captura ip + user-agent del request para la bitácora de auditoría. */
function auditContext(): { ip: string | null; userAgent: string | null } {
  try {
    const h = headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Procesa un documento subido: lo sube a Storage (bucket PRIVADO), lo manda a
 * OCR, persiste en `public.documents` (versión 1 de un grupo nuevo) y registra
 * el evento `create` en `documents_audit`. Devuelve una signed URL temporal.
 */
export async function processDocumentAction(formData: FormData): Promise<ProcessResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Archivo no recibido o vacío" };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false, error: "Archivo > 20 MB no soportado por ahora" };
  }

  // M-3: normalizamos PDF-por-extensión y validamos contra la lista única que
  // comparten app + tabla + bucket. svg/gif/heic se rechazan en el borde.
  let contentType = file.type || "application/octet-stream";
  const isPdf =
    contentType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) contentType = "application/pdf";
  const isImage = contentType.startsWith("image/");
  if (!ALLOWED_MIME.includes(contentType as (typeof ALLOWED_MIME)[number])) {
    return {
      ok: false,
      error: `Tipo no soportado: ${contentType}. Permitidos: PDF, PNG, JPEG, WEBP, TIFF.`,
    };
  }

  // A-1: autorización ANTES de Storage / OCR / OpenAI.
  const authz = await authorizeInternal();
  if (!authz.ok) return { ok: false, error: authz.error };

  // Vínculos opcionales (multi-tenant / multi-sede).
  const clientId = (formData.get("client_id") as string) || null;
  const vendorId = (formData.get("vendor_id") as string) || null;
  const depot = (formData.get("depot") as string) || null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const groupId = newDocumentGroupId();

  // 1. Subir a Storage (bucket privado, path tenant/grupo/versión)
  let uploaded;
  try {
    uploaded = await uploadDocument({
      buffer,
      originalName: file.name,
      contentType,
      clientId,
      groupId,
      version: 1,
    });
  } catch (e) {
    return { ok: false, error: `Storage: ${(e as Error).message}` };
  }

  // 2. OCR
  let extract: ExtractedDocument;
  try {
    if (isPdf) {
      extract = await extractFromPdf(buffer);
    } else {
      const b64 = buffer.toString("base64");
      const dataUrl = `data:${contentType};base64,${b64}`;
      extract = await extractFromImage(dataUrl);
    }
  } catch (e) {
    const msg = e instanceof OcrError ? e.message : (e as Error).message;
    // Aún sin OCR, guardamos el documento como tipo 'otro' sin extract.
    if (env.supabase.configured) {
      const supabase = createClient();
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        // El INSERT dispara tg_documents_audit ⇒ el evento 'create' se registra
        // por trigger (M-1). No logueamos a mano para no duplicar.
        const { data: ins, error: insErr } = await supabase
          .from("documents")
          .insert({
            document_group_id: uploaded.groupId,
            version: uploaded.version,
            is_current: true,
            type: "otro",
            title: file.name,
            client_id: clientId,
            vendor_id: vendorId,
            depot,
            storage_bucket: uploaded.bucket,
            storage_path: uploaded.path,
            mime_type: contentType,
            file_size: uploaded.size,
            file_hash: uploaded.hash,
            source: "upload",
            uploaded_by: user?.id ?? null,
          })
          .select("id")
          .single();
        // M-2: si el INSERT falla, el blob ya subido quedaría huérfano ⇒ limpiar.
        if (insErr || !ins?.id) {
          await removeDocument(uploaded.path);
        }
      }
    }
    return {
      ok: false,
      error: `OCR: ${msg}. El archivo se guardó igual sin extracción.`,
    };
  }

  // 3. Persistir en DB + auditar + firmar URL
  if (env.supabase.configured) {
    const supabase = createClient();
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error: dbErr } = await supabase
        .from("documents")
        .insert({
          document_group_id: uploaded.groupId,
          version: uploaded.version,
          is_current: true,
          type: extract.type,
          title: extract.title ?? file.name,
          summary: extract.summary,
          doc_date: extract.date,
          expires_at: extract.expiresAt,
          client_id: clientId,
          vendor_id: vendorId,
          depot,
          storage_bucket: uploaded.bucket,
          storage_path: uploaded.path,
          mime_type: contentType,
          file_size: uploaded.size,
          file_hash: uploaded.hash,
          extract: extract as unknown as Record<string, unknown>,
          raw_text: extract.rawText.slice(0, 50_000),
          tags: extract.tags,
          source: "upload",
          uploaded_by: user?.id ?? null,
          ai_tokens_used: extract.meta.tokensUsed,
          ai_model: extract.meta.model,
        })
        .select("id")
        .single();

      if (dbErr) {
        // M-2: el blob ya está en Storage; si el INSERT falla queda huérfano.
        await removeDocument(uploaded.path);
        // B-3: no filtramos el nombre del constraint al usuario.
        const friendly = dbErr.message.includes("documents_hash_uq")
          ? "Documento duplicado: ya existe un archivo idéntico para este cliente."
          : `DB insert: ${dbErr.message}`;
        return { ok: false, error: friendly, extract };
      }

      // El evento 'create' se registra por trigger (tg_documents_audit, M-1):
      // no se llama a log_document_event aquí para no duplicar la auditoría.
      let signedUrl: string | null = null;
      try {
        signedUrl = await getSignedUrl(uploaded.path);
      } catch {
        signedUrl = null;
      }

      revalidatePath("/documental");
      return { ok: true, documentId: inserted.id, extract, signedUrl };
    }
  }

  // Sin DB (demo mode) — devolvemos el extract sin persistir.
  return {
    ok: true,
    documentId: `temp-${uploaded.hash.slice(0, 12)}`,
    extract,
    signedUrl: null,
  };
}

/**
 * Genera una signed URL para ver/descargar un documento y registra el acceso
 * (`view` | `download`) en la bitácora de auditoría. RLS garantiza que el
 * usuario solo obtenga documentos a los que tiene acceso.
 */
export async function getDocumentUrlAction(
  documentId: string,
  action: "view" | "download" = "view",
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!env.supabase.configured) return { ok: false, error: "Sin Supabase" };
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Sin Supabase" };

  // Lectura sujeta a RLS: si no tiene acceso, no obtiene la fila.
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, storage_path, deleted_at")
    .eq("id", documentId)
    .single();
  if (error || !doc) return { ok: false, error: "Documento no encontrado o sin acceso" };
  if (doc.deleted_at) return { ok: false, error: "Documento eliminado" };

  let url: string | null = null;
  try {
    url = await getSignedUrl(doc.storage_path);
  } catch (e) {
    return { ok: false, error: `Signed URL: ${(e as Error).message}` };
  }
  if (!url) return { ok: false, error: "No se pudo generar la URL" };

  const { ip, userAgent } = auditContext();
  await supabase.rpc("log_document_event", {
    p_document_id: documentId,
    p_action: action,
    p_ip: ip,
    p_user_agent: userAgent,
    p_detail: null,
  });

  return { ok: true, url };
}

/**
 * Soft-delete: marca `deleted_at`/`deleted_by` (no borra físico) y audita.
 * RLS exige rol interno; el borrado físico queda reservado a admin.
 */
export async function softDeleteDocumentAction(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.supabase.configured) return { ok: false, error: "Sin Supabase" };
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Sin Supabase" };

  const { data: { user } } = await supabase.auth.getUser();
  // M-5: liberamos el slot de "versión actual" (documents_current_uq es parcial
  // sobre is_current). Si no, el grupo quedaría bloqueado para promover otra
  // versión y todas las queries deberían recordar filtrar deleted_at.
  // El evento 'delete' lo registra tg_documents_audit (M-1) al pasar deleted_at
  // de null a no-null: no se llama a log_document_event aquí (evita duplicado).
  const { error } = await supabase
    .from("documents")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id ?? null,
      is_current: false,
    })
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/documental");
  return { ok: true };
}

/**
 * Versionado (P5) — flujo de aplicación real (cierra la omisión "schema-only"
 * detectada en C-1). Sube una nueva versión de un documento existente: el
 * trigger `tg_documents_version` (BEFORE INSERT) hereda `document_group_id`,
 * numera la versión y degrada a la anterior; `tg_documents_audit` registra el
 * 'create'. La lectura del predecesor pasa por RLS (autorización por tenant).
 */
export async function createDocumentVersionAction(
  prevDocumentId: string,
  formData: FormData,
): Promise<ProcessResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Archivo no recibido o vacío" };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false, error: "Archivo > 20 MB no soportado por ahora" };
  }

  let contentType = file.type || "application/octet-stream";
  const isPdf =
    contentType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) contentType = "application/pdf";
  if (!ALLOWED_MIME.includes(contentType as (typeof ALLOWED_MIME)[number])) {
    return {
      ok: false,
      error: `Tipo no soportado: ${contentType}. Permitidos: PDF, PNG, JPEG, WEBP, TIFF.`,
    };
  }

  // A-1: autorización ANTES de Storage / OCR.
  const authz = await authorizeInternal();
  if (!authz.ok) return { ok: false, error: authz.error };

  if (!env.supabase.configured) return { ok: false, error: "Sin Supabase" };
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Sin Supabase" };

  // Lectura del predecesor sujeta a RLS: si no hay acceso, no vuelve la fila.
  const { data: prev, error: prevErr } = await supabase
    .from("documents")
    .select("id, document_group_id, version, client_id, vendor_id, depot, deleted_at")
    .eq("id", prevDocumentId)
    .single();
  if (prevErr || !prev) {
    return { ok: false, error: "Documento base no encontrado o sin acceso" };
  }
  if (prev.deleted_at) {
    return { ok: false, error: "No se puede versionar un documento eliminado" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const nextVersion = (prev.version ?? 1) + 1;

  // 1. Subir (mismo grupo, versión siguiente — el path conserva v{n}).
  let uploaded;
  try {
    uploaded = await uploadDocument({
      buffer,
      originalName: file.name,
      contentType,
      clientId: prev.client_id,
      groupId: prev.document_group_id,
      version: nextVersion,
    });
  } catch (e) {
    return { ok: false, error: `Storage: ${(e as Error).message}` };
  }

  // 2. OCR.
  let extract: ExtractedDocument;
  try {
    if (isPdf) {
      extract = await extractFromPdf(buffer);
    } else {
      const b64 = buffer.toString("base64");
      extract = await extractFromImage(`data:${contentType};base64,${b64}`);
    }
  } catch (e) {
    await removeDocument(uploaded.path);
    const msg = e instanceof OcrError ? e.message : (e as Error).message;
    return { ok: false, error: `OCR: ${msg}. No se creó la versión.` };
  }

  // 3. INSERT con supersedes_id ⇒ el trigger hereda grupo, numera y degrada.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: inserted, error: dbErr } = await supabase
    .from("documents")
    .insert({
      // group/version los fija el trigger; los enviamos por consistencia del path.
      document_group_id: prev.document_group_id,
      version: nextVersion,
      is_current: true,
      supersedes_id: prev.id,
      type: extract.type,
      title: extract.title ?? file.name,
      summary: extract.summary,
      doc_date: extract.date,
      expires_at: extract.expiresAt,
      client_id: prev.client_id,
      vendor_id: prev.vendor_id,
      depot: prev.depot,
      storage_bucket: uploaded.bucket,
      storage_path: uploaded.path,
      mime_type: contentType,
      file_size: uploaded.size,
      file_hash: uploaded.hash,
      extract: extract as unknown as Record<string, unknown>,
      raw_text: extract.rawText.slice(0, 50_000),
      tags: extract.tags,
      source: "upload",
      uploaded_by: user?.id ?? null,
      ai_tokens_used: extract.meta.tokensUsed,
      ai_model: extract.meta.model,
    })
    .select("id")
    .single();

  if (dbErr) {
    await removeDocument(uploaded.path);
    const friendly = dbErr.message.includes("documents_hash_uq")
      ? "Documento duplicado: ya existe un archivo idéntico para este cliente."
      : `DB insert: ${dbErr.message}`;
    return { ok: false, error: friendly, extract };
  }

  let signedUrl: string | null = null;
  try {
    signedUrl = await getSignedUrl(uploaded.path);
  } catch {
    signedUrl = null;
  }

  revalidatePath("/documental");
  return { ok: true, documentId: inserted.id, extract, signedUrl };
}
