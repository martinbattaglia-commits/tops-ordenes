"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { uploadSupplierInvoiceFile } from "@/lib/compras/invoice-storage";

/**
 * Vincula el archivo ORIGINAL (PDF/imagen) de una factura de proveedor al
 * registro recién creado (flujo OCR · F2, Opción A).
 *
 * BEST-EFFORT por diseño: se invoca DESPUÉS de createSupplierInvoiceAction.
 * Si falla (bucket aún no creado, sin admin client, etc.) NO rompe nada —
 * la factura ya quedó registrada; solo no tendrá el adjunto vinculado.
 *
 * Trazabilidad "quién/cuándo": la cubre el propio INSERT de la factura
 * (created_by/created_at), porque en Opción A el registro recién nace al
 * confirmar. Acá solo guardamos el blob y el puntero (pdf_url).
 */

interface AttachOk {
  ok: true;
  path: string | null;
}
interface AttachErr {
  ok: false;
  error: string;
}
export type AttachResult = AttachOk | AttachErr;

const SUPPORTED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function attachSupplierInvoiceFileAction(
  invoiceId: string,
  formData: FormData
): Promise<AttachResult> {
  if (!invoiceId) return { ok: false, error: "Falta el id de la factura." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    // Sin archivo no es un error: simplemente no hay adjunto que vincular.
    return { ok: true, path: null };
  }
  if (!SUPPORTED.has(file.type)) {
    return { ok: false, error: `Tipo de archivo no soportado: ${file.type || "desconocido"}.` };
  }

  // Demo mode → no persistimos; devolvemos ok sin path.
  if (env.app.demoMode || env.app.needsSupabase) {
    return { ok: true, path: null };
  }

  let path: string | null = null;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const up = await uploadSupplierInvoiceFile({
      invoiceId,
      bytes,
      mime: file.type,
    });
    path = up?.path ?? null;
  } catch {
    // Upload best-effort: si rompe, seguimos sin adjunto.
    return { ok: true, path: null };
  }

  if (!path) {
    // Bucket aún no creado o upload no disponible → degradación elegante.
    return { ok: true, path: null };
  }

  // Patch del puntero al archivo. Si falla, no revertimos la factura.
  const supabase = createClient();
  if (supabase) {
    const { error } = await supabase
      .from("supplier_invoices")
      .update({ pdf_url: path })
      .eq("id", invoiceId);
    if (error) {
      // El blob ya está; solo no quedó referenciado. No es fatal.
      return { ok: true, path: null };
    }
  }

  revalidatePath("/compras/facturas");
  return { ok: true, path };
}
