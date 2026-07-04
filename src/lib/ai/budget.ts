// F5.2-lite · Presupuesto duro del piloto (D-F5-8). Sin llamadas ilimitadas:
// el único camino al provider es el engine, y el engine SIEMPRE pasa por acá.
// Parte pura (computeBudgetState) testeable; el conteo real usa la RLS del
// usuario (solo cuenta SUS mensajes — nunca lee actividad de terceros).

import { env } from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BudgetState {
  allowed: boolean;
  requestsToday: number;
  limit: number;
  reason: string | null;
}

/** Parte pura: decide contra el límite configurado. */
export function computeBudgetState(requestsToday: number, limit: number): BudgetState {
  const allowed = requestsToday < limit;
  return {
    allowed,
    requestsToday,
    limit,
    reason: allowed
      ? null
      : `Alcanzaste el límite del piloto (${limit} consultas por día). Volvé mañana o pedile a Dirección que lo ajuste.`,
  };
}

/** Inicio del día en hora local del server (suficiente para un límite diario).
 *  NOTA: en prod el host corre en UTC → la ventana diaria resetea a medianoche
 *  UTC (21:00 ART). Es una propiedad del contador diario (independiente del
 *  `expires_at` de los overrides, que es UTC-absoluto); solo mueve la HORA del
 *  reset, nunca ensancha el límite. */
export function startOfTodayIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Contador in-memory para demo mode (sin DB). Por proceso: suficiente para QA.
const demoCounters = new Map<string, { day: string; count: number }>();

export function demoCount(userKey: string, now = new Date()): number {
  const day = now.toDateString();
  const entry = demoCounters.get(userKey);
  if (!entry || entry.day !== day) {
    demoCounters.set(userKey, { day, count: 1 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * Tope mensual global en USD (D-F5-8) — solo aplica con provider REAL
 * (mock = costo cero, no se chequea). Lee el agregado vía RPC SECURITY
 * DEFINER ai_monthly_spend() (número agregado, sin contenido). Fail-closed.
 */
export async function checkMonthlyBudget(
  supabase: SupabaseClient | null
): Promise<BudgetState> {
  const cap = env.ai.limits.monthlyBudgetUsd;
  if (env.ai.provider === "mock" || !supabase) {
    return { allowed: true, requestsToday: 0, limit: cap, reason: null };
  }
  const { data, error } = await supabase.rpc("ai_monthly_spend");
  if (error) {
    return {
      allowed: false,
      requestsToday: -1,
      limit: cap,
      reason: "No pude verificar el presupuesto mensual de IA; reintentá en un momento.",
    };
  }
  const spent = Number(data) || 0;
  if (spent >= cap) {
    return {
      allowed: false,
      requestsToday: -1,
      limit: cap,
      reason: `El presupuesto mensual de IA (USD ${cap}) está agotado. Dirección puede ajustarlo o esperar al próximo mes.`,
    };
  }
  return { allowed: true, requestsToday: 0, limit: cap, reason: null };
}

/** Chequea y consume una unidad de presupuesto. En real: cuenta ai_messages
 *  PROPIOS del día (role='user') con filtro EXPLÍCITO por user_id — NUNCA se
 *  apoya en la RLS para acotar las filas: la policy de ai_messages es
 *  `(user_id = auth.uid() OR is_admin())`, así que para un admin el conteo sin
 *  filtro devolvería mensajes de TERCEROS (global), no los suyos (bug F5).
 *  El límite diario se resuelve por usuario vía ai_daily_limit_for() (override
 *  vigente → default). Fail-closed: ante cualquier duda, el default (más bajo). */
export async function checkBudget(
  supabase: SupabaseClient | null,
  userKey: string
): Promise<BudgetState> {
  const defaultLimit = env.ai.limits.requestsPerDay;
  if (!supabase) {
    return computeBudgetState(demoCount(userKey) - 1, defaultLimit);
  }
  // Límite efectivo del usuario actual (override vigente si existe). Fail-closed:
  // si la función no está o falla, se usa el default (nunca uno más permisivo).
  let limit = defaultLimit;
  const { data: limitData, error: limitError } = await supabase.rpc(
    "ai_daily_limit_for",
    { p_default: defaultLimit }
  );
  if (!limitError) {
    const resolved = Number(limitData);
    if (Number.isFinite(resolved) && resolved > 0) limit = resolved;
  }
  // Conteo SIEMPRE personal: filtro explícito por user_id (no depende de la RLS).
  const { count, error } = await supabase
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userKey)
    .eq("role", "user")
    .gte("created_at", startOfTodayIso());
  if (error) {
    // Fail-closed: si no podemos contar, no gastamos (presupuesto es un guard).
    return {
      allowed: false,
      requestsToday: -1,
      limit,
      reason: "No pude verificar tu presupuesto diario; reintentá en un momento.",
    };
  }
  return computeBudgetState(count ?? 0, limit);
}
