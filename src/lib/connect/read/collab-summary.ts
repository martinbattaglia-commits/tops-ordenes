// Nexus Link · resumen colaborativo para el Cockpit (F4.3). SOLO LECTURA.
// Cuenta lo VISIBLE para el usuario (RLS aplica: filosofía honesta del cockpit).
// count head:true = sin traer filas (patrón supabase-check).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface CollabSummary {
  incidentesAbiertos: number;
  incidentesCriticos: number;
  tareasAbiertas: number;
  tareasVencidas: number;
  tareasVacantes: number;
  workflowsEnCurso: number;
}

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MOCK_SUMMARY: CollabSummary = {
  incidentesAbiertos: 2,
  incidentesCriticos: 1,
  tareasAbiertas: 2,
  tareasVencidas: 0,
  tareasVacantes: 1,
  workflowsEnCurso: 1,
};

export async function getCollabSummary(): Promise<CollabSummary | null> {
  if (isMock()) return MOCK_SUMMARY;
  const supabase = createClient();
  if (!supabase) return MOCK_SUMMARY;
  try {
    const nowIso = new Date().toISOString();
    const [incAb, incCr, tAb, tVenc, tVac, wf] = await Promise.all([
      supabase.from("connect_incidents").select("*", { count: "exact", head: true })
        .not("estado", "in", "(resuelto,cerrado)"),
      supabase.from("connect_incidents").select("*", { count: "exact", head: true })
        .not("estado", "in", "(resuelto,cerrado)").eq("severidad", "critica"),
      supabase.from("connect_tasks").select("*", { count: "exact", head: true })
        .in("estado", ["pendiente", "en_progreso"]),
      supabase.from("connect_tasks").select("*", { count: "exact", head: true })
        .in("estado", ["pendiente", "en_progreso"]).lt("due_at", nowIso),
      supabase.from("connect_tasks").select("*", { count: "exact", head: true })
        .in("estado", ["pendiente", "en_progreso"]).is("asignado_a", null),
      supabase.from("connect_workflow_instances").select("*", { count: "exact", head: true })
        .eq("estado", "en_curso"),
    ]);
    if (incAb.error || tAb.error) return null; // tablas aún no aplicadas → card se oculta
    return {
      incidentesAbiertos: incAb.count ?? 0,
      incidentesCriticos: incCr.count ?? 0,
      tareasAbiertas: tAb.count ?? 0,
      tareasVencidas: tVenc.count ?? 0,
      tareasVacantes: tVac.count ?? 0,
      workflowsEnCurso: wf.count ?? 0,
    };
  } catch {
    return null;
  }
}
