// Nexus Link · capa de LECTURA del Centro de Incidentes (F4.2).
// Patrón canónico (inbox-data.ts): isMock() → seeds; createClient()→null → seeds;
// real → tabla connect_incidents (RLS: connect.view + miembro del hilo, o admin — 0164).
// Lectura por SESIÓN. NUNCA service_role acá. Nombres de reportante/asignado se
// resuelven contra profiles (solo full_name/apellido — sin email, PII lockdown 0040).

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Incident, IncidentRow, IncidentSeverity, IncidentStatus } from "../types";
import { severityRank } from "../domain/incident";
import { MOCK_INCIDENTS } from "../incidents-mock";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const INCIDENT_COLS =
  "id, public_id, conversation_id, titulo, sector, ubicacion, tipo_averia, severidad, estado, reportado_por, asignado_a, sla_due_at, resuelto_at, resolucion_text, created_at, updated_at";

export interface IncidentFilters {
  estado?: IncidentStatus | "activos" | "todos";
  severidad?: IncidentSeverity;
  sector?: string;
  asignado?: string;
}

function mapIncident(r: IncidentRow): Incident {
  return {
    id: r.id, publicId: r.public_id, conversationId: r.conversation_id,
    titulo: r.titulo, sector: r.sector, ubicacion: r.ubicacion, tipoAveria: r.tipo_averia,
    severidad: r.severidad, estado: r.estado,
    reportadoPor: r.reportado_por, asignadoA: r.asignado_a,
    slaDueAt: r.sla_due_at, resueltoAt: r.resuelto_at, resolucionText: r.resolucion_text,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Resuelve nombres (full_name + apellido) de los perfiles involucrados, sin email. */
async function withNames(items: Incident[]): Promise<Incident[]> {
  const ids = Array.from(
    new Set(items.flatMap((i) => [i.reportadoPor, i.asignadoA]).filter((x): x is string => x != null)),
  );
  if (ids.length === 0) return items;
  const supabase = createClient();
  if (!supabase) return items;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, apellido")
    .in("id", ids);
  if (error || !data) return items;
  const names = new Map<string, string>();
  for (const p of data as Array<{ id: string; full_name: string | null; apellido: string | null }>) {
    const n = [p.full_name, p.apellido].filter(Boolean).join(" ").trim();
    if (n) names.set(p.id, n);
  }
  return items.map((i) => ({
    ...i,
    reportadoPorName: i.reportadoPor ? (names.get(i.reportadoPor) ?? null) : null,
    asignadoAName: i.asignadoA ? (names.get(i.asignadoA) ?? null) : null,
  }));
}

function applyMockFilters(items: Incident[], f: IncidentFilters): Incident[] {
  return items.filter((i) => {
    if (f.estado === "activos" || f.estado == null) {
      if (i.estado === "cerrado") return false;
    } else if (f.estado !== "todos" && i.estado !== f.estado) return false;
    if (f.severidad && i.severidad !== f.severidad) return false;
    if (f.sector && (i.sector ?? "").toLowerCase() !== f.sector.toLowerCase()) return false;
    if (f.asignado && i.asignadoA !== f.asignado) return false;
    return true;
  });
}

function sortIncidents(items: Incident[]): Incident[] {
  return [...items].sort((a, b) => {
    const sr = severityRank(a.severidad) - severityRank(b.severidad);
    if (sr !== 0) return sr;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt); // más antiguo primero
  });
}

/** Lista de gestión (default: activos = no cerrados), crítica primero, antigüedad después. */
export async function listIncidents(filters: IncidentFilters = {}): Promise<Incident[]> {
  if (isMock()) return sortIncidents(applyMockFilters(MOCK_INCIDENTS, filters));
  const supabase = createClient();
  if (!supabase) return sortIncidents(applyMockFilters(MOCK_INCIDENTS, filters));

  let query = supabase.from("connect_incidents").select(INCIDENT_COLS);
  if (filters.estado === "todos") {
    // sin filtro de estado
  } else if (filters.estado && filters.estado !== "activos") {
    query = query.eq("estado", filters.estado);
  } else {
    query = query.neq("estado", "cerrado");
  }
  if (filters.severidad) query = query.eq("severidad", filters.severidad);
  if (filters.sector) query = query.ilike("sector", filters.sector);
  if (filters.asignado) query = query.eq("asignado_a", filters.asignado);
  query = query.order("created_at", { ascending: false }).limit(200);

  const { data, error } = await query;
  if (error) {
    console.error("[connect/listIncidents] query error:", error.message);
    return [];
  }
  const items = (data ?? []).map((r) => mapIncident(r as unknown as IncidentRow));
  return sortIncidents(await withNames(items));
}

/** Un incidente por id (detalle). */
export async function getIncident(id: string): Promise<Incident | null> {
  if (isMock()) return MOCK_INCIDENTS.find((i) => i.id === id) ?? null;
  const supabase = createClient();
  if (!supabase) return MOCK_INCIDENTS.find((i) => i.id === id) ?? null;
  const { data, error } = await supabase
    .from("connect_incidents")
    .select(INCIDENT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [item] = await withNames([mapIncident(data as unknown as IncidentRow)]);
  return item ?? null;
}
