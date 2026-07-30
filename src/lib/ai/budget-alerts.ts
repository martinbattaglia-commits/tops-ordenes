import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// LINK-WA-002 · E1.1 · Guarda B — alerta auditable al 70 %, sin duplicados.
//
// El bloqueo al 100 % ya vive en budget.checkMonthlyBudget. Esto agrega el aviso
// TEMPRANO: cuando el gasto acumulado del mes cruza el umbral, se registra UNA
// alerta (unicidad por período+umbral en 0214) con separación por provider y
// modelo. Con provider mock el costo es 0 ⇒ jamás se alerta.
//
// 🔑 Invariante del módulo AI: se opera con la SESIÓN del usuario, nunca con
// service_role. Si la tabla todavía no existe (migración sin aplicar), la
// función degrada en silencio: NO puede romper un análisis por eso.

export const ALERT_THRESHOLD_PCT = 70;

export interface AlertOutcome {
  /** true sólo cuando ESTA corrida registró la alerta (primera vez del mes). */
  raised: boolean;
  spentUsd: number;
  capUsd: number;
  pct: number;
  /** true si ya estaba registrada por una corrida anterior (sin duplicar). */
  alreadyRaised: boolean;
}

/** 'YYYY-MM' del mes en curso (UTC: el cap es mensual global, no por zona). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function pctOf(spentUsd: number, capUsd: number): number {
  if (capUsd <= 0) return 0;
  return (spentUsd / capUsd) * 100;
}

/**
 * Evalúa el umbral y, si corresponde, registra la alerta.
 * Se llama DESPUÉS de una corrida con costo real (el gasto ya está contabilizado).
 */
export async function maybeRaiseBudgetAlert(
  supabase: SupabaseClient | null,
  opts: { provider: string; model: string | null; userId: string | null },
): Promise<AlertOutcome> {
  const capUsd = env.ai.limits.monthlyBudgetUsd;
  const none: AlertOutcome = { raised: false, spentUsd: 0, capUsd, pct: 0, alreadyRaised: false };
  // Mock = costo cero: no hay nada que alertar.
  if (!supabase || opts.provider === "mock") return none;

  const { data, error } = await supabase.rpc("ai_monthly_spend");
  if (error) return none; // no se rompe el análisis por no poder leer el agregado
  const spentUsd = Number(data) || 0;
  const pct = pctOf(spentUsd, capUsd);
  if (pct < ALERT_THRESHOLD_PCT) return { ...none, spentUsd, pct };

  // Anti-duplicado real: lo garantiza el UNIQUE(period, threshold_pct) de 0214.
  const period = currentPeriod();
  const { data: inserted, error: insErr } = await supabase
    .from("ai_budget_alerts")
    .upsert(
      {
        period,
        threshold_pct: ALERT_THRESHOLD_PCT,
        spent_usd: spentUsd,
        cap_usd: capUsd,
        provider: opts.provider,
        model: opts.model,
        raised_by: opts.userId,
      },
      { onConflict: "period,threshold_pct", ignoreDuplicates: true },
    )
    .select("id");

  if (insErr) return { ...none, spentUsd, pct };
  const raised = (inserted ?? []).length > 0;
  return { raised, alreadyRaised: !raised, spentUsd, capUsd, pct };
}

/** Mensaje humano de la alerta (para auditoría / UI). */
export function alertMessage(o: AlertOutcome): string {
  return `Presupuesto de IA al ${o.pct.toFixed(1)} % — USD ${o.spentUsd.toFixed(4)} de USD ${o.capUsd.toFixed(2)}. Bloqueo automático al 100 %.`;
}
