import type { ComponentType } from "react";
import type { FleetMotionStatus } from "../live";

/**
 * Abstracción de motor de mapa del tracking.
 *
 * La UI (FleetTrackingView) depende de ESTE contrato, nunca de mapbox-gl
 * directamente. Cambiar de motor = implementar FleetMapComponent en un archivo
 * nuevo y registrarlo en FleetMapCanvas; cero cambios en la vista.
 *
 *   Mapbox hoy · MapLibre mañana · Google si hiciera falta — sin refactor masivo.
 */

export type MapEngineId = "mapbox" | "maplibre" | "google";

/** Vehículo proyectable al mapa (view-model agnóstico del motor). */
export interface MapVehicle {
  id: string;
  name: string;
  driver: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  motion: FleetMotionStatus;
}

/** Props que TODO motor de mapa debe aceptar. Contrato estable. */
export interface FleetMapProps {
  token: string;
  vehicles: MapVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Un motor de mapa concreto = un componente que cumple FleetMapProps. */
export type FleetMapComponent = ComponentType<FleetMapProps>;
