import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listFleet } from "@/lib/tracking/data";
import { env } from "@/lib/env";
import { FleetTrackingView } from "./_components/FleetTrackingView";

export const metadata = { title: "Tracking de flota" };
export const dynamic = "force-dynamic";

/**
 * OPERACIONES → Tracking de Flota.
 *
 * Server shell: trae el snapshot inicial de la flota (sin hardcode), mantiene
 * la degradación con <ModuleUnavailable> si las migraciones 0016–0019 no están
 * aplicadas, y delega la capa visual viva (mapa Mapbox + realtime + panel) al
 * client island FleetTrackingView. El mapa se enciende solo cuando
 * NEXT_PUBLIC_MAPBOX_TOKEN está presente; si falta, cae a AmbaMap sin romper.
 */
export default async function TrackingDeFlotaPage() {
  const result = await listFleet();

  if (!result.ok) {
    return (
      <ModuleUnavailable
        title="Tracking de flota"
        migration="0016_tracking_foundation → 0019_tracking_rbac_seed"
        detail={result.error}
      />
    );
  }

  return (
    <FleetTrackingView
      initialVehicles={result.vehicles}
      mapToken={env.tracking.mapboxToken}
      serverNowMs={Date.now()}
    />
  );
}
