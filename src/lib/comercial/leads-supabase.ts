/**
 * leads-supabase.ts — F2.2-3 · accesores de la bandeja de leads (Supabase).
 *
 * Lee crm_leads bajo RLS (comercial.view), resuelve nombres de owner vía
 * profiles_public (sin email) y lista comerciales activos (RPC 0049) para el
 * dropdown de reasignación. Resiliente: si la tabla no existe → null (fallback).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmLead, LeadStatus } from "./crm-types";

export interface CommercialUser {
  id: string;
  fullName: string | null;
}

interface RawLead {
  id: string;
  public_id: string | null;
  clientify_id: string | null;
  source: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cuit: string | null;
  company_name: string | null;
  status: string;
  owner_id: string | null;
  tags: string[] | null;
  opportunity_id: string | null;
  created_at: string;
}

export function mapLead(r: RawLead, ownerName: string | null): CrmLead {
  const tags = r.tags ?? [];
  return {
    id: r.id,
    publicId: r.public_id,
    clientifyId: r.clientify_id,
    source: r.source,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    cuit: r.cuit,
    companyName: r.company_name,
    status: r.status as LeadStatus,
    ownerId: r.owner_id,
    ownerName,
    tags,
    posibleDuplicado: tags.includes("posible_duplicado"),
    opportunityId: r.opportunity_id,
    createdAt: r.created_at,
  };
}

/** Lista de leads desde Supabase. null si la tabla no existe / error. */
export async function listLeadsDb(supabase: SupabaseClient): Promise<CrmLead[] | null> {
  try {
    const { data, error } = await supabase
      .from("crm_leads")
      .select("id, public_id, clientify_id, source, full_name, email, phone, cuit, company_name, status, owner_id, tags, opportunity_id, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error || !data) return null;

    const rows = data as unknown as RawLead[];

    // Resolver nombres de owner (PII-safe) en una sola consulta.
    const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((x): x is string => !!x))];
    const names = new Map<string, string | null>();
    if (ownerIds.length > 0) {
      const { data: profs } = await supabase.from("profiles_public").select("id, full_name").in("id", ownerIds);
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name);
    }

    return rows.map((r) => mapLead(r, r.owner_id ? names.get(r.owner_id) ?? null : null));
  } catch {
    return null;
  }
}

/** Comerciales activos (id + nombre) para el dropdown de reasignación. */
export async function listCommercialUsersDb(supabase: SupabaseClient): Promise<CommercialUser[]> {
  try {
    const { data, error } = await supabase.rpc("crm_list_commercial_users");
    if (error || !data) return [];
    return (data as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, fullName: u.full_name }));
  } catch {
    return [];
  }
}
