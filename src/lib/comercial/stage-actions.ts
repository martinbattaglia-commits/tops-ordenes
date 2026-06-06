"use server";

/**
 * stage-actions.ts — Write-Path (F2.1-8) · W-2 · Server Actions del CRM.
 *
 * Envuelven las funciones RPC transaccionales validadas en W-1 (0047):
 *   advanceStage         → crm_advance_stage
 *   reserveCapacity      → crm_reserve_capacity (con p_available_m2 del motor)
 *   completeOnboarding   → crm_complete_onboarding
 *   updateOpportunityFields → UPDATE directo (lista blanca; NO toca estado/committed)
 *
 * Patrón (espejo de capture-actions.ts): "use server", createClient() de sesión
 * (RLS aplica · auth.uid() para el ledger), resultado tipado, resiliente si
 * Supabase no está configurado o las tablas no existen (runtime contra PROD).
 *
 * Tras cada escritura exitosa se revalidan las rutas afectadas → el Dashboard de
 * vacancia (force-dynamic) refleja la vacancia comercial/proyectada al instante.
 *
 * NO toca producción, main, Netlify, Clientify ni el Dashboard Corporativo (lo
 * consume vía revalidación, no lo modifica).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCommittedSnapshot } from "./committed-capacity";
import { findAvailability, type CapacityCategory } from "@/lib/wms/corporate-capacity";
import type { CrmStage, CrmService, CommittedState } from "./crm-types";

// ── Resultado tipado ──────────────────────────────────────────────────────
export interface OpportunitySnapshot {
  id: string;
  estado: CrmStage;
  committedState: CommittedState;
  assignedSite: string | null;
}
export type ActionResult =
  | { ok: true; message: string; opportunity?: OpportunitySnapshot }
  | { ok: false; message: string };

const SERVICE_TO_CATEGORY: Record<CrmService, CapacityCategory> = {
  anmat: "anmat",
  general: "general",
  oficinas: "oficina",
};

const KNOWN_SITES = ["PEDRO_LUJAN_3159", "MAGALDI_1765"] as const;
export type AssignedSite = (typeof KNOWN_SITES)[number];

// Mensajes legibles para los códigos de excepción de 0047.
function humanizeRpcError(message: string): string {
  const m = message || "";
  if (m.includes("INVALID_TRANSITION")) return "Transición de etapa no permitida.";
  if (m.includes("GANADO_REQUIRES_CAPACITY")) return "No se puede ganar sin capacidad reservada. Reservá un sitio primero.";
  if (m.includes("INSUFFICIENT_CAPACITY")) return "No hay capacidad suficiente en el sitio para los m² requeridos.";
  if (m.includes("CANNOT_RESERVE_LOST")) return "No se puede reservar capacidad para una oportunidad perdida.";
  if (m.includes("INVALID_SITE")) return "Sitio no reconocido.";
  if (m.includes("INVALID_UNITS")) return "Debés indicar al menos una unidad a reservar.";
  if (m.includes("ONBOARDING_REQUIRES_GANADO")) return "El onboarding solo se completa en oportunidades ganadas.";
  if (m.includes("ONBOARDING_NOT_FOUND")) return "No hay un onboarding asociado a la oportunidad.";
  if (m.includes("OPP_NOT_FOUND")) return "Oportunidad inexistente o sin permisos para operarla.";
  return m;
}

interface OppRowRpc {
  id: string;
  estado: CrmStage;
  committed_state: CommittedState;
  assigned_site: string | null;
}
function toSnapshot(row: OppRowRpc | null): OpportunitySnapshot | undefined {
  if (!row) return undefined;
  return { id: row.id, estado: row.estado, committedState: row.committed_state, assignedSite: row.assigned_site };
}

function revalidateOpportunity(opportunityId: string): void {
  revalidatePath(`/comercial/oportunidades/${opportunityId}`);
  revalidatePath("/comercial/oportunidades");
  revalidatePath("/comercial/dashboard-vacancia");
  revalidatePath("/comercial/pipeline");
}

// ── 1) advanceStage ───────────────────────────────────────────────────────
export async function advanceStage(opportunityId: string, toStage: CrmStage, note?: string): Promise<ActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };

  try {
    const { data, error } = await supabase
      .rpc("crm_advance_stage", { p_opp: opportunityId, p_to: toStage, p_note: note ?? null })
      .single();
    if (error) return { ok: false, message: humanizeRpcError(error.message) };
    revalidateOpportunity(opportunityId);
    return { ok: true, message: "Etapa actualizada.", opportunity: toSnapshot(data as OppRowRpc) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── 2) reserveCapacity ────────────────────────────────────────────────────
export interface ReserveInput {
  site: AssignedSite;
  units: string[];
  /** m² a reservar; si se omite, se usa el m² de la oportunidad. */
  m2?: number;
}
export async function reserveCapacity(opportunityId: string, input: ReserveInput): Promise<ActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };

  if (!KNOWN_SITES.includes(input.site)) return { ok: false, message: "Sitio no reconocido." };
  if (!input.units || input.units.length === 0) return { ok: false, message: "Indicá al menos una unidad a reservar." };

  try {
    // Leer service_type + m² para mapear categoría y dimensionar el pedido.
    const { data: opp, error: readErr } = await supabase
      .from("crm_opportunities")
      .select("service_type, m2")
      .eq("id", opportunityId)
      .is("deleted_at", null)
      .single();
    if (readErr || !opp) return { ok: false, message: "Oportunidad inexistente o sin permisos." };

    const category = SERVICE_TO_CATEGORY[opp.service_type as CrmService];
    const requestedM2 = input.m2 ?? (opp.m2 != null ? Number(opp.m2) : null);

    // Presupuesto físico desde el motor (base proyectada = más conservadora).
    // Vive en TS (modelos del Digital Twin), no en Postgres → se calcula acá y se
    // pasa a la RPC para el chequeo atómico final (evita TOCTOU). Ver 0047 §reserve.
    let pAvailable: number | null = null;
    if (category) {
      const snapshot = await getCommittedSnapshot();
      const avail = findAvailability(
        { category, m2: requestedM2 ?? undefined, siteCode: input.site, basis: "proyectada" },
        snapshot,
      );
      pAvailable = avail.options[0]?.availableM2 ?? 0;
    }

    const { data, error } = await supabase
      .rpc("crm_reserve_capacity", {
        p_opp: opportunityId,
        p_site: input.site,
        p_units: input.units,
        p_available_m2: pAvailable,
      })
      .single();
    if (error) return { ok: false, message: humanizeRpcError(error.message) };
    revalidateOpportunity(opportunityId);
    return { ok: true, message: "Capacidad reservada.", opportunity: toSnapshot(data as OppRowRpc) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── 3) completeOnboarding ─────────────────────────────────────────────────
export async function completeOnboarding(opportunityId: string, note?: string): Promise<ActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };

  try {
    const { data, error } = await supabase
      .rpc("crm_complete_onboarding", { p_opp: opportunityId, p_note: note ?? null })
      .single();
    if (error) return { ok: false, message: humanizeRpcError(error.message) };
    revalidateOpportunity(opportunityId);
    return { ok: true, message: "Onboarding completado · capacidad ocupada.", opportunity: toSnapshot(data as OppRowRpc) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── 4) updateOpportunityFields ────────────────────────────────────────────
/** Campos editables por el usuario. NUNCA incluye estado/committed_state/ids/owner. */
export interface EditableOppFields {
  contacto?: string | null;
  email?: string | null;
  telefono?: string | null;
  cuit?: string | null;
  m2?: number | null;
  monto?: number | null;
  probabilidad?: number; // 0..100
  currency?: string;
  expectedClose?: string | null; // ISO date
  deposito?: string | null; // MAGALDI | LUJAN
}

// Lista blanca camelCase → columna. Cualquier campo fuera de acá se ignora.
const FIELD_MAP: Record<keyof EditableOppFields, string> = {
  contacto: "contacto",
  email: "email",
  telefono: "telefono",
  cuit: "cuit",
  m2: "m2",
  monto: "monto",
  probabilidad: "probabilidad",
  currency: "currency",
  expectedClose: "expected_close",
  deposito: "deposito",
};

export async function updateOpportunityFields(opportunityId: string, patch: EditableOppFields): Promise<ActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };

  // Construir el patch saneado solo con claves de la lista blanca.
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(FIELD_MAP) as Array<keyof EditableOppFields>) {
    if (key in patch && patch[key] !== undefined) update[FIELD_MAP[key]] = patch[key];
  }
  if (Object.keys(update).length === 0) return { ok: false, message: "No hay campos válidos para actualizar." };
  if ("probabilidad" in update) {
    const p = Number(update.probabilidad);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { ok: false, message: "Probabilidad fuera de rango (0–100)." };
  }

  try {
    const { data, error } = await supabase
      .from("crm_opportunities")
      .update(update)
      .eq("id", opportunityId)
      .is("deleted_at", null)
      .select("id, estado, committed_state, assigned_site")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "No se pudo actualizar la oportunidad." };
    revalidateOpportunity(opportunityId);
    return { ok: true, message: "Oportunidad actualizada.", opportunity: toSnapshot(data as OppRowRpc) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
