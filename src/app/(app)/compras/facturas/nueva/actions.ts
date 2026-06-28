"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  CreateSupplierInvoiceSchema,
  formatZodIssues,
  type CreateSupplierInvoiceInput,
} from "@/lib/erp/validation";
import { humanizeApRpcError } from "@/lib/erp/errors";

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

/**
 * Alta de factura de proveedor — ERP-B2.
 *
 * Adaptador fino sobre la RPC `ap_create_supplier_invoice` (0058, RPC-First):
 *   · valida el input (zod, espejo de las CHECK fiscales),
 *   · arma p_header / p_vat_lines / p_other_taxes / p_items,
 *   · delega TODA la integridad fiscal al RPC (reconcilia cabecera desde el
 *     detalle, valida pares AFIP, IVA coherente, identidad del total, audita).
 *
 * Reemplaza el INSERT directo legacy: ahora TODA factura termina en
 * supplier_invoice_vat_lines / _other_taxes / _items. El RPC es la autoridad.
 */
export async function createSupplierInvoiceAction(
  input: CreateSupplierInvoiceInput
): Promise<CreateSupplierInvoiceResult> {
  const parsed = CreateSupplierInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: formatZodIssues(parsed.error) };
  }
  const d = parsed.data;

  // Total derivado del detalle (defensa en profundidad: el RPC lo revalida).
  const netoGravado = d.vat_lines.reduce((s, l) => s + l.base_neto, 0);
  const ivaTotal = d.vat_lines.reduce((s, l) => s + l.importe_iva, 0);
  const percepTotal = d.other_taxes
    .filter((t) => t.tax_kind.startsWith("PERCEPCION_"))
    .reduce((s, t) => s + t.importe, 0);
  const tributosTotal = d.other_taxes
    .filter((t) => t.tax_kind === "IMPUESTO_INTERNO" || t.tax_kind === "OTRO")
    .reduce((s, t) => s + t.importe, 0);
  const total =
    netoGravado + d.importe_no_gravado + d.importe_exento + ivaTotal + percepTotal + tributosTotal;

  // Demo mode → no persistimos; devolvemos un public_id sintético.
  if (env.app.demoMode || env.app.needsSupabase) {
    const short = Math.floor(Math.random() * 9000) + 1000;
    return { ok: true, id: `demo-${short}`, public_id: `FP-2026-${String(short).padStart(4, "0")}` };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const p_header = {
    vendor_id: d.vendor_id,
    cost_center_id: d.cost_center_id || null,
    purchase_order_id: d.purchase_order_id || null,
    tipo_comprobante: d.tipo_comprobante,
    punto_venta: String(d.punto_venta),
    numero: d.numero,
    cae: d.cae || null,
    fecha_emision: d.fecha_emision,
    fecha_vencimiento: d.fecha_vencimiento || null,
    moneda: d.moneda || "ARS",
    importe_no_gravado: d.importe_no_gravado,
    importe_exento: d.importe_exento,
    total, // el RPC valida |declarado − derivado| ≤ 0.02
    observ: d.observ || null,
  };

  const p_vat_lines = d.vat_lines.map((l) => ({
    alic_iva_id: l.alic_iva_id,
    alicuota_iva: l.alicuota_iva,
    base_neto: l.base_neto,
    importe_iva: l.importe_iva,
  }));

  const p_other_taxes = d.other_taxes.map((t) => ({
    tax_kind: t.tax_kind,
    jurisdiction: t.jurisdiction || null,
    base: t.base ?? null,
    alicuota: t.alicuota ?? null,
    importe: t.importe,
  }));

  const p_items = d.items.map((it, i) => ({
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    alic_iva_id: it.alic_iva_id,
    importe_neto: it.importe_neto,
    importe_iva: it.importe_iva,
    importe_total: it.importe_total,
    orden: it.orden || i,
  }));

  const { data, error } = await supabase.rpc("ap_create_supplier_invoice", {
    p_header,
    p_vat_lines,
    p_other_taxes,
    p_items,
  });

  if (error) {
    return { ok: false, error: humanizeApRpcError(error.message) };
  }

  // El RPC devuelve jsonb { invoice_id, public_id, ... }
  const result = (data ?? {}) as { invoice_id?: string; public_id?: string };
  if (!result.invoice_id) {
    return { ok: false, error: "La factura no se registró correctamente." };
  }

  revalidatePath("/compras/facturas");
  return { ok: true, id: result.invoice_id, public_id: result.public_id ?? "" };
}
