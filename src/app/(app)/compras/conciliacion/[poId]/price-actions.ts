"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReconcilePriceResult = { ok: true } | { ok: false; error: string };

export async function reconcilePurchasePricesAction(input: {
  orderId: string;
  invoiceId: string;
  reason: string;
  lines: Array<{ item_id: string; actual_unit_price: number }>;
}): Promise<ReconcilePriceResult> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.orderId) || !uuid.test(input.invoiceId)) {
    return { ok: false, error: "Identidad de OC o factura inválida." };
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    return { ok: false, error: "Ingresá un motivo de conciliación (3 a 500 caracteres)." };
  }
  if (input.lines.length === 0 || input.lines.some((line) =>
    !uuid.test(line.item_id)
    || !Number.isFinite(line.actual_unit_price)
    || line.actual_unit_price < 0
    || line.actual_unit_price >= 1_000_000_000_000
    || Math.round(line.actual_unit_price * 100) / 100 !== line.actual_unit_price
  )) {
    return { ok: false, error: "Cada línea requiere un precio real no negativo." };
  }
  if (new Set(input.lines.map((line) => line.item_id)).size !== input.lines.length) {
    return { ok: false, error: "Hay líneas duplicadas en la conciliación." };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión requerida." };

  const { error } = await supabase.rpc("po_reconcile_prices", {
    p_order_id: input.orderId,
    p_invoice_id: input.invoiceId,
    p_lines: input.lines,
    p_reason: reason,
  });
  if (error) {
    console.error("[compras] price reconciliation failed", { code: "PO_PRICE_RECONCILIATION_FAILED" });
    return { ok: false, error: "No pudimos conciliar los precios. Revisá los datos y reintentá." };
  }

  revalidatePath(`/compras/conciliacion/${input.orderId}`);
  revalidatePath("/compras/ordenes");
  return { ok: true };
}
