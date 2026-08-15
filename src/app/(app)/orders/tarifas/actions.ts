"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ApprovalSchema = z.object({
  clientId: z.string().uuid(),
  serviceSlug: z.string().trim().min(2).max(160),
  currency: z.enum(["ARS", "USD"]),
  rate: z.coerce.number().positive(),
  minQty: z.union([z.literal(""), z.coerce.number().min(0)]),
  minBilling: z.union([z.literal(""), z.coerce.number().min(0)]),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(500),
});

function finish(kind: "approved" | "error", message: string): never {
  redirect(`/orders/tarifas?result=${kind}&message=${encodeURIComponent(message)}`);
}

export async function approveClientRateAction(formData: FormData): Promise<never> {
  const parsed = ApprovalSchema.safeParse({
    clientId: formData.get("client_id"),
    serviceSlug: formData.get("service_slug"),
    currency: formData.get("currency"),
    rate: formData.get("rate"),
    minQty: formData.get("min_qty"),
    minBilling: formData.get("min_billing"),
    validFrom: formData.get("valid_from"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return finish("error", "Completá cliente, servicio, precio, vigencia y motivo.");
  const supabase = createClient();
  if (!supabase) return finish("error", "Supabase no está disponible.");
  const { error } = await supabase.rpc("client_service_rate_set", {
    p_client_id: parsed.data.clientId,
    p_service_slug: parsed.data.serviceSlug,
    p_currency: parsed.data.currency,
    p_rate: parsed.data.rate,
    p_min_qty: parsed.data.minQty === "" ? null : parsed.data.minQty,
    p_min_billing: parsed.data.minBilling === "" ? null : parsed.data.minBilling,
    p_valid_from: parsed.data.validFrom,
    p_reason: parsed.data.reason,
  });
  if (error) return finish("error", "No pudimos aprobar el precio particular. Revisá la vigencia y reintentá.");
  revalidatePath("/orders/tarifas");
  revalidatePath("/orders/new");
  return finish("approved", "Precio particular aprobado para la vigencia indicada.");
}
