"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Server Actions del módulo Contabilidad — adaptadores finos sobre las RPC
 * SECURITY DEFINER (0085). El control de permiso vive DENTRO de la RPC
 * (has_permission('contabilidad.create')); acá solo se invoca y se humaniza el
 * resultado. Nunca se escribe contabilidad por fuera de la RPC.
 */

export interface AccActionResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

function unavailable(): AccActionResult {
  return { ok: false, message: "Supabase no está configurado en este entorno." };
}

/** Contabiliza un comprobante puntual (factura/cobranza/pago). */
export async function contabilizarDocumento(
  sourceType: string,
  sourceId: string
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();

  const { data, error } = await supabase.rpc("acc_post_document", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_dry_run: false,
  });
  if (error) return { ok: false, message: error.message };

  const res = data as { ok?: boolean; skipped?: boolean; entry_number?: number; message?: string } | null;
  revalidatePath("/contabilidad/comprobantes");
  revalidatePath("/contabilidad/libro-diario");
  if (res?.skipped) return { ok: true, message: "El comprobante ya estaba contabilizado." };
  if (res?.ok) return { ok: true, message: `Asiento N° ${res.entry_number ?? "—"} generado.`, data: res };
  return { ok: false, message: res?.message ?? "No se pudo contabilizar." };
}

