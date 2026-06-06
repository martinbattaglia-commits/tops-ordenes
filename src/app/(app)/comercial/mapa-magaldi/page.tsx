import { MagaldiMapView } from "./MagaldiMapView";

export const metadata = { title: "Digital Twin Corporativo · Magaldi 1765" };

/**
 * Digital Twin Premium Corporativo de la Sede Central Agustín Magaldi 1765.
 * Fuente: data model LOCAL `src/lib/wms/magaldi1765-map.ts` (no Supabase).
 * Vista nueva, no destructiva; no reemplaza el mapa operativo.
 */
export default function MapaMagaldiPage() {
  return <MagaldiMapView />;
}
