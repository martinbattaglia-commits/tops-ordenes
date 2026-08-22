"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ApprovalSchema, ResetClientRateSchema } from "./schema";

export interface ClientCustomRateRow {
  id: string;
  client_id: string;
  service_slug: string;
  currency: "ARS" | "USD";
  rate: number;
  min_qty: number | null;
  min_billing: number | null;
  valid_from: string;
  valid_to: string | null;
  reason: string;
  created_at: string;
}

function finish(kind: "approved" | "error", message: string): never {
  redirect(`/orders/tarifas?result=${kind}&message=${encodeURIComponent(message)}`);
}

function reportTariffRpcError(operation: "save" | "reset", error: unknown): void {
  console.error("[tarifas] RPC rechazada", {
    operation,
    code: typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN",
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Server action interactiva para guardar/aprobar una tarifa personalizada con feedback visual.
 */
export async function saveClientRateAction(input: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = ApprovalSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || "Datos de tarifa inválidos. Verificá los campos.";
    return { ok: false, error: errorMsg };
  }

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Conexión a base de datos no disponible." };

  const { data: userAuth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !userAuth?.user) {
    return { ok: false, error: "Sesión expirada o no autenticada." };
  }

  const { data, error } = await supabase.rpc("client_service_rate_set", {
    p_client_id: parsed.data.clientId,
    p_service_slug: parsed.data.serviceSlug,
    p_currency: parsed.data.currency,
    p_rate: parsed.data.rate,
    p_min_qty: parsed.data.minQty === "" || parsed.data.minQty == null ? null : parsed.data.minQty,
    p_min_billing: parsed.data.minBilling === "" || parsed.data.minBilling == null ? null : parsed.data.minBilling,
    p_valid_from: parsed.data.validFrom,
    p_reason: parsed.data.reason,
  });

  if (error) {
    reportTariffRpcError("save", error);
    return {
      ok: false,
      error: "No pudimos aprobar el precio particular. Verificá la vigencia y reintentá.",
    };
  }
  if (!isUuid(data)) {
    reportTariffRpcError("save", { code: "INVALID_RPC_RESPONSE" });
    return { ok: false, error: "La base no confirmó la tarifa guardada. Reintentá antes de continuar." };
  }

  revalidatePath("/orders/tarifas");
  revalidatePath("/orders/new");
  revalidatePath(`/clientes/${parsed.data.clientId}`);
  revalidatePath("/clients");

  return {
    ok: true,
    message: "Tarifa personalizada guardada y sincronizada correctamente.",
  };
}

/**
 * Restablece la tarifa personalizada de un cliente para un servicio específico al precio de lista.
 */
export async function resetClientRateAction(
  clientId: string,
  serviceSlug: string
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = ResetClientRateSchema.safeParse({ clientId, serviceSlug });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Cliente y servicio inválidos." };

  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Base de datos no disponible." };

  const { data: userAuth, error: authError } = await supabase.auth.getUser();
  if (authError || !userAuth?.user) return { ok: false, error: "Sesión expirada o no autenticada." };

  const { data, error } = await supabase.rpc("client_service_rate_reset", {
    p_client_id: parsed.data.clientId,
    p_service_slug: parsed.data.serviceSlug,
    p_reason: "Restablecimiento solicitado desde Nexus",
  });

  if (error) {
    reportTariffRpcError("reset", error);
    return { ok: false, error: "No pudimos restablecer la tarifa. Reintentá o contactá a soporte." };
  }
  if (data !== true) {
    return { ok: false, error: "No había una tarifa personalizada vigente o futura para restablecer." };
  }

  revalidatePath("/orders/tarifas");
  revalidatePath("/orders/new");
  revalidatePath(`/clientes/${parsed.data.clientId}`);
  revalidatePath("/clients");

  return {
    ok: true,
    message: "Tarifa restablecida al precio de lista estándar.",
  };
}

/**
 * Obtiene todas las tarifas personalizadas activas de un cliente.
 */
export async function getClientCustomRates(clientId: string): Promise<ClientCustomRateRow[]> {
  const supabase = createClient();
  if (!supabase || !clientId) return [];

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("client_service_rates")
    .select("id, client_id, service_slug, currency, rate, min_qty, min_billing, valid_from, valid_to, reason, created_at")
    .eq("client_id", clientId)
    .or(`valid_to.is.null,valid_to.gt.${nowIso}`)
    .order("valid_from", { ascending: true });

  if (error || !data) return [];
  return data as ClientCustomRateRow[];
}

/**
 * Compatibilidad con formulario POST tradicional (no rompe contratos previos).
 */
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
  const { data, error } = await supabase.rpc("client_service_rate_set", {
    p_client_id: parsed.data.clientId,
    p_service_slug: parsed.data.serviceSlug,
    p_currency: parsed.data.currency,
    p_rate: parsed.data.rate,
    p_min_qty: parsed.data.minQty === "" || parsed.data.minQty == null ? null : parsed.data.minQty,
    p_min_billing: parsed.data.minBilling === "" || parsed.data.minBilling == null ? null : parsed.data.minBilling,
    p_valid_from: parsed.data.validFrom,
    p_reason: parsed.data.reason,
  });
  if (error) return finish("error", "No pudimos aprobar el precio particular. Revisá la vigencia y reintentá.");
  if (!isUuid(data)) return finish("error", "La base no confirmó el precio particular. Reintentá antes de continuar.");
  revalidatePath("/orders/tarifas");
  revalidatePath("/orders/new");
  if (parsed.data.clientId) revalidatePath(`/clientes/${parsed.data.clientId}`);
  return finish("approved", "Precio particular aprobado para la vigencia indicada.");
}
