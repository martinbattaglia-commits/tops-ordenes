import { LujanMapView } from "./LujanMapView";

export const metadata = { title: "Mapa Comercial · Pedro Luján 3159" };

/**
 * Mapa Digital Premium de la sede anexa Pedro Luján 3159.
 * Fuente: data model LOCAL `src/lib/wms/lujan3159-map.ts` (no Supabase).
 * No reemplaza el mapa operativo (`/operaciones/mapa-inteligente`); es una
 * vista comercial nueva y no destructiva.
 */
export default function MapaLujanPage() {
  return <LujanMapView />;
}
