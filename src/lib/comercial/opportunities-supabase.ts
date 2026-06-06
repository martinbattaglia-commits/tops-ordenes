/**
 * opportunities-supabase.ts — F2.1-7 · accesores reales contra crm_* (Supabase).
 *
 * Usa nested select de PostgREST para traer la oportunidad + sus cotizaciones,
 * propuestas, contrato, onboarding e historial en una sola consulta, y los mapea
 * con `opportunities-mapper.ts` a la MISMA forma que consume la Ficha 360°.
 *
 * Resiliente: si la tabla no existe (entornos sin 0041–0046) o hay error,
 * devuelve null → el data layer cae a la muestra local. NO rompe la app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity, OpportunityFull } from "./crm-types";
import {
  mapOpportunity, mapOpportunityFull,
  type RawOpportunity, type RawOpportunityFull,
} from "./opportunities-mapper";

const LIST_SELECT = `
  id, public_id, cuit, contacto, email, telefono, service_type, m2, deposito, estado,
  probabilidad, monto, currency, owner_id, expected_close, clientify_deal_id,
  capacity_feasible, assigned_site, assigned_units, committed_state, created_at,
  clients(razon)
`;

const FULL_SELECT = `
  ${LIST_SELECT},
  crm_quotes(id, public_id, service_type, tarifario_ref, subtotal, descuento_total, iva, total, currency, status, created_at,
             crm_quote_items(concepto, categoria, cantidad, unidad, precio_unit, importe, orden)),
  crm_proposals(id, public_id, tipo, version, status, sent_at, viewed_at, quote_id, created_at),
  crm_contracts(id, public_id, version, status, signed_at, signed_by, valid_from, valid_until, proposal_id, created_at),
  crm_onboarding(id, public_id, status, progress_pct, started_at, completed_at,
                 crm_onboarding_tasks(tipo, titulo, status, assignee_id, due_date, document_id, orden)),
  crm_stage_history(from_stage, to_stage, changed_by, changed_at, note)
`;

/** Lista de oportunidades desde Supabase. null si la tabla no existe / error. */
export async function listOpportunitiesDb(supabase: SupabaseClient): Promise<Opportunity[] | null> {
  try {
    const { data, error } = await supabase
      .from("crm_opportunities")
      .select(LIST_SELECT)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error || !data) return null;
    return (data as unknown as RawOpportunity[]).map(mapOpportunity);
  } catch {
    return null;
  }
}

/** Ficha 360° completa desde Supabase. null si no existe / error. */
export async function getOpportunityFullDb(supabase: SupabaseClient, id: string): Promise<OpportunityFull | null> {
  try {
    const { data, error } = await supabase
      .from("crm_opportunities")
      .select(FULL_SELECT)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return null;
    return mapOpportunityFull(data as unknown as RawOpportunityFull);
  } catch {
    return null;
  }
}
