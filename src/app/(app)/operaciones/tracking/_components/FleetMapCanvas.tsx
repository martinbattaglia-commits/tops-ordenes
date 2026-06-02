"use client";

import dynamic from "next/dynamic";
import { Icon } from "@/components/Icon";
import { AmbaMap } from "@/components/ejecutivo/AmbaMap";
import type { FleetMapComponent, MapEngineId, MapVehicle } from "@/lib/tracking/map/types";

/**
 * Canvas del mapa: la ÚNICA frontera entre la UI y el motor de mapa concreto.
 *
 * - Resuelve el motor activo (hoy 'mapbox', default) y lo carga lazy + SSR-safe.
 * - Si no hay token o el motor no está disponible → fallback AmbaMap, sin romper.
 *
 * FleetTrackingView depende de este componente, NO de mapbox-gl. Sumar MapLibre
 * o Google = agregar una entrada en ENGINES; la vista no cambia.
 */

const MapboxFleetMap = dynamic<React.ComponentProps<FleetMapComponent>>(
  () => import("./maps/MapboxFleetMap").then((m) => m.MapboxFleetMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center rounded-xl bg-bg-surface-alt animate-pulse">
        <span className="text-xs text-fg-muted">Cargando mapa…</span>
      </div>
    ),
  }
);

/** Registro de motores. null = no implementado todavía (cae al fallback). */
const ENGINES: Record<MapEngineId, FleetMapComponent | null> = {
  mapbox: MapboxFleetMap as FleetMapComponent,
  maplibre: null,
  google: null,
};

export const DEFAULT_MAP_ENGINE: MapEngineId = "mapbox";

interface FleetMapCanvasProps {
  token: string;
  engine?: MapEngineId;
  vehicles: MapVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FleetMapCanvas({
  token,
  engine = DEFAULT_MAP_ENGINE,
  vehicles,
  selectedId,
  onSelect,
}: FleetMapCanvasProps) {
  const Engine = ENGINES[engine];

  if (token && Engine) {
    return <Engine token={token} vehicles={vehicles} selectedId={selectedId} onSelect={onSelect} />;
  }

  // Fallback no bloqueante (sin token o motor no disponible).
  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,rgba(201,8,18,0.05),transparent_70%)] p-6">
      <div className="w-full max-w-md">
        <AmbaMap />
        <div className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
          <Icon name="pin" size={16} className="mt-0.5 flex-shrink-0 text-fg-muted" />
          <span>
            {token ? (
              <>Motor de mapa “{engine}” no disponible todavía. Vista esquemática de sedes.</>
            ) : (
              <>
                Mapa en vivo deshabilitado: configurá{" "}
                <code className="font-mono text-[11px] bg-bg-surface-alt px-1.5 py-0.5 rounded">
                  NEXT_PUBLIC_MAPBOX_TOKEN
                </code>{" "}
                en <code className="font-mono text-[11px]">.env.local</code> / Netlify para activar.
                Mientras tanto, vista esquemática de sedes.
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
