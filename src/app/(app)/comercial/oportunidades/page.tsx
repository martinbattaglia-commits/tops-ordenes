import { listOpportunities } from "@/lib/comercial/opportunities-data";
import { OpportunitiesView } from "./OpportunitiesView";

export const metadata = { title: "Oportunidades 360° · Comercial" };
export const dynamic = "force-dynamic";

/**
 * Oportunidades 360° — centro de gestión comercial.
 * Fuente: crm_opportunities (Clientify → CRM360). UX comercial: Tabla / Kanban.
 */
export default async function OportunidadesPage() {
  const { items: opps, source } = await listOpportunities();
  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <OpportunitiesView opps={opps} source={source} />
    </div>
  );
}
