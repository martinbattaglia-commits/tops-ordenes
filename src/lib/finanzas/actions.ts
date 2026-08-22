"use server";

/**
 * Server Actions para el dominio Finanzas (Previsiones y Proyecciones).
 * Maneja la persistencia y reconciliación de finance_forecast_adjustments en Supabase.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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

/**
 * Crea una previsión financiera (transacción programada o recurrente).
 */
export async function createForecastAdjustmentAction(
  input: CreateForecastAdjustmentInput
): Promise<FinanceActionResult<FinanceForecastAdjustment>> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible." };

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
