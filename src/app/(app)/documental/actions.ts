"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  uploadDocument,
  getSignedUrl,
  newDocumentGroupId,
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

  const contentType = file.type || "application/octet-stream";
  const isPdf = contentType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = contentType.startsWith("image/");
  if (!isPdf && !isImage) {
    return { ok: false, error: `Tipo no soportado: ${contentType}. Subí PDF o imagen.` };
  }

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
        const { data: ins } = await supabase
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
        if (ins?.id) {
          const { ip, userAgent } = auditContext();
          await supabase.rpc("log_document_event", {
            p_document_id: ins.id,
            p_action: "create",
            p_ip: ip,
            p_user_agent: userAgent,
            p_detail: { ocr: "failed", reason: msg },
          });
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
        return { ok: false, error: `DB insert: ${dbErr.message}`, extract };
      }

      const { ip, userAgent } = auditContext();
      await supabase.rpc("log_document_event", {
        p_document_id: inserted.id,
        p_action: "create",
        p_ip: ip,
        p_user_agent: userAgent,
        p_detail: { type: extract.type, version: uploaded.version },
      });

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
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };

  const { ip, userAgent } = auditContext();
  await supabase.rpc("log_document_event", {
    p_document_id: documentId,
    p_action: "delete",
    p_ip: ip,
    p_user_agent: userAgent,
    p_detail: { soft: true },
  });

  revalidatePath("/documental");
  return { ok: true };
}
