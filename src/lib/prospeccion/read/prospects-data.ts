// Read model (capa liviana, HEX-4/HEX-5) · bandeja read-only de F0. Lectura sin reglas de negocio,
// bajo sesión de usuario (RLS por has_permission('prospeccion.view')). Degrada a muestra si Supabase
// no está, o si la tabla aún no existe (migraciones 0088/0089 entregadas, NO aplicadas) — AP-10.
import { createClient } from "@/lib/supabase/server";
import type { ProspectStatusValue } from "../domain/vo/prospect-status";

export type ProspectsSource = "supabase" | "local";

export interface ProspectListItem {
  id: string;
  shortId: string | null;
  status: ProspectStatusValue;
  companyName: string | null;
  fullName: string | null;
  cargo: string | null;
  email: string | null;
  cuit: string | null;
  website: string | null;
  linkedinUrl: string | null;
  createdAt: string;
}

// Muestra para entorno demo / pre-migración (la bandeja siempre renderiza algo).
const SAMPLE: ProspectListItem[] = [
  { id: "demo-1", shortId: "PROS-2026-0001", status: "imported", companyName: "ACME Logística", fullName: "Laura Gómez", cargo: "Gerenta de Operaciones", email: "laura@acme.test", cuit: "30701112234", website: "acme.test", linkedinUrl: null, createdAt: "2026-06-25T10:00:00.000Z" },
  { id: "demo-2", shortId: "PROS-2026-0002", status: "raw", companyName: "FarmaSur", fullName: "Juan Pérez", cargo: "Compras", email: "juan@farmasur.test", cuit: null, website: "farmasur.test", linkedinUrl: null, createdAt: "2026-06-25T09:30:00.000Z" },
  { id: "demo-3", shortId: "PROS-2026-0003", status: "duplicado", companyName: "ACME Logística", fullName: "Laura G.", cargo: null, email: "laura@acme.test", cuit: null, website: null, linkedinUrl: null, createdAt: "2026-06-25T09:00:00.000Z" },
];

interface Row {
  id: string;
  short_id: string | null;
  status: ProspectStatusValue;
  company_name: string | null;
  full_name: string | null;
  cargo: string | null;
  email: string | null;
  cuit: string | null;
  website: string | null;
  linkedin_url: string | null;
  created_at: string;
}

const mapRow = (r: Row): ProspectListItem => ({
  id: r.id,
  shortId: r.short_id,
  status: r.status,
  companyName: r.company_name,
  fullName: r.full_name,
  cargo: r.cargo,
  email: r.email,
  cuit: r.cuit,
  website: r.website,
  linkedinUrl: r.linkedin_url,
  createdAt: r.created_at,
});

/** Lista los últimos prospectos (read-only). F0: orden por fecha desc + tope; paginación keyset = F0b/F1. */
export async function listProspects(): Promise<{ items: ProspectListItem[]; source: ProspectsSource }> {
  const supabase = createClient();
  if (!supabase) return { items: SAMPLE, source: "local" };
  const { data, error } = await supabase
    .from("prospeccion_prospects")
    .select("id, short_id, status, company_name, full_name, cargo, email, cuit, website, linkedin_url, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !data) return { items: SAMPLE, source: "local" };
  return { items: (data as Row[]).map(mapRow), source: "supabase" };
}
