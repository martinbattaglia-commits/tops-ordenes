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

/** Inicio del día en hora local del server (suficiente para un límite diario). */
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
 *  propios del día (role='user') vía RLS. */
export async function checkBudget(
  supabase: SupabaseClient | null,
  userKey: string
): Promise<BudgetState> {
  const limit = env.ai.limits.requestsPerDay;
  if (!supabase) {
    return computeBudgetState(demoCount(userKey) - 1, limit);
  }
  const { count, error } = await supabase
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
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
