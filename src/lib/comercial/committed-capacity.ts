/**
 * committed-capacity.ts — F2.1-4 · construye el CommittedSnapshot del CRM.
 *
 * Lee `crm_opportunities` (Supabase) y arma el snapshot que el motor puro
 * `corporate-capacity.ts` consume para calcular vacancia comercial y proyectada.
 *
 * Reglas (ver docs/comercial/COMMERCIAL_F2_1_ARCHITECTURE.md §3):
 *  - reservado     ← committed_state='reservado' (propuesta/negociación)
 *  - comprometido  ← committed_state='comprometido' (ganado no onboardeado)
 *  - ocupado       ← committed_state='ocupado' → NO se cuenta (su m² ya está en la
 *                    ocupación física del Digital Twin: regla anti-doble-conteo)
 *  - solo oportunidades con `assigned_site` y `m2`, no borradas, estado ≠ 'perdido'.
 *
 * Resiliente: si Supabase no está configurado o la tabla no existe (p. ej. entornos
 * donde 0041–0046 aún no se aplicaron), devuelve `{}` → el motor cae a vacancia física.
 */

import { createClient } from "@/lib/supabase/server";
import type { CommittedSnapshot, CapacityCategory } from "@/lib/wms/corporate-capacity";

const SERVICE_TO_CATEGORY: Record<string, CapacityCategory> = {
  anmat: "anmat",
  general: "general",
  oficinas: "oficina",
};

interface OppRow {
  service_type: string | null;
  m2: number | string | null;
  committed_state: string | null;
  assigned_site: string | null;
}

/** Construye el snapshot de compromisos del CRM desde crm_opportunities. */
export async function getCommittedSnapshot(): Promise<CommittedSnapshot> {
  const snapshot: CommittedSnapshot = {};
  const supabase = createClient();
  if (!supabase) return snapshot;

  try {
    const { data, error } = await supabase
      .from("crm_opportunities")
      .select("service_type, m2, committed_state, assigned_site")
      .is("deleted_at", null)
      .in("committed_state", ["reservado", "comprometido"])
      .not("assigned_site", "is", null)
      .not("m2", "is", null)
      .neq("estado", "perdido");

    if (error || !data) return snapshot;

    for (const r of data as OppRow[]) {
      const category = r.service_type ? SERVICE_TO_CATEGORY[r.service_type] : undefined;
      const site = r.assigned_site;
      const m2 = Number(r.m2 ?? 0);
      if (!category || !site || !(m2 > 0)) continue;

      const bySite = (snapshot[site] ??= {});
      const bucket = (bySite[category] ??= { reservedM2: 0, committedM2: 0 });
      if (r.committed_state === "reservado") bucket.reservedM2 += m2;
      else if (r.committed_state === "comprometido") bucket.committedM2 += m2;
    }
  } catch {
    // tabla inexistente / error de red → snapshot vacío (vacancia física)
    return {};
  }

  // redondeo defensivo
  for (const site of Object.keys(snapshot)) {
    for (const k of Object.keys(snapshot[site]) as CapacityCategory[]) {
      const b = snapshot[site][k]!;
      b.reservedM2 = Math.round(b.reservedM2 * 10) / 10;
      b.committedM2 = Math.round(b.committedM2 * 10) / 10;
    }
  }
  return snapshot;
}
