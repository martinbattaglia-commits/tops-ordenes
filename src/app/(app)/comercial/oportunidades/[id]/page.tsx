import { notFound } from "next/navigation";
import { getOpportunityFull } from "@/lib/comercial/opportunities-data";
import { Opportunity360View } from "./Opportunity360View";

export const metadata = { title: "Ficha 360° · Oportunidad" };
export const dynamic = "force-dynamic";

/**
 * Ficha 360° de Oportunidad — pantalla central del CRM.
 * Integra Opportunity + Capacity + Quote + Proposal + Contract + Onboarding.
 * F2.1-7: fuente Supabase real (crm_*) con fallback a muestra local. Sin Clientify, sin webhook.
 */
export default async function OpportunityFichaPage({ params }: { params: { id: string } }) {
  const { full, source } = await getOpportunityFull(params.id);
  if (!full) notFound();
  return <Opportunity360View full={full} source={source} />;
}
