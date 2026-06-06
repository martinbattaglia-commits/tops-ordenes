import { listLeads } from "@/lib/comercial/leads-data";
import { LeadsInboxView } from "./LeadsInboxView";

export const metadata = { title: "Bandeja de Leads · Comercial" };
export const dynamic = "force-dynamic";

/**
 * Bandeja de Leads (F2.2-3) — primer lugar donde Comercial ve leads reales
 * entrando desde Clientify (vía el webhook → crm_ingest_lead). Listado, filtros,
 * ownership, posible duplicado, reasignación, calificación e indicadores.
 * Fuente Supabase (crm_leads) con fallback a muestra local. Sin promoción ni outbound.
 */
export default async function LeadsPage() {
  const { items, commercialUsers, source } = await listLeads();
  return <LeadsInboxView leads={items} commercialUsers={commercialUsers} source={source} />;
}