/** Backfill: simula (dry-run) o ejecuta la contabilización masiva de un tipo. */
export async function backfill(
  sourceType: string,
  dryRun: boolean,
  from?: string | null,
  to?: string | null
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();

  const { data, error } = await supabase.rpc("acc_backfill", {
    p_source_type: sourceType,
    p_dry_run: dryRun,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) return { ok: false, message: error.message };

  const res = data as {
    ok?: boolean;
    candidates?: number;
    posted_or_preview?: number;
    skipped_existing?: number;
    errors?: number;
  } | null;
  if (!dryRun) {
    revalidatePath("/contabilidad/comprobantes");
    revalidatePath("/contabilidad/libro-diario");
    revalidatePath("/contabilidad/balance");
  }
  const verb = dryRun ? "Simulación" : "Contabilización";
  return {
    ok: Boolean(res?.ok),
    message: `${verb} ${sourceType}: ${res?.candidates ?? 0} candidatos · ${res?.posted_or_preview ?? 0} ${dryRun ? "a generar" : "generados"} · ${res?.skipped_existing ?? 0} ya existentes · ${res?.errors ?? 0} errores.`,
    data: res,
  };
}

/** Revierte un asiento posteado (genera asiento inverso; nunca borra). */
export async function revertirAsiento(entryId: string, reason: string): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();

  const { data, error } = await supabase.rpc("acc_reverse_entry", {
    p_entry_id: entryId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/contabilidad/libro-diario");
  const res = data as { ok?: boolean; skipped?: boolean } | null;
  if (res?.skipped) return { ok: true, message: "El asiento ya estaba revertido." };
  return { ok: Boolean(res?.ok), message: res?.ok ? "Asiento revertido." : "No se pudo revertir.", data: res };
}

// ----- Fase 11: pago con retenciones nativo + carga de percepciones -----

export interface PagoRetencionInput {
  vendorId: string;
  paymentDate: string;
  paymentMethod: string; // transferencia | cheque | echeq
  bankAccountId: string;
  operationNumber?: string;
  observations?: string;
  allocations: { supplierInvoiceId: string; grossAmount: number }[];
  withholdings: {
    withholdingType: string;
    withholdingName?: string;
    jurisdiction?: string;
    taxBase?: number;
    rate?: number;
    amount: number;
    certificateNumber?: string;
    supplierInvoiceId?: string;
  }[];
}

/** Registra un pago a proveedor con retenciones (bruto/retención/neto) — RPC nativa 0090. */
export async function registrarPagoConRetenciones(input: PagoRetencionInput): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();

  const { data, error } = await supabase.rpc("tesoreria_register_supplier_payment_neto", {
    p_vendor_id: input.vendorId,
    p_payment_date: input.paymentDate,
    p_payment_method: input.paymentMethod,
    p_bank_account_id: input.bankAccountId,
    p_allocations: input.allocations.map((a) => ({
      supplier_invoice_id: a.supplierInvoiceId,
      gross_amount: a.grossAmount,
    })),
    p_withholdings: input.withholdings.map((w) => ({
      supplier_invoice_id: w.supplierInvoiceId ?? null,
      withholding_type: w.withholdingType,
      withholding_name: w.withholdingName ?? null,
      jurisdiction: w.jurisdiction ?? "",
      tax_base: w.taxBase ?? 0,
      rate: w.rate ?? null,
      amount: w.amount,
      certificate_number: w.certificateNumber ?? null,
    })),
    p_operation_number: input.operationNumber ?? null,
    p_observations: input.observations ?? null,
    p_attachment: null,
  });
  if (error) return { ok: false, message: error.message };

  const res = data as { public_id?: string; gross_amount?: number; withheld_amount?: number; net_amount?: number } | null;
  revalidatePath("/contabilidad/retenciones");
  revalidatePath("/contabilidad/comprobantes");
  return {
    ok: true,
    message: `Pago ${res?.public_id ?? ""} registrado — bruto ${res?.gross_amount ?? 0}, retención ${res?.withheld_amount ?? 0}, neto ${res?.net_amount ?? 0}. Contabilizalo en "Pendientes de contabilizar".`,
    data: res,
  };
}

/** Carga percepciones/otros tributos en una factura de venta — RPC 0087. */
export async function cargarPercepcionesVenta(
  invoiceId: string,
  taxes: { taxType: string; taxName?: string; jurisdiction?: string; taxBase?: number; rate?: number; amount: number }[]
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();

  const { data, error } = await supabase.rpc("ventas_persist_other_taxes", {
    p_invoice_id: invoiceId,
    p_taxes: taxes.map((t) => ({
      tax_type: t.taxType,
      tax_name: t.taxName ?? null,
      jurisdiction: t.jurisdiction ?? "",
      tax_base: t.taxBase ?? 0,
      rate: t.rate ?? null,
      amount: t.amount,
    })),
  });
  if (error) return { ok: false, message: error.message };

  const res = data as { insertados?: number; recibidos?: number } | null;
  revalidatePath("/contabilidad/percepciones-ventas");
  return {
    ok: true,
    message: `Percepciones cargadas: ${res?.insertados ?? 0} de ${res?.recibidos ?? 0} (las duplicadas se omiten).`,
    data: res,
  };
}

// ----- Fase 12: logística facturable + simulación de cierre -----

/** Marca el estado de facturación de una orden logística (no 'invoiced'). */
export async function marcarOrdenBilling(
  orderId: string,
  status: "pending" | "ready_to_invoice" | "not_billable" | "cancelled",
  opts?: { billableAmount?: number; costCenterId?: string; notes?: string }
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();
  const { data, error } = await supabase.rpc("logistics_set_billing_status", {
    p_order_id: orderId,
    p_status: status,
    p_billable_amount: opts?.billableAmount ?? null,
    p_period_start: null,
    p_period_end: null,
    p_cost_center_id: opts?.costCenterId ?? null,
    p_notes: opts?.notes ?? null,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/contabilidad/ordenes-facturar");
  return { ok: true, message: `Orden marcada como ${status}.`, data };
}

/** Vincula órdenes logísticas a una factura de venta ya emitida (sin duplicar). */
export async function vincularFacturaOrdenes(
  orderIds: string[],
  customerInvoiceId: string
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();
  const { data, error } = await supabase.rpc("logistics_link_invoice", {
    p_order_ids: orderIds,
    p_customer_invoice_id: customerInvoiceId,
    p_period_start: null,
    p_period_end: null,
  });
  if (error) return { ok: false, message: error.message };
  const res = data as { linked?: number; skipped?: number } | null;
  revalidatePath("/contabilidad/ordenes-facturar");
  return { ok: true, message: `Vinculadas ${res?.linked ?? 0} órdenes (${res?.skipped ?? 0} ya vinculadas).`, data: res };
}

/** Simula el cierre de un período (READ-ONLY; no modifica datos). */
export async function simularCierre(
  periodId: string,
  closingType = "income_statement_closing"
): Promise<AccActionResult> {
  if (env.app.demoMode || env.app.needsSupabase) return unavailable();
  const supabase = createClient();
  if (!supabase) return unavailable();
  const { data, error } = await supabase.rpc("acc_simulate_closing", {
    p_period_id: periodId,
    p_closing_type: closingType,
  });
  if (error) return { ok: false, message: error.message };
  const res = data as { ready?: boolean; resultado?: number; blockers?: unknown[] } | null;
  const blockers = Array.isArray(res?.blockers) ? res!.blockers : [];
  return {
    ok: true,
    message: res?.ready
      ? `Período listo. Resultado a refundir: ${res?.resultado ?? 0}. (Simulación, no se modificó nada.)`
      : `Período NO listo. Bloqueos: ${blockers.join(", ") || "—"}.`,
    data: res,
  };
}
