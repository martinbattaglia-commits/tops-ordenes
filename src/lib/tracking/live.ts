import type { FleetLastPosition, FleetVehicle } from "./types";
import { deriveLiveStatus } from "./status";

/**
 * Estado de MOVIMIENTO para el mapa (display, no persistido).
 *
 * Refina el estado live (online/offline por recency) con la velocidad:
 *   · offline → sin pings recientes (gana sobre todo lo demás)
 *   · moving  → online y velocidad ≥ umbral
 *   · idle    → online pero detenido (velocidad < umbral o nula)
 *
 * Da los 3 colores de marcador: 🟢 movimiento · 🟡 detenido · 🔴 offline.
 * La persistencia de eventos vehicle_idle/moving/speeding es fase posterior.
 */
export type FleetMotionStatus = "moving" | "idle" | "offline";

/** Vehículo con su estado de movimiento derivado (view-model del mapa/panel). */
export type LiveVehicle = FleetVehicle & { motion: FleetMotionStatus };

/** Umbral por debajo del cual se considera DETENIDO (km/h). */
export const FLEET_IDLE_SPEED_KMH = 3;

export function deriveMotionStatus(
  pos: FleetLastPosition | null,
  nowMs: number
): FleetMotionStatus {
  if (deriveLiveStatus(pos, nowMs) === "offline") return "offline";
  const speed = pos?.speed ?? null; // ya normalizada a km/h por el provider
  return speed != null && speed >= FLEET_IDLE_SPEED_KMH ? "moving" : "idle";
}

/** Paleta de tokens Nexus por estado de movimiento (clases utilitarias). */
export const MOTION_TONE: Record<
  FleetMotionStatus,
  { label: string; dot: string; text: string; ring: string; hex: string }
> = {
  moving: {
    label: "En movimiento",
    dot: "bg-status-success",
    text: "text-status-success",
    ring: "ring-status-success/40",
    hex: "#16a34a",
  },
  idle: {
    label: "Detenido",
    dot: "bg-status-warning",
    text: "text-status-warning",
    ring: "ring-status-warning/40",
    hex: "#d97706",
  },
  offline: {
    label: "Offline",
    dot: "bg-fg-muted/50",
    text: "text-fg-muted",
    ring: "ring-fg-muted/20",
    hex: "#69738a",
  },
};
