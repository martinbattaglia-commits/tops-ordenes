"use server";

/**
 * Server Actions para el dominio Finanzas (Previsiones y Proyecciones).
 * Maneja la persistencia y reconciliación de finance_forecast_adjustments en Supabase.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isFinanceDirectorEmail } from "@/lib/rbac/boot-permissions";
import type {
  FinanceDirection,
  FinanceCurrency,
  FinanceAccountGroup,
  FinanceCertaintyLevel,
  FinanceForecastAdjustment,
} from "./types";

export interface CreateForecastAdjustmentInput {
  date: string;
  due_date?: string | null;
  direction: FinanceDirection;
  amount: number;
  currency: FinanceCurrency;
  account_group: FinanceAccountGroup;
  bank_account_id?: string | null;
  counterpart?: string | null;
  concept: string;
  category_id?: string | null;
  cost_center_id?: string | null;
  certainty_level?: FinanceCertaintyLevel;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  notes?: string | null;
  evidence_url?: string | null;
}

export type FinanceActionResult<T = unknown> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

function revalidateFinance(): void {
  revalidatePath("/finanzas");
  revalidatePath("/finanzas/caja-liquidez");
  revalidatePath("/finanzas/resumen");
  revalidatePath("/tesoreria");
}

async function isAuthorizedFinanceDirector(
  supabase: NonNullable<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return !error && !!user && isFinanceDirectorEmail(user.email);
}

/**
 * Crea una previsión financiera (transacción programada o recurrente).
 */
export async function createForecastAdjustmentAction(
  input: CreateForecastAdjustmentInput
): Promise<FinanceActionResult<FinanceForecastAdjustment>> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  if (!(await isAuthorizedFinanceDirector(supabase))) {
    return { ok: false, message: "Acceso no autorizado." };
  }

  if (!input.concept?.trim()) {
    return { ok: false, message: "El concepto es obligatorio." };
  }
  if (!input.amount || input.amount <= 0) {
    return { ok: false, message: "El importe debe ser mayor a 0." };
  }
  if (!input.date) {
    return { ok: false, message: "La fecha es obligatoria." };
  }

  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("finance_forecast_adjustments")
    .insert({
      date: input.date,
      due_date: input.due_date || null,
      direction: input.direction,
      amount: input.amount,
      currency: input.currency || "ARS",
      account_group: input.account_group || "bancos",
      bank_account_id: input.bank_account_id || null,
      counterpart: input.counterpart?.trim() || null,
      concept: input.concept.trim(),
      category_id: input.category_id || null,
      cost_center_id: input.cost_center_id || null,
      status: "proyectado",
      certainty_level: input.certainty_level || "alta",
      is_recurring: Boolean(input.is_recurring),
      recurrence_rule: input.recurrence_rule || null,
      notes: input.notes?.trim() || null,
      evidence_url: input.evidence_url?.trim() || null,
      created_by: user?.user?.id || null,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false, message: `Error al guardar previsión: ${error.message}` };
  }

  revalidateFinance();
  return { ok: true, message: "Previsión financiera guardada exitosamente.", data: data as FinanceForecastAdjustment };
}



/**
 * Anula una previsión financiera programada.
 */
export async function voidForecastAdjustmentAction(
  forecastId: string,
  reason?: string
): Promise<FinanceActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };
  if (!(await isAuthorizedFinanceDirector(supabase))) {
    return { ok: false, message: "Acceso no autorizado." };
  }

  const { error } = await supabase.rpc("finance_void_forecast", {
    p_forecast_id: forecastId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: `Error al anular previsión: ${error.message}` };
  }

  revalidateFinance();
  return { ok: true, message: "Previsión anulada correctamente." };
}

export interface QuickenRowRecord {
  id: string;
  source_line: number;
  date: string;
  scheduled_status: string | null;
  split_info: string | null;
  payee: string;
  category: string;
  amount: number;
  direction: "ingreso" | "egreso";
  account: string;
  currency: string;
  is_duplicate: boolean;
  is_transfer: boolean;
  transfer_account: string | null;
  raw_line: string;
}

export interface QuickenSearchQuery {
  search?: string;
  account?: string;
  year?: string;
  direction?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Consulta filtrada y paginada del repositorio histórico de Quicken.
 */
export async function getQuickenHistoryAction(params: QuickenSearchQuery) {
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Base de datos no disponible", rows: [] as QuickenRowRecord[], total: 0, totalInflows: 0, totalOutflows: 0 };
  }
  if (!(await isAuthorizedFinanceDirector(supabase))) {
    return { ok: false, message: "Acceso no autorizado.", rows: [] as QuickenRowRecord[], total: 0, totalInflows: 0, totalOutflows: 0 };
  }

  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(10, params.pageSize || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from("finance_quicken_import_rows")
    .select(
      "id, source_line, date, scheduled_status, split_info, payee, category, amount, direction, account, currency, is_duplicate, is_transfer, transfer_account, raw_line",
      { count: "exact" }
    );

  if (params.search && params.search.trim()) {
    const s = params.search.trim();
    q = q.or(`payee.ilike.%${s}%,category.ilike.%${s}%,account.ilike.%${s}%`);
  }

  if (params.account && params.account !== "ALL") {
    q = q.eq("account", params.account);
  }

  if (params.year && params.year !== "ALL") {
    q = q.gte("date", `${params.year}-01-01`).lte("date", `${params.year}-12-31`);
  }

  if (params.direction === "ingreso") {
    q = q.eq("direction", "ingreso").eq("is_transfer", false);
  } else if (params.direction === "egreso") {
    q = q.eq("direction", "egreso").eq("is_transfer", false);
  } else if (params.direction === "transferencia") {
    q = q.eq("is_transfer", true);
  }

  if (params.status && params.status !== "ALL") {
    if (params.status === "EJECUTADO") {
      q = q.is("scheduled_status", null);
    } else {
      q = q.eq("scheduled_status", params.status);
    }
  }

  q = q.order("date", { ascending: false }).range(from, to);

  const { data, count, error } = await q;

  if (error) {
    return { ok: false, message: error.message, rows: [] as QuickenRowRecord[], total: 0 };
  }

  return {
    ok: true,
    rows: (data || []) as QuickenRowRecord[],
    total: count || 0,
    page,
    pageSize,
  };
}

/**
 * Obtiene el resumen general del lote histórico de Quicken.
 */
export async function getQuickenSummaryAction() {
  const supabase = createClient();
  if (!supabase) return { ok: false, summary: null };
  if (!(await isAuthorizedFinanceDirector(supabase))) {
    return { ok: false, summary: null };
  }

  const { data, error } = await supabase
    .from("finance_quicken_imports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return { ok: false, summary: null };
  return { ok: true, summary: data };
}
