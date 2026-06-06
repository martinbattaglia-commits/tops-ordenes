/**
 * leads-data.ts — F2.2-3 · fuente de la bandeja de leads.
 *
 * Supabase real (crm_leads) con fallback a muestra local — mismo patrón que
 * opportunities-data.ts. La app puede apuntar a una base sin crm_* (RA-1); en
 * ese caso la bandeja muestra muestra local y los controles de escritura se
 * deshabilitan en la UI (source='local').
 */

import type { CrmLead } from "./crm-types";
import { createClient } from "@/lib/supabase/server";
import { listLeadsDb, listCommercialUsersDb, type CommercialUser } from "./leads-supabase";

export type DataSource = "supabase" | "local";

// ── Muestra local (demo · 4 leads en distintos estados) ──────────────────────
const SAMPLE: CrmLead[] = [
  {
    id: "lead-0001", publicId: "LEAD-2026-0001", clientifyId: "cl-9001", source: "google_ads",
    fullName: "Laura Gómez", email: "laura@farmasur.test", phone: "+54 11 4000-9001", cuit: "30-70011223-4",
    companyName: "FarmaSur SA", status: "nuevo", ownerId: null, ownerName: "Vendedor TOPS",
    tags: ["anmat"], posibleDuplicado: false, opportunityId: null, createdAt: "2026-06-05",
  },
  {
    id: "lead-0002", publicId: "LEAD-2026-0002", clientifyId: "cl-9002", source: "web",
    fullName: "Diego Fernández", email: "diego@logix.test", phone: "+54 11 4000-9002", cuit: null,
    companyName: "Logix SRL", status: "contactado", ownerId: null, ownerName: "Vendedor TOPS",
    tags: ["general"], posibleDuplicado: false, opportunityId: null, createdAt: "2026-06-04",
  },
  {
    id: "lead-0003", publicId: "LEAD-2026-0003", clientifyId: "cl-9003", source: "referido",
    fullName: "Sofía Ruiz", email: "diego@logix.test", phone: "+54 11 4000-9003", cuit: null,
    companyName: "Otra Empresa", status: "nuevo", ownerId: null, ownerName: "Vendedor TOPS",
    tags: ["posible_duplicado"], posibleDuplicado: true, opportunityId: null, createdAt: "2026-06-04",
  },
  {
    id: "lead-0004", publicId: "LEAD-2026-0004", clientifyId: "cl-9004", source: "google_ads",
    fullName: "Martín Díaz", email: "martin@oficinaspremium.test", phone: "+54 11 4000-9004", cuit: "30-71122334-5",
    companyName: "Oficinas Premium", status: "calificado", ownerId: null, ownerName: "Vendedor TOPS",
    tags: ["oficinas"], posibleDuplicado: false, opportunityId: null, createdAt: "2026-06-03",
  },
];

export async function listLeads(): Promise<{ items: CrmLead[]; commercialUsers: CommercialUser[]; source: DataSource }> {
  const supabase = createClient();
  if (supabase) {
    const db = await listLeadsDb(supabase);
    if (db) {
      const commercialUsers = await listCommercialUsersDb(supabase);
      return { items: db, commercialUsers, source: "supabase" };
    }
  }
  return { items: SAMPLE, commercialUsers: [], source: "local" };
}
