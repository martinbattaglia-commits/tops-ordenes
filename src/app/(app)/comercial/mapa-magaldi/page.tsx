import { MagaldiMapView } from "./MagaldiMapView";
import { getUnitStateMap } from "@/lib/comercial/units-data";

export const metadata = { title: "Digital Twin Corporativo · Magaldi 1765" };
export const dynamic = "force-dynamic";

/**
 * Digital Twin Premium Corporativo de la Sede Central Agustín Magaldi 1765.
 * E4: el ESTADO de cada unidad sale de crm_units (fuente única); geometría/m²/nombres
 * del modelo estático magaldi1765-map.ts. Fallback estático si crm_units no responde.
 */
export default async function MapaMagaldiPage() {
  const unitStates = await getUnitStateMap("MAGALDI_1765");
  return <MagaldiMapView unitStates={unitStates} />;
}
