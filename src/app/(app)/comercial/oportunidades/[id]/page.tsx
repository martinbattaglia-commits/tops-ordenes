import { notFound } from "next/navigation";
import { getOpportunityFull } from "@/lib/comercial/opportunities-data";
import { Opportunity360View } from "./Opportunity360View";

export const metadata = { title: "Ficha 360° · Oportunidad" };

/**
 * Ficha 360° de Oportunidad (F2.1-6) — pantalla central del CRM.
 * Integra Opportunity + Capacity + Quote + Proposal + Contract + Onboarding.
 * Fuente LOCAL de muestra (F2.1-7 → Supabase). Sin Clientify, sin webhook.
 */
export default function OpportunityFichaPage({ params }: { params: { id: string } }) {
  const full = getOpportunityFull(params.id);
  if (!full) notFound();
  return <Opportunity360View full={full} />;
}
