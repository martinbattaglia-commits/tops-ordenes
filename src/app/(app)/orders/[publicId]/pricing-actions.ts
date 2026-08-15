"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FulfillmentSchema = z.object({
  publicId: z.string().min(3).max(80),
  lineId: z.string().uuid(),
  qty: z.coerce.number().min(0),
  reason: z.string().trim().min(3).max(500),
});

const BillingSchema = FulfillmentSchema.extend({
  amount: z.coerce.number().finite().min(0).max(999_999_999_999),
});

function back(publicId: string, key: "updated" | "error", message: string): never {
  redirect(`/orders/${encodeURIComponent(publicId)}?pricing=${key}&message=${encodeURIComponent(message)}`);
}

export async function recordFulfillmentAction(formData: FormData): Promise<never> {
  const parsed = FulfillmentSchema.safeParse({
    publicId: formData.get("public_id"),
    lineId: formData.get("line_id"),
    qty: formData.get("qty_provided"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const publicId = String(formData.get("public_id") ?? "");
    return back(publicId, "error", "Cantidad prestada y motivo son obligatorios.");
  }
  const supabase = createClient();
  if (!supabase) return back(parsed.data.publicId, "error", "Supabase no está disponible.");
  const { error } = await supabase.rpc("service_order_record_fulfillment", {
    p_order_service_id: parsed.data.lineId,
    p_qty_provided: parsed.data.qty,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error("[service-order-pricing] fulfillment failed", { code: "SERVICE_ORDER_FULFILLMENT_FAILED" });
    return back(parsed.data.publicId, "error", "No se pudo registrar la prestación.");
  }
  revalidatePath(`/orders/${parsed.data.publicId}`);
  return back(parsed.data.publicId, "updated", "Prestación registrada con auditoría.");
}

export async function adjustBillingAction(formData: FormData): Promise<never> {
  const parsed = BillingSchema.safeParse({
    publicId: formData.get("public_id"),
    lineId: formData.get("line_id"),
    qty: formData.get("qty_billed"),
    amount: formData.get("billed_amount"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const publicId = String(formData.get("public_id") ?? "");
    return back(publicId, "error", "Cantidad, importe final y motivo son obligatorios.");
  }
  const supabase = createClient();
  if (!supabase) return back(parsed.data.publicId, "error", "Supabase no está disponible.");
  const { error } = await supabase.rpc("service_order_adjust_billing", {
    p_order_service_id: parsed.data.lineId,
    p_billed_qty: parsed.data.qty,
    p_billed_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error("[service-order-pricing] billing adjustment failed", { code: "SERVICE_ORDER_BILLING_FAILED" });
    return back(parsed.data.publicId, "error", "No se pudo registrar el ajuste de facturación.");
  }
  revalidatePath(`/orders/${parsed.data.publicId}`);
  return back(parsed.data.publicId, "updated", "Facturación ajustada con autorización y auditoría.");
}
