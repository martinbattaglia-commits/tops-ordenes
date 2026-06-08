/**
 * units-data.ts — E3.1 · accesores read-only de crm_units (fuente única de verdad).
 *
 * Cliente de sesión (RLS aplica). Resiliente: si la tabla no existe (entornos sin 0066)
 * o hay error, devuelve vacío → la UI degrada sin romper. NO escribe (la reserva vive
 * en crm_reserve_units / stage-actions, E2).
 */
import { createClient } from "@/lib/supabase/server";
import type { CrmUnit, CrmUnitState, CrmService, UnitCounts } from "./crm-types";

const SELECT = "id,site,unit_code,name,tipo,category,floor,m2,state,opportunity_id,ocupado_por";

interface RawUnit {
  id: string; site: string; unit_code: string; name: string | null; tipo: string | null;
  category: string | null; floor: string | null; m2: number | string | null;
  state: string; opportunity_id: string | null; ocupado_por: string | null;
}
function mapUnit(r: RawUnit): CrmUnit {
  return {
    id: r.id, site: r.site, unitCode: r.unit_code, name: r.name, tipo: r.tipo,
    category: (r.category as CrmService | null) ?? null, floor: r.floor,
    m2: r.m2 == null ? null : Number(r.m2),
    state: r.state as CrmUnitState, opportunityId: r.opportunity_id, ocupadoPor: r.ocupado_por,
  };
}
const sortUnits = (a: CrmUnit, b: CrmUnit) => a.unitCode.localeCompare(b.unitCode, "es", { numeric: true });

/** Todas las unidades de un sitio. */
export async function getUnitsBySite(site: string): Promise<CrmUnit[]> {
  const supabase = createClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("crm_units").select(SELECT).eq("site", site);
    if (error || !data) return [];
    return (data as RawUnit[]).map(mapUnit).sort(sortUnits);
  } catch { return []; }
}

/** Conteo por estado en un sitio. */
export async function getUnitCounts(site: string): Promise<UnitCounts> {
  const units = await getUnitsBySite(site);
  const c: UnitCounts = { disponible: 0, reservada: 0, ocupada: 0, bloqueada: 0, no_comercializable: 0 };
  for (const u of units) c[u.state] += 1;
  return c;
}

/** Unidades disponibles para reservar (state='disponible'), opcional filtro por categoría. */
export async function getAvailableUnits(site: string, category?: CrmService | null): Promise<CrmUnit[]> {
  const units = (await getUnitsBySite(site)).filter((u) => u.state === "disponible");
  return category ? units.filter((u) => u.category === category) : units;
}

/** Mapa unit_code → state para un sitio (E4 · alimenta los mapas Digital Twin). */
export async function getUnitStateMap(site: string): Promise<Record<string, CrmUnitState>> {
  const units = await getUnitsBySite(site);
  const m: Record<string, CrmUnitState> = {};
  for (const u of units) m[u.unitCode] = u.state;
  return m;
}

/** Unidades vinculadas a una oportunidad (verdad real, no el texto de assigned_units). */
export async function getOpportunityUnits(opportunityId: string): Promise<CrmUnit[]> {
  const supabase = createClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("crm_units").select(SELECT).eq("opportunity_id", opportunityId);
    if (error || !data) return [];
    return (data as RawUnit[]).map(mapUnit).sort(sortUnits);
  } catch { return []; }
}
