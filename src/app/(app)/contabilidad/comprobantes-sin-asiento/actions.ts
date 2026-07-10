"use server";

/**
 * Simulador de contabilización (F6 · Etapa 2 del piloto).
 *
 * INVARIANTE DE SEGURIDAD: `p_dry_run` va SIEMPRE en `true`, hardcodeado acá,
 * del lado del servidor. Este módulo NO tiene ningún camino que postee de
 * verdad. El dry-run de `acc_create_posted_entry` retorna ANTES de todo
 * INSERT y antes de `acc_ensure_period` (verificado en auditoría F6.1-B1 y
 * releído del catálogo de producción el 2026-07-10). Además, P6 manda
 * dry-run permanente hasta ratificación de la Contadora.
 */

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { denyReason } from "@/lib/rbac/guard";
import type { SimulacionLinea, SimulacionResult } from "@/lib/contabilidad/types";

/** Sources que el dispatcher `acc_post_document` sabe resolver. */
const SIMULABLE_SOURCES = new Set([
  "customer_invoice",
  "supplier_invoice",
  "customer_receipt",
  "supplier_payment",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DryRunLine {
  account_id?: string;
  description?: string;
  debit?: number | string;
  credit?: number | string;
  cost_center_id?: string | null;
  line_no?: number;
}

interface DryRunPayload {
  ok?: boolean;
  dry_run?: boolean;
  skipped?: boolean;
  message?: string;
  debit?: number;
  credit?: number;
  balanced?: boolean;
  lines?: DryRunLine[];
}

export async function simularAsiento(
  sourceType: string,
  sourceId: string,
): Promise<SimulacionResult> {
  // Guard de aplicación: el motor exige contabilidad.create vía
  // acc_require_post_permission; lo replicamos acá para fallar temprano.
  const denied = await denyReason("contabilidad.create");
  if (denied) return { ok: false, error: denied };

  if (!SIMULABLE_SOURCES.has(sourceType)) {
    return { ok: false, error: `Tipo de comprobante no simulable: ${sourceType}` };
  }
  if (!UUID_RE.test(sourceId)) {
    return { ok: false, error: "Identificador de comprobante inválido." };
  }

  if (env.app.demoMode || env.app.needsSupabase) {
    return { ok: false, error: "La simulación no está disponible en modo demo (requiere el motor contable)." };
  }
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible." };

  const { data, error } = await supabase.rpc("acc_post_document", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_dry_run: true, // INVARIANTE: jamás false en este módulo (P6 · SIMULATION)
  });

  if (error) {
    const msg = error.message ?? "Error desconocido";
    if (msg.includes("ACC_DENIED")) {
      return { ok: false, error: "El motor rechazó la simulación: requiere el permiso contabilidad.create." };
    }
    if (msg.includes("ACC_UNBALANCED")) {
      return { ok: false, error: `El asiento propuesto NO cuadra — hallazgo relevante para la Contadora. Detalle: ${msg}` };
    }
    return { ok: false, error: `El motor no pudo simular este comprobante: ${msg}` };
  }

  const payload = (data ?? {}) as DryRunPayload;

  if (payload.skipped) {
    return { ok: true, yaContabilizado: true };
  }
  if (payload.ok === false) {
    return { ok: false, error: `El motor devolvió: ${payload.message ?? "sin detalle"}` };
  }

  // Enriquecer las líneas con código/nombre de cuenta y centro de costo.
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  const accountIds = [...new Set(rawLines.map((l) => l.account_id).filter(Boolean))] as string[];
  const ccIds = [...new Set(rawLines.map((l) => l.cost_center_id).filter(Boolean))] as string[];

  const [accountsRes, ccRes] = await Promise.all([
    accountIds.length
      ? supabase.from("chart_of_accounts").select("id, code, name").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    ccIds.length
      ? supabase.from("cost_centers").select("id, name").in("id", ccIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const accMap = new Map<string, { code: string; name: string }>();
  for (const a of (accountsRes.data ?? []) as Array<{ id: string; code: string; name: string }>) {
    accMap.set(a.id, { code: a.code, name: a.name });
  }
  const ccMap = new Map<string, string>();
  for (const c of (ccRes.data ?? []) as Array<{ id: string; name: string }>) {
    ccMap.set(c.id, c.name);
  }

  const lineas: SimulacionLinea[] = rawLines.map((l, i) => ({
    account_id: l.account_id ?? "",
    cuenta_codigo: l.account_id ? (accMap.get(l.account_id)?.code ?? null) : null,
    cuenta_nombre: l.account_id ? (accMap.get(l.account_id)?.name ?? null) : null,
    description: l.description ?? null,
    debit: Number(l.debit ?? 0),
    credit: Number(l.credit ?? 0),
    centro_costo: l.cost_center_id ? (ccMap.get(l.cost_center_id) ?? null) : null,
    line_no: l.line_no ?? i + 1,
  }));

  return {
    ok: true,
    yaContabilizado: false,
    debit: payload.debit,
    credit: payload.credit,
    balanced: payload.balanced,
    lineas,
  };
}
