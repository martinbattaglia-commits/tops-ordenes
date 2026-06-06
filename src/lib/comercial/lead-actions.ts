"use server";

/**
 * lead-actions.ts — F2.2-3 · acciones de la bandeja de leads.
 *
 *   reassignLead   → cambia owner_id
 *   setLeadStatus  → calificación: nuevo → contactado → calificado, o → descartado
 *
 * Bajo sesión de usuario (RLS crm_leads UPDATE = comercial.edit). UPDATE directo
 * (una sola tabla → sin RPC). NO promueve a oportunidad (F2.2-4) ni hace outbound.
 * Resiliente si Supabase no está / la tabla no existe.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus, CrmService } from "./crm-types";

export type LeadActionResult = { ok: true; message: string } | { ok: false; message: string };
export type PromoteResult =
  | { ok: true; message: string; opportunityId: string; opportunityPublicId: string | null }
  | { ok: false; message: string };

// Estados que la bandeja puede setear (NO 'promovido' — eso es la promoción, F2.2-4).
const SETTABLE: LeadStatus[] = ["nuevo", "contactado", "calificado", "descartado"];

function revalidateLeads(): void {
  revalidatePath("/comercial/leads");
}

export async function reassignLead(leadId: string, ownerId: string | null): Promise<LeadActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };
  try {
    const { error } = await supabase
      .from("crm_leads")
      .update({ owner_id: ownerId })
      .eq("id", leadId)
      .is("deleted_at", null);
    if (error) return { ok: false, message: error.message };
    revalidateLeads();
    return { ok: true, message: ownerId ? "Lead reasignado." : "Lead sin asignar." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function setLeadStatus(leadId: string, status: LeadStatus): Promise<LeadActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };
  if (!SETTABLE.includes(status)) {
    return { ok: false, message: "Estado no permitido desde la bandeja (la promoción es otro paso)." };
  }
  try {
    const { error } = await supabase
      .from("crm_leads")
      .update({ status })
      .eq("id", leadId)
      .is("deleted_at", null)
      .neq("status", "promovido"); // no re-tocar leads ya promovidos
    if (error) return { ok: false, message: error.message };
    revalidateLeads();
    return { ok: true, message: "Estado del lead actualizado." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── Promoción Lead → Opportunity (F2.2-4) ───────────────────────────────────
export interface PromoteFields {
  serviceType: CrmService;
  m2?: number;
  cuit?: string;
  deposito?: "MAGALDI" | "LUJAN";
}

function humanizePromoteError(message: string): string {
  const m = message || "";
  if (m.includes("MISSING_BUSINESS_DATA")) return "Falta CUIT o un cliente enlazable para calificar.";
  if (m.includes("INVALID_SERVICE")) return "Elegí un servicio válido (ANMAT, Cargas Generales u Oficinas).";
  if (m.includes("LEAD_DISCARDED")) return "El lead está descartado; reactivalo antes de promover.";
  if (m.includes("LEAD_NOT_FOUND")) return "Lead inexistente o sin permisos.";
  return m;
}

/** Promueve un lead a oportunidad (calificado) vía RPC crm_promote_lead. */
export async function promoteLead(leadId: string, fields: PromoteFields): Promise<PromoteResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };
  try {
    const { data, error } = await supabase.rpc("crm_promote_lead", {
      p_lead: leadId,
      p_fields: {
        service_type: fields.serviceType,
        m2: fields.m2 ?? null,
        cuit: fields.cuit ?? null,
        deposito: fields.deposito ?? null,
      },
    });
    if (error) return { ok: false, message: humanizePromoteError(error.message) };
    const r = (data ?? {}) as { action?: string; opportunity_id?: string; opportunity_public_id?: string | null };
    if (!r.opportunity_id) return { ok: false, message: "No se pudo crear la oportunidad." };
    revalidateLeads();
    revalidatePath("/comercial/oportunidades");
    const msg = r.action === "already_promoted" ? "El lead ya estaba promovido." : "Lead promovido a oportunidad.";
    return { ok: true, message: msg, opportunityId: r.opportunity_id, opportunityPublicId: r.opportunity_public_id ?? null };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
