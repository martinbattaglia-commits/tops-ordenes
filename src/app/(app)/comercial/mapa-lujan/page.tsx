import { LujanMapView } from "./LujanMapView";
import { getUnitStateMap } from "@/lib/comercial/units-data";

export const metadata = { title: "Mapa Comercial · Pedro Luján 3159" };
export const dynamic = "force-dynamic";

/**
 * Mapa Digital Premium de la sede anexa Pedro Luján 3159.
 * E4: el ESTADO de cada unidad sale de crm_units (fuente única); geometría/cubículos/
 * layout del modelo estático lujan3159-map.ts. Fallback estático si crm_units no responde.
 */
export default async function MapaLujanPage() {
  const unitStates = await getUnitStateMap("PEDRO_LUJAN_3159");
  return <LujanMapView unitStates={unitStates} />;
}
