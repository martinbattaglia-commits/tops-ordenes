import { notFound } from "next/navigation";
import { getOpportunityFull } from "@/lib/comercial/opportunities-data";
import { getUnitCounts, getAvailableUnits, getOpportunityUnits } from "@/lib/comercial/units-data";
import { Opportunity360View } from "./Opportunity360View";

export const metadata = { title: "Ficha 360° · Oportunidad" };
export const dynamic = "force-dynamic";

/**
 * Ficha 360° de Oportunidad — pantalla central del CRM.
 * E3: la disponibilidad sale de crm_units (fuente única), no de m² agregados.
 */
export default async function OpportunityFichaPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { resSite?: string; resUnit?: string; resCat?: string; resM2?: string };
}) {
  const { full, source } = await getOpportunityFull(params.id);
  if (!full) notFound();

  // P2 — precarga desde el mapa (deep link). Solo si trae site + unidad.
  const prefill =
    searchParams.resSite && searchParams.resUnit
      ? {
          site: searchParams.resSite,
          unit: searchParams.resUnit,
          category: searchParams.resCat ?? null,
          m2: searchParams.resM2 ? Number(searchParams.resM2) : null,
        }
      : null;

  const [magCounts, magAvail, lujCounts, lujAvail, oppUnits] = await Promise.all([
    getUnitCounts("MAGALDI_1765"),
    getAvailableUnits("MAGALDI_1765"),
    getUnitCounts("PEDRO_LUJAN_3159"),
    getAvailableUnits("PEDRO_LUJAN_3159"),
    getOpportunityUnits(params.id),
  ]);
  const unitData = {
    bySite: {
      MAGALDI_1765: { counts: magCounts, available: magAvail },
      PEDRO_LUJAN_3159: { counts: lujCounts, available: lujAvail },
    },
    oppUnits,
  };

  return <Opportunity360View full={full} source={source} unitData={unitData} prefill={prefill} />;
}
