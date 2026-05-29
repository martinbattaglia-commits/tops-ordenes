"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadDocument } from "@/lib/documental/storage";
import { extractFromPdf, extractFromImage, OcrError } from "@/lib/ocr/openai";
import type { ExtractedDocument } from "@/lib/ocr/types";
import { env } from "@/lib/env";

interface ProcessOk {
  ok: true;
  documentId: string;
  extract: ExtractedDocument;
  publicUrl: string | null;
}

interface ProcessErr {
  ok: false;
  error: string;
  extract?: ExtractedDocument;
}

export type ProcessResult = ProcessOk | ProcessErr;

/**
 * Procesa un documento subido: lo sube a Storage, lo manda a OCR,
 * persiste en `public.documents`.
 *
 * Server action: recibe FormData con `file` (File), opcional `tags` y vendor_id.
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

  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Subir a Storage
  let uploaded;
  try {
    uploaded = await uploadDocument({
      buffer,
      originalName: file.name,
      contentType,
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
      // Convertir image a data URL
      const b64 = buffer.toString("base64");
      const dataUrl = `data:${contentType};base64,${b64}`;
      extract = await extractFromImage(dataUrl);
    }
  } catch (e) {
    const msg = e instanceof OcrError ? e.message : (e as Error).message;
    // Aún sin OCR, guardamos el documento como tipo 'otro' sin extract
    if (env.supabase.configured) {
      const supabase = createClient();
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from("documents").insert({
          type: "otro",
          title: file.name,
          storage_bucket: uploaded.bucket,
          storage_path: uploaded.path,
          mime_type: contentType,
          file_size: uploaded.size,
          file_hash: uploaded.hash,
          source: "upload",
          uploaded_by: user?.id ?? null,
        });
      }
    }
    return {
      ok: false,
      error: `OCR: ${msg}. El archivo se guardó igual sin extracción.`,
    };
  }

  // 3. Persistir en DB
  if (env.supabase.configured) {
    const supabase = createClient();
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error: dbErr } = await supabase
        .from("documents")
        .insert({
          type: extract.type,
          title: extract.title ?? file.name,
          summary: extract.summary,
          doc_date: extract.date,
          expires_at: extract.expiresAt,
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
        return {
          ok: false,
          error: `DB insert: ${dbErr.message}`,
          extract,
        };
      }
      revalidatePath("/documental");
      return {
        ok: true,
        documentId: inserted.id,
        extract,
        publicUrl: uploaded.publicUrl,
      };
    }
  }

  // Sin DB (demo mode) — devolvemos el extract sin persistir
  return {
    ok: true,
    documentId: `temp-${uploaded.hash.slice(0, 12)}`,
    extract,
    publicUrl: uploaded.publicUrl,
  };
}
