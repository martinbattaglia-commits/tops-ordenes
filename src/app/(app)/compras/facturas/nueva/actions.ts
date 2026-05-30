"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  CreateSupplierInvoiceSchema,
  formatZodIssues,
  type CreateSupplierInvoiceInput,
} from "@/lib/erp/validation";

interface CreateOk {
  ok: true;
  id: string;
  public_id: string;
}
interface CreateErr {
  ok: false;
  error: string;
}
export type CreateSupplierInvoiceResult = CreateOk | CreateErr;

export async function createSupplierInvoiceAction(
  input: CreateSupplierInvoiceInput
): Promise<CreateSupplierInvoiceResult> {
  const parsed = CreateSupplierInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: formatZodIssues(parsed.error) };
  }
  const d = parsed.data;
  const total =
    Number(d.neto ?? 0) + Number(d.iva ?? 0) + Number(d.percepciones ?? 0);

  // Demo mode → no persistimos; devolvemos un public_id sintético.
  if (env.app.demoMode || env.app.needsSupabase) {
    const short = Math.floor(Math.random() * 9000) + 1000;
    return { ok: true, id: `demo-${short}`, public_id: `FP-2026-${String(short).padStart(4, "0")}` };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("supplier_invoices")
    .insert({
      vendor_id: d.vendor_id,
      cost_center_id: d.cost_center_id || null,
      purchase_order_id: d.purchase_order_id || null,
      tipo_comprobante: d.tipo_comprobante,
      punto_venta: d.punto_venta,
      numero: d.numero,
      cae: d.cae || null,
      fecha_emision: d.fecha_emision,
      fecha_vencimiento: d.fecha_vencimiento || null,
      moneda: d.moneda || "ARS",
      neto: d.neto,
      iva: d.iva,
      percepciones: d.percepciones ?? 0,
      total,
      observ: d.observ || null,
      created_by: user?.id ?? null,
    })
    .select("id, public_id")
    .single();

  if (error) {
    // Violación de unique (comprobante duplicado) → mensaje claro.
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un comprobante con ese tipo, punto de venta y número para este proveedor." };
    }
    return { ok: false, error: `No se pudo registrar la factura: ${error.message}` };
  }

  revalidatePath("/compras/facturas");
  return { ok: true, id: data.id, public_id: data.public_id };
}
